/**
 * AI Studio's folder data for one page: the repository on AI Studio's own
 * bucket, its account scope and switch, the sync → local migration, the popup's
 * cloud-sync answers and the commands that edit it. The content script's start
 * point holds it for the page's lifetime (`aistudioFolderSessions.ts`), so the
 * migration and the listeners run with folders switched off, as they always
 * have; the folders plugin attaches a view while it runs.
 *
 * One account gate (`accountMatchesPage`): with isolation on, the folders are
 * shown, edited, uploaded and answered to the popup only while the account the
 * repository bound is the one the page shows. A page that switched accounts
 * before its rebind settled sees no folders and makes no write until the
 * attach retries or the next poll bind its account; then they come back.
 *
 * Lifetimes: an account release keeps the view but drops the old account's
 * state; detaching (folders off) suspends edits and the account poll but keeps
 * the storage and message listeners, so attaching again rebinds and reloads;
 * `close` (the last lease) stops everything once accepted writes drained.
 */
import browser, { type Runtime, type Storage } from 'webextension-polyfill';

import type { AccountScope } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastTone } from '@/core/ui/toast/types';
import { type FolderCommands, failed, isSaved } from '@/features/folder/commands/folderCommands';
import { createTranslator, initI18n } from '@/utils/i18n';

import { VALID_PATH } from '../../aistudioSidebarPaths';
import type { FolderDataSession } from '../FolderDataSession';
import { FolderRepository } from '../FolderRepository';
import {
  AIStudioAccountScope,
  aistudioAccountFingerprint,
  aistudioPageAccountFingerprint,
  aistudioPageAccountKnown,
} from '../aistudioAccountScope';
import { migrateAIStudioLegacySync } from '../aistudioImport';
import { getFolderRecoveryNotice } from '../folderRecoveryNotice';
import { AISTUDIO_FOLDER_CONFIG } from '../platformFolderConfig';
import { AIStudioFolderStorageAdapter } from '../storage/AIStudioFolderStorageAdapter';
import type { FolderWriteReceipt } from '../storage/FolderStorageAdapter';
import { createSyncMessageListener } from '../syncMessageListener';
import type { FolderData } from '../types';
import { createAIStudioCommands } from './aistudioCommands';

/**
 * Rebinds `attach` tries while the page keeps switching accounts. Past them the
 * account gate stays closed and the poll binds the page's account.
 */
const MAX_BIND_ROUNDS = 3;

const emptyData = (): FolderData => ({ folders: [], folderContents: {} });

/** Errors and warnings stay longer than a confirmation. */
export const AISTUDIO_NOTICE_MS: Record<ToastTone, number> = {
  info: 3000,
  success: 3000,
  warning: 7000,
  error: 5000,
};

/** What the folders' view does when the data changes; set while folders are on. */
export interface AIStudioFolderView {
  /** The data changed, loaded, or became editable or not. */
  render(): void;
  notify(message: string, tone: ToastTone): void;
  /** Which /library rows hide as archived follows the data. */
  applyHideArchived(): void;
  syncNudge(): void;
  /** The previous account's data is gone: close everything that held it. */
  releaseAccount(): void;
}

export class AIStudioFolderSession {
  /** Resolves against the bundled messages on every call, so it is right before `initI18n` settles. */
  private t: (key: string) => string = createTranslator();
  private view: AIStudioFolderView | null = null;
  /** Shows notices while no view is attached; a view shows its own. */
  private readonly toaster = createToaster();
  private attachedBefore = false;
  /** Set once `init` bound the account and started listening. */
  private started = false;
  /** The account the repository bound (`aistudioAccountFingerprint`); null while none is. */
  private boundFingerprint: string | null = null;
  /** The gate's state when the view last rendered for the session. */
  private shownGateOpen = true;
  private closed = false;
  private stopListening: (() => void) | null = null;

  readonly repository = new FolderRepository(
    AISTUDIO_FOLDER_CONFIG,
    new AIStudioFolderStorageAdapter(),
    {
      // loaded: a ready session bound or loaded. data/availability: a draft started or settled.
      onChange: (reason) => {
        if (reason === 'loaded' || reason === 'data' || reason === 'availability') {
          this.renderView();
        }
      },
      onRecovery: (result) => {
        const { message, tone } = getFolderRecoveryNotice(result);
        this.notify(message, tone);
      },
      onExternalChange: () => {
        // Sidebar rendering leaves /library rows untouched; refresh their archive classes too.
        const view = this.view;
        if (view) void this.load().then(() => view.applyHideArchived());
      },
      onAccountReleased: () => {
        this.boundFingerprint = null;
        this.view?.releaseAccount();
      },
      isEnabled: () => this.view !== null,
      onSaveFailed: () => this.notify(this.t('folder_save_error'), 'error'),
      // Membership decides which /library rows are archived, so every settled write re-syncs them.
      onPersistSettled: () => {
        this.view?.applyHideArchived();
        this.view?.syncNudge();
      },
      onAccountBound: (context) => {
        this.boundFingerprint = aistudioAccountFingerprint(context);
        this.account.bound(context);
      },
      // An unread switcher leaves the gate closed; the account poll binds once it reads.
      canBindAccount: aistudioPageAccountKnown,
    },
  );
  /** Every edit, save and import; each is refused, unwritten, while the account gate is closed. */
  readonly commands: FolderCommands = this.gated(
    createAIStudioCommands(this.repository, {
      commit: () => this.save().then(() => this.view?.render()),
      onDraftSettled: () => this.view?.applyHideArchived(),
    }),
  );
  readonly account = new AIStudioAccountScope(this.repository);

  /**
   * The account gate: whether the account the repository bound is the one the
   * page shows now. Always open with isolation off, where one bucket serves
   * every account.
   */
  get accountMatchesPage(): boolean {
    if (!this.repository.accountIsolationEnabled) return true;
    if (!this.repository.session || this.boundFingerprint === null) return false;
    return this.boundFingerprint === aistudioPageAccountFingerprint();
  }

  /** The folders to show; none while the account gate is closed. */
  get data(): FolderData {
    return this.accountMatchesPage ? this.repository.data : emptyData();
  }
  set data(data: FolderData) {
    this.repository.data = data;
  }
  get canEdit(): boolean {
    return this.repository.canEdit && this.accountMatchesPage;
  }
  get session(): FolderDataSession | null {
    return this.repository.session;
  }
  /** Changes on every account rebind, including a return to the same account. */
  get activation(): number {
    return this.repository.activation;
  }
  get accountScope(): AccountScope | null {
    return this.accountMatchesPage ? this.repository.accountScope : null;
  }
  get accountIsolationEnabled(): boolean {
    return this.repository.accountIsolationEnabled;
  }
  /** Isolation is on and the page's account switcher names no account: nothing can bind. */
  get accountUnknown(): boolean {
    return this.repository.accountIsolationEnabled && !aistudioPageAccountKnown();
  }
  /** Active folder data key; empty while no account is bound. */
  get activeStorageKey(): string {
    return this.repository.storageKey;
  }
  get attached(): boolean {
    return this.view !== null;
  }
  /** The translator once the page's language loaded. */
  get translate(): (key: string) => string {
    return (key) => this.t(key);
  }

  /** The migration always; the rest only where AI Studio's folders ever ran. */
  async init(): Promise<void> {
    await initI18n();
    this.t = createTranslator();
    try {
      await migrateAIStudioLegacySync(
        AISTUDIO_FOLDER_CONFIG.storageKey,
        this.repository.writeFolder,
      );
    } catch (error) {
      // The source and marker stay untouched on failure; normal loading continues.
      console.warn('[AIStudioFolderManager] Migration from sync to local failed:', error);
    }
    // The playground (/), saved prompts and the library history.
    if (this.closed || !isFolderPath()) return;
    await this.account.loadIsolationSetting();
    if (this.closed) return;
    await this.account.refresh(true);
    if (this.closed) return;
    this.listen();
    this.repository.watchStorage(); // Else a stale tab's next save overwrites other writers.
    this.startAccountPolling();
    this.started = true;
  }

  /**
   * Shows the folders in `view` from now on, once the account they belong to
   * is the page's. Attaching again after a detach rebinds the account, which
   * the detach suspended, before the view loads.
   */
  async attach(view: AIStudioFolderView): Promise<void> {
    if (this.closed || this.view === view) return;
    this.view = view;
    // Before start-up finished, `init` binds the account itself.
    if (!this.started) return;
    const first = !this.attachedBefore;
    this.attachedBefore = true;
    // Re-enabling after a detach: restart the poller it stopped.
    if (!first && !this.account.polling) this.startAccountPolling();
    // First attach: an account switched while folders were off, before the poll saw
    // it, needs its own bind. A re-attach rebinds the account the detach suspended.
    await this.account.refresh(!first);
    // A resolution still binds the account it started for, though the page may have
    // switched again meanwhile. Retry a few times; past that the gate stays closed.
    for (let round = 0; round < MAX_BIND_ROUNDS && !this.accountMatchesPage; round++) {
      if (this.view !== view || this.closed) return;
      await this.account.refresh(true);
    }
  }

  /** Folders off: edits and the account poll stop; the data and listeners stay. */
  detach(view: AIStudioFolderView): void {
    if (this.view !== view) return;
    this.view = null;
    this.attachedBefore = true;
    this.repository.suspend();
    this.account.stop();
  }

  load(): Promise<void> {
    return this.repository.loadData();
  }

  async save(): Promise<boolean> {
    return isSaved(await this.commands.run({ kind: 'saveCurrentData' }));
  }

  /**
   * Keeps imported or synced drafts out of live data until storage accepts
   * them. Prompts share the folder write, so a merge lands whole or not at all.
   */
  async replaceData(
    data: FolderData,
    prompts?: PromptItem[],
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean> {
    return isSaved(
      await this.commands.runBulk({ kind: 'commitPreparedData', data, prompts, beforeWrite }),
    );
  }

  /** Stops everything; resolves once the repository's accepted writes drained. */
  close(): Promise<void> {
    this.closed = true;
    this.view = null;
    this.stopListening?.();
    this.stopListening = null;
    this.account.stop();
    this.toaster.destroy();
    return this.repository.destroy();
  }

  private notify(message: string, tone: ToastTone): void {
    if (this.view) this.view.notify(message, tone);
    else this.toaster.show({ message, tone, durationMs: AISTUDIO_NOTICE_MS[tone] });
  }

  private listen(): void {
    const onStorage = (changes: Record<string, Storage.StorageChange>, areaName: string): void => {
      if (areaName !== 'sync') return;
      if (
        changes[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] ||
        changes[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]
      ) {
        void this.account
          .readIsolationSetting()
          .then((enabled) => this.handleAccountIsolationToggle(enabled));
      }
    };
    browser.storage.onChanged.addListener(onStorage);
    const syncListener = createSyncMessageListener({
      // With folders off nothing reloads, so the retained snapshot may be older than storage.
      canEdit: () => this.view !== null && this.canEdit,
      data: () => this.data,
      accountScope: () => this.accountScope,
      reload: () => this.load().then(() => this.renderView()),
    });
    // The polyfill's typing cannot express "respond to some messages, ignore the rest".
    browser.runtime.onMessage.addListener(syncListener as Runtime.OnMessageListenerCallback);
    this.stopListening = () => {
      browser.storage.onChanged.removeListener(onStorage);
      browser.runtime.onMessage.removeListener(syncListener as Runtime.OnMessageListenerCallback);
    };
  }

  async handleAccountIsolationToggle(enabled: boolean): Promise<void> {
    if (enabled === this.accountIsolationEnabled) return;
    this.repository.setAccountIsolationFlag(enabled);
    await this.account.refresh(true);
    await this.load();
    this.renderView();
  }

  /** `detach` and `close` stop it; a restart replaces the previous poll. */
  startAccountPolling(): void {
    this.account.startPolling(() => void this.refreshScopedDataOnAccountContextChange());
  }

  async refreshScopedDataOnAccountContextChange(): Promise<void> {
    if (!this.accountIsolationEnabled) return;
    // A page that switched accounts hides the folders now, before any rebind settles.
    this.renderIfGateMoved();
    if (!(await this.account.refresh(false))) {
      this.renderIfGateMoved();
      return;
    }
    await this.load();
    this.renderView();
  }

  private renderView(): void {
    this.shownGateOpen = this.accountMatchesPage;
    this.view?.render();
  }

  /** The gate opened or closed since the view last rendered: show what it allows now. */
  private renderIfGateMoved(): void {
    if (this.accountMatchesPage === this.shownGateOpen) return;
    this.renderView();
    this.view?.applyHideArchived();
  }

  /** `commands` behind the account gate: a closed gate refuses every op before it runs. */
  private gated(commands: FolderCommands): FolderCommands {
    const refused = () => Promise.resolve(failed('read_only'));
    return {
      ...commands,
      status: () => (this.accountMatchesPage ? commands.status() : 'read_only'),
      view: () => this.data,
      run: (body) => (this.accountMatchesPage ? commands.run(body) : refused()),
      runBulk: (body) => (this.accountMatchesPage ? commands.runBulk(body) : refused()),
    };
  }
}

/** The playground (/), saved prompts and the library: where AI Studio's folders run. */
export function isFolderPath(pathname: string = location.pathname): boolean {
  return VALID_PATH.test(pathname) || pathname === '/';
}
