/**
 * Gemini's folder data for one page: the folder store on Gemini's bucket (its
 * repository, account scope and Gemini edits), the commands that edit it, the
 * popup's cloud-sync and AI-structure answers and the legacy sync-mode
 * migration. The content script's start point holds it for the page's lifetime
 * (`geminiFolderSessions.ts`), so those run with the folders off, as they
 * always did; Folder-as-Project files new chats through it, and the folders
 * plugin's view attaches while it runs. Following the account's `/u/<n>/`
 * route and polling the page's account run only while a view is attached;
 * with the folders off the account is bound again when Folder-as-Project asks
 * for the folders.
 *
 * One account gate (`accountMatchesPage`): with isolation on, the folders are
 * shown, edited, uploaded and answered to the popup only while the account
 * the store bound is the one the page shows (`geminiAccountRoute.ts`). While
 * they differ, or the page's account cannot be read, `data` is empty,
 * `canEdit` false, `accountScope` and `dataSession` null, and every command
 * and store edit is refused before it runs; nothing reads that empty view to
 * write it back. Nor is any account bound, loaded, migrated or recovered while
 * the page's account cannot be read (`canBindAccount`): a route slot alone
 * never owns a bucket.
 */
import type { AccountScope } from '@/core/services/AccountIsolationService';
import { createToaster } from '@/core/ui/toast/toaster';
import { type FolderCommands, failed } from '@/features/folder/commands/folderCommands';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import { createAccountNoticeDelay } from '@/features/plugins/verbs/folders/accountNotice';
import { initI18n } from '@/utils/i18n';

import type { FolderDataSession } from '../FolderDataSession';
import { LEVEL_MS } from '../FolderFeedback';
import { FolderStore, type FolderStoreChange } from '../FolderStore';
import { getFolderRecoveryNotice } from '../folderRecoveryNotice';
import { listenForFolderRuntimeMessages } from '../folderRuntimeMessages';
import { createLegacyFolderCommands } from '../legacyFolderCommands';
import { migrateLegacySyncMode } from '../legacySyncMode';
import type { Folder, FolderData } from '../types';
import { geminiAccountFingerprint, geminiPageAccountFingerprint } from './geminiAccountRoute';

/** What the folders' view, while attached, tells the session and is told by it. */
export interface GeminiFolderView {
  /** Whether the folders are on, Gemini's sidebar, and the tree's conversation order. */
  context(): { enabled: boolean; sidebar: HTMLElement | null; sortMode: ConversationSortMode };
  onChange(reason: FolderStoreChange): void;
  /** A chat was filed from outside a folder for the first time. */
  onArchive(): void;
  onRecovery(result: 'recovered' | 'lost' | 'unreadable'): void;
  /** The folders reloaded after a cloud download: show them. */
  refresh(): void;
}

/** What the folder UI reads: the gated data, and whether it may edit now. */
export interface GeminiFolderReads {
  readonly data: FolderData;
  readonly canEdit: boolean;
  /** Changes on every account rebind, including a return to the same account. */
  readonly activation: number;
  readonly accountIsolationEnabled: boolean;
  /**
   * Isolation is on and the page has named no account it can read for the
   * grace period (`ACCOUNT_NOTICE_GRACE_MS`): no folders can show, and the
   * panel says why.
   */
  readonly accountUnknown?: boolean;
}

const DETACHED = { enabled: false, sidebar: null, sortMode: 'manual' } as const;
/** How often a page with isolation on checks that the bound account is still the page's. */
const ACCOUNT_POLL_MS = 1200;
/** Rebinds `attach` tries while the page keeps switching; past them the poll takes over. */
const MAX_BIND_ROUNDS = 3;

const emptyData = (): FolderData => ({ folders: [], folderContents: {} });

export class GeminiFolderSession implements GeminiFolderReads {
  private view: GeminiFolderView | null = null;
  private closed = false;
  private started = false;
  private stopListening: (() => void) | null = null;
  private poll: number | null = null;
  /** The account the store bound (`geminiAccountFingerprint`); null while none is known. */
  private boundFingerprint: string | null = null;
  /** The gate's state when the view was last told. */
  private shownGateOpen = true;
  private binding: Promise<void> | null = null;
  /** Told each time the page's folders are ready to read: bound, loaded and the gate open. */
  private readonly readyListeners = new Set<() => void>();
  /** Told each time the account the page's folders belong to may have changed. */
  private readonly accountListeners = new Set<() => void>();
  /** The grace before the panel says the account is unreadable; the view shows it then. */
  private readonly accountNotice = createAccountNoticeDelay(() => {
    if (!this.closed) this.view?.onChange('loaded');
  });
  /** Shows notices while no view is attached; a view shows its own. */
  private toaster: ReturnType<typeof createToaster> | null = null;

  /** The store itself; the folder UI and every outside reader go through the session. */
  readonly store = new FolderStore({
    getContext: () => this.view?.context() ?? DETACHED,
    onChange: (reason) => this.changed(reason),
    onArchive: () => this.view?.onArchive(),
    onRecovery: (result) => this.recovered(result),
    onAccountBound: (context) => {
      this.boundFingerprint = geminiAccountFingerprint(context);
    },
    accountMatchesPage: () => this.accountMatchesPage,
    canBindAccount: () => geminiPageAccountFingerprint() !== null,
  });
  /** Every edit and import; each is refused, unwritten, while the account gate is closed. */
  readonly commands: FolderCommands = this.gated(createLegacyFolderCommands(this.store));

  /**
   * The account gate: whether the account the store bound is the one the page
   * shows now. Always open with isolation off, where one bucket serves every
   * account.
   */
  get accountMatchesPage(): boolean {
    if (!this.store.accountIsolationEnabled) return true;
    if (!this.store.session || this.boundFingerprint === null) return false;
    return this.boundFingerprint === geminiPageAccountFingerprint();
  }

  /** The folders to show; none while the account gate is closed. */
  get data(): FolderData {
    return this.accountMatchesPage ? this.store.data : emptyData();
  }
  get canEdit(): boolean {
    return this.store.canEdit;
  }
  get accountScope(): AccountScope | null {
    return this.accountMatchesPage ? this.store.accountScope : null;
  }
  /** The bound data session, which transfers write through; null while the gate is closed. */
  get dataSession(): FolderDataSession | null {
    return this.accountMatchesPage ? this.store.session : null;
  }
  get activation(): number {
    return this.store.activation;
  }
  get accountIsolationEnabled(): boolean {
    return this.store.accountIsolationEnabled;
  }
  get accountUnknown(): boolean {
    // Reading it starts the grace; an account read before it ends shows no notice.
    return this.accountNotice.shown(
      this.store.accountIsolationEnabled &&
        !this.accountMatchesPage &&
        geminiPageAccountFingerprint() === null,
    );
  }
  /** The active bucket's key, which pending native deletes check against. */
  get storageKey(): string {
    return this.store.storageKey;
  }

  /** Binds the page's account, when known, and loads its folders; then answers the popup. */
  async init(): Promise<void> {
    // Notices shown while the folders load speak the page's language.
    await initI18n().catch(() => {});
    if (this.closed) return;
    await this.store.init();
    if (this.closed) return;
    this.listen();
    this.started = true;
    this.syncPoll();
    void migrateLegacySyncMode();
  }

  /**
   * Shows the folders in `view` from now on, once the account they belong to
   * is the page's: an account the page switched to while the folders were
   * off, before anything rebound, is bound first.
   */
  async attach(view: GeminiFolderView): Promise<void> {
    if (this.closed || this.view === view) return;
    this.view = view;
    this.shownGateOpen = this.accountMatchesPage;
    this.syncPoll();
    // Before start-up finished, `init` binds the account itself.
    if (!this.started) return;
    // A resolution binds the account it started for, though the page may have moved on.
    for (let round = 0; round < MAX_BIND_ROUNDS && !this.accountMatchesPage; round++) {
      if (this.view !== view || this.closed) return;
      if (!(await this.rebind())) return;
    }
  }

  detach(view: GeminiFolderView): void {
    if (this.view !== view) return;
    this.view = null;
    this.syncPoll();
  }

  /** Answers the popup's cloud sync and AI-structure requests; once. */
  listen(): void {
    if (this.closed || this.stopListening) return;
    this.stopListening = listenForFolderRuntimeMessages({
      store: this,
      refresh: () => this.view?.refresh(),
      getSidebarContext: () => ({
        sidebar: this.view?.context().sidebar ?? null,
        accountIsolationEnabled: this.store.accountIsolationEnabled,
        isDestroyed: this.closed,
      }),
    });
  }

  loadData(): Promise<void> {
    return this.store.loadData();
  }

  /**
   * Follows the page's `/u/<n>/` route, then makes sure the page's account is
   * the bound one. The attached view's navigation calls it on route changes.
   */
  async followRoute(): Promise<void> {
    if (this.closed) return;
    this.tellIfGateMoved();
    await this.store.reloadScopedDataOnAccountRouteChange();
    await this.rebind();
  }

  // The folder view's reads and its activity tracking.

  hasStoredConversations(): boolean {
    return this.accountMatchesPage && this.store.hasStoredConversations();
  }

  isConversationInFolders(conversationId: string, revision?: object): boolean {
    return this.accountMatchesPage && this.store.isConversationInFolders(conversationId, revision);
  }

  /** Lands an edit still waiting on the debounce. */
  flush(): void {
    this.store.flushPendingSaveData();
  }

  startActivity(): Promise<void> {
    return this.store.initializeConversationActivityTracking();
  }

  stopActivity(): void {
    this.store.teardownConversationActivityTracking();
  }

  // Folder-as-Project's port: the folders to pick from, and filing the new chat.

  /** Binds the page's account first if it changed while nothing followed it (folders off). */
  async ensureDataLoaded(): Promise<void> {
    if (!this.accountMatchesPage) await this.rebind();
    if (this.accountMatchesPage) await this.store.ensureDataLoaded();
  }

  getFolders(): Folder[] {
    return this.data.folders;
  }

  /**
   * Whose folders the page shows: `shared` with isolation off, where one
   * bucket serves every account whatever its control says; with isolation on,
   * the account Gemini's control names (`geminiAccountFingerprint`), or `null`
   * while it is unreadable, which is no account yet rather than another one.
   * Folder-as-Project keeps a choice only for the account it was made for.
   */
  folderAccount(): string | null {
    if (!this.store.accountIsolationEnabled) return 'shared';
    return geminiPageAccountFingerprint();
  }

  /** The folders to show with `folderAccount()`, read in one step so neither is another account's. */
  folderSnapshot(): { account: string | null; folders: Folder[] } {
    const account = this.folderAccount();
    return { account, folders: this.getFolders() };
  }

  /** Calls `listener` whenever `folderAccount()` may have changed; returns its removal. */
  onAccountChange(listener: () => void): () => void {
    this.accountListeners.add(listener);
    return () => this.accountListeners.delete(listener);
  }

  /** Calls `listener` whenever the page's folders become readable; returns its removal. */
  onFoldersReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  /**
   * Before answering the popup's cloud request: binds the page's account when
   * the gate is closed and that account can be read now, which with the folders
   * off nothing else would. Null when there is nothing to bind.
   */
  prepareRequest(): Promise<void> | null {
    if (this.closed || !this.started || this.accountMatchesPage) return null;
    if (geminiPageAccountFingerprint() === null) return null;
    return this.rebind().then(() => undefined);
  }

  addConversationToFolderFromNative(
    folderId: string,
    conversationId: string,
    title: string,
    url: string,
    isGem?: boolean,
    gemId?: string,
    lastTurnAt?: number,
  ): void {
    void this.commands.run({
      kind: 'addConversations',
      target: folderId,
      via: 'native-menu',
      seeds: [{ conversationId, title, url, isGem, gemId, lastTurnAt }],
    });
  }

  /** Stops everything; resolves once the store's accepted writes drained. */
  close(): Promise<void> {
    this.closed = true;
    this.view = null;
    this.stopListening?.();
    this.stopListening = null;
    this.readyListeners.clear();
    this.accountListeners.clear();
    this.accountNotice.stop();
    this.syncPoll();
    this.toaster?.destroy();
    this.toaster = null;
    return this.store.destroy();
  }

  /**
   * Binds the page's account when it is known and not the bound one. Resolves
   * whether a bind ran; one runs at a time, and a page without a readable
   * account binds nothing.
   */
  private async rebind(): Promise<boolean> {
    if (this.binding) {
      await this.binding;
      return true;
    }
    if (this.closed || !this.store.accountIsolationEnabled) return false;
    const page = geminiPageAccountFingerprint();
    if (page === null || (this.store.session && page === this.boundFingerprint)) return false;
    this.binding = this.store.rebindAccount().finally(() => {
      this.binding = null;
    });
    await this.binding;
    this.tellIfGateMoved();
    return true;
  }

  private changed(reason: FolderStoreChange): void {
    if (reason === 'account') this.syncPoll();
    if (reason === 'account' || reason === 'loaded' || reason === 'data') {
      this.shownGateOpen = this.accountMatchesPage;
    }
    this.view?.onChange(reason);
    if (reason === 'account') this.tellAccount();
    if (reason === 'loaded' || reason === 'data') this.tellReady();
  }

  /** The gate opened or closed since the view was last told: it shows what the gate allows now. */
  private tellIfGateMoved(): void {
    const open = this.accountMatchesPage;
    if (open === this.shownGateOpen) return;
    this.shownGateOpen = open;
    this.view?.onChange('account');
    this.tellAccount();
    this.tellReady();
  }

  private tellAccount(): void {
    if (this.closed) return;
    for (const listener of this.accountListeners) listener();
  }

  private tellReady(): void {
    if (this.closed || !this.accountMatchesPage || !this.store.session?.ready) return;
    for (const listener of this.readyListeners) listener();
  }

  /** Polls the page's account while a view shows the folders with isolation on. */
  private syncPoll(): void {
    const wanted =
      this.started && !this.closed && this.view !== null && this.store.accountIsolationEnabled;
    if (wanted && this.poll === null) {
      this.poll = window.setInterval(() => {
        this.tellIfGateMoved();
        if (!this.accountMatchesPage) void this.rebind();
      }, ACCOUNT_POLL_MS);
    } else if (!wanted && this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
  }

  private recovered(result: 'recovered' | 'lost' | 'unreadable'): void {
    if (this.view) {
      this.view.onRecovery(result);
      return;
    }
    const { message, tone } = getFolderRecoveryNotice(result);
    this.toaster ??= createToaster();
    this.toaster.show({ message, tone, durationMs: LEVEL_MS[tone] });
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
