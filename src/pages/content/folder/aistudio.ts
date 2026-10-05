/**
 * The AI Studio folder adapter: binds folder data (FolderRepository) to AI
 * Studio's pages. It owns the account session, the panel's lifetime and the
 * settings; the page integration lives in the `aistudio*` modules beside it.
 *
 * Lifetimes: an account release keeps the panel but drops the old account's
 * state; a nav rebuild re-injects the panel; `destroy` (feature off) removes all
 * but the storage and message listeners, so a re-enable rebuilds from scratch.
 */
import browser from 'webextension-polyfill';

import type { AccountScope } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import { createToaster } from '@/core/ui/toast/toaster';
import type { ToastTone } from '@/core/ui/toast/types';
import { isSaved } from '@/features/folder/commands/folderCommands';
import { createTranslator, initI18n } from '@/utils/i18n';

import { watchRouteChanges } from '../utils/routeWatcher';
import type { FolderDataSession } from './FolderDataSession';
import { FolderRepository } from './FolderRepository';
import { AIStudioAccountScope } from './aistudioAccountScope';
import { HideArchivedSetting } from './aistudioHideArchived';
import { migrateAIStudioLegacySync } from './aistudioImport';
import { LibraryPage } from './aistudioLibraryPage';
import { clearArchivedRows, isLibraryPath } from './aistudioLibraryTable';
import { openPromptInApp } from './aistudioNavigation';
import {
  buildFolderPanel,
  insertFolderPanel,
  updateLibraryShortcut,
  waitForPanelAnchor,
  watchPanelMount,
} from './aistudioPanel';
import {
  bindPromptDragSources,
  hasStoredPrompts,
  watchBodyPromptPopovers,
  watchPromptHistory,
} from './aistudioPromptHistory';
import { currentPromptId, readPromptDragData } from './aistudioPromptLinks';
import { SIDEBAR_WIDTH_KEY, SidebarWidth } from './aistudioSidebarWidth';
import { AIStudioTransfer, createSyncMessageListener } from './aistudioTransfer';
import { type AIStudioTree, aistudioTreeActions, mountAIStudioTree } from './aistudioTree';
import type { TreeActions } from './floatingTree/shared';
import { createFolderDialogs } from './folderDialogs';
import { getFolderRecoveryNotice } from './folderRecoveryNotice';
import { createLegacyAIStudioCommands } from './legacyAIStudioCommands';
import { AISTUDIO_FOLDER_CONFIG } from './platformFolderConfig';
import { AIStudioFolderStorageAdapter } from './storage/AIStudioFolderStorageAdapter';
import { readSyncTooltip } from './syncTooltip';
import type { FolderData } from './types';

const VALID_PATH = /^\/(prompts|library)(\/|$)/;
/** Errors and warnings stay longer than a confirmation. */
const NOTICE_MS: Record<ToastTone, number> = {
  info: 3000,
  success: 3000,
  warning: 7000,
  error: 5000,
};

export class AIStudioFolderManager {
  /** Resolves against the bundled messages on every call, so it is right before `initI18n` settles. */
  private t: (key: string) => string = createTranslator();
  // Missing keys render literally: keep them in every locale and fill placeholders explicitly.
  // Function replacers keep dollar sequences in user and error text literal.
  private readonly translate = (key: string) => this.t(key);
  /** Cleared, not destroyed, when the feature turns off, so a re-enable can notify again. */
  private readonly toaster = createToaster();
  private readonly notify = (message: string, tone: ToastTone, channel?: string): void => {
    this.toaster.show({ message, tone, durationMs: NOTICE_MS[tone], channel });
  };
  /** Owns sessions, load, recovery, serialized saves, drafts, echoes and scope retry. */
  private readonly repository = new FolderRepository(
    AISTUDIO_FOLDER_CONFIG,
    new AIStudioFolderStorageAdapter(),
    {
      // loaded: a ready session bound or loaded. data/availability: a draft started or settled.
      onChange: (reason) => {
        if (reason === 'loaded' || reason === 'data' || reason === 'availability') this.render();
      },
      onRecovery: (result) => {
        const { message, tone } = getFolderRecoveryNotice(result);
        this.notify(message, tone);
      },
      onExternalChange: () => {
        // Sidebar rendering leaves /library rows untouched; refresh their archive classes too.
        if (this.folderEnabled) void this.load().then(() => this.applyHideArchived());
      },
      onAccountReleased: () => this.releaseAccountUi(),
      isEnabled: () => this.folderEnabled,
      onSaveFailed: () => this.notify(this.t('folder_save_error'), 'error'),
      // Membership decides which /library rows are archived, so every settled write re-syncs them.
      onPersistSettled: () => {
        this.applyHideArchived();
        this.syncNudge();
      },
      onAccountBound: (context) => this.account.bound(context),
    },
  );
  private readonly commands = createLegacyAIStudioCommands(this.repository, {
    commit: () => this.save().then(() => this.render()),
    onDraftSettled: () => {
      if (this.container) this.applyHideArchived();
    },
  });
  private readonly account = new AIStudioAccountScope(this.repository);
  readonly transfer = new AIStudioTransfer({
    t: this.translate,
    session: () => this.dataSession,
    activation: () => this.accountScopeRequest,
    canEdit: () => this.canEdit,
    data: () => this.data,
    replaceData: (data, prompts) => this.replaceData(data, prompts),
    notify: this.notify,
  });
  private readonly library = new LibraryPage({
    commands: this.commands,
    t: this.translate,
    canEdit: () => this.canEdit,
    data: () => this.data,
    activation: () => this.accountScopeRequest,
    save: () => this.save(),
    placeDrop: (event, folderId) => this.placeDroppedPrompt(event, folderId),
    applyHideArchived: () => this.applyHideArchived(),
    notify: this.notify,
    toaster: this.toaster,
  });
  private readonly hideArchived = new HideArchivedSetting();
  private readonly sidebarWidth = new SidebarWidth();
  private readonly dialogs = createFolderDialogs();
  private container: HTMLElement | null = null;
  private historyRoot: HTMLElement | null = null;
  private tree: AIStudioTree | null = null;
  private libraryShortcutBtn: HTMLButtonElement | null = null;
  /** Stops for what `initializeFolderUI` started once per mount. */
  private cleanupFns: Array<() => void> = [];
  private stopMountWatch: (() => void) | null = null;
  private stopBodyPopovers: (() => void) | null = null;
  private stopRouteWatcher: (() => void) | null = null;
  private folderEnabled = true;

  private get dataSession(): FolderDataSession | null {
    return this.repository.session;
  }
  private get accountScopeRequest(): number {
    return this.repository.activation;
  }
  private get data(): FolderData {
    return this.repository.data;
  }
  private set data(data: FolderData) {
    this.repository.data = data;
  }
  private get canEdit(): boolean {
    return this.repository.canEdit;
  }
  private get accountIsolationEnabled(): boolean {
    return this.repository.accountIsolationEnabled;
  }
  private get accountScope(): AccountScope | null {
    return this.repository.accountScope;
  }
  /** Active folder data key; empty while no account is bound. */
  private get activeStorageKey(): string {
    return this.repository.storageKey;
  }

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
    if (!VALID_PATH.test(location.pathname) && location.pathname !== '/') return;

    await this.loadFolderEnabledSetting();
    await this.hideArchived.load();
    await this.account.loadIsolationSetting();
    await this.account.refresh(true);
    await this.sidebarWidth.load();
    this.setupStorageListener();
    this.repository.watchStorage(); // Else a stale tab's next save overwrites other writers.
    this.startAccountPolling();
    browser.runtime.onMessage.addListener(
      createSyncMessageListener({
        // Disabled managers stop reloading, so their retained snapshot may be older than storage.
        canEdit: () => this.folderEnabled && this.canEdit,
        data: () => this.data,
        accountScope: () => this.accountScope,
        reload: () => this.load().then(() => this.render()),
      }),
    );
    if (this.folderEnabled) await this.initializeFolderUI();
  }

  /** The previous account's data is gone from view; close everything that held it. */
  private releaseAccountUi(): void {
    this.library.releaseAccount();
    this.dialogs.closeAll();
    this.tree?.reset(this.data);
    this.render();
    this.applyHideArchived();
  }

  private async handleAccountIsolationToggle(enabled: boolean): Promise<void> {
    if (enabled === this.accountIsolationEnabled) return;
    this.repository.setAccountIsolationFlag(enabled);
    await this.account.refresh(true);
    await this.load();
    if (this.folderEnabled && this.container) this.render();
  }

  /** destroy() stops it; a restart replaces the previous poll. */
  private startAccountPolling(): void {
    this.account.startPolling(() => void this.refreshScopedDataOnAccountContextChange());
  }

  private async refreshScopedDataOnAccountContextChange(): Promise<void> {
    if (!this.accountIsolationEnabled) return;
    if (!(await this.account.refresh(false))) return;
    await this.load();
    if (this.folderEnabled && this.container) this.render();
  }

  private async initializeFolderUI(): Promise<void> {
    const isLibraryPage = isLibraryPath();
    const mountSignal = await waitForPanelAnchor();
    this.historyRoot = document.querySelector<HTMLElement>('ms-prompt-history-v3');
    if (!mountSignal) return;
    document.documentElement.classList.add('gv-aistudio-root');
    await this.load();
    // The V2 nav has an anchor on every page, /library included.
    this.injectUI();
    this.watchContainerMount();
    if (this.historyRoot) {
      this.cleanupFns.push(
        watchPromptHistory(this.historyRoot, {
          hasStoredPrompts: () => hasStoredPrompts(this.data),
          syncTitles: () => this.syncConversationTitlesFromPromptList(),
          onPromptClick: () => this.highlightActiveConversation(),
        }),
      );
      bindPromptDragSources(this.historyRoot);
      await this.syncConversationTitlesFromPromptList();
    }
    this.stopBodyPopovers ??= watchBodyPromptPopovers();
    this.highlightActiveConversation();
    this.installRouteChangeListener();
    this.sidebarWidth.apply(true);
    this.cleanupFns.push(this.sidebarWidth.mountResizeHandle());
    if (isLibraryPage) this.library.attach();
  }

  /** Re-injects the panel when an Angular rebuild of the nav drops it. */
  private watchContainerMount(): void {
    this.stopMountWatch?.();
    this.stopMountWatch = watchPanelMount(
      () => !this.container || document.body.contains(this.container),
      () => {
        this.container = null;
        try {
          this.injectUI();
        } catch (error) {
          console.error('[AIStudioFolderManager] Failed to re-inject folder panel:', error);
        }
      },
    );
  }

  private async load(): Promise<void> {
    await this.repository.loadData();
  }

  private async save(): Promise<boolean> {
    return isSaved(await this.commands.run({ kind: 'saveCurrentData' }));
  }

  /**
   * Keeps imported or synced drafts out of live data until storage accepts
   * them. Prompts share the folder write, so a merge lands whole or not at all.
   */
  private async replaceData(data: FolderData, prompts?: PromptItem[]): Promise<boolean> {
    return isSaved(await this.commands.runBulk({ kind: 'commitPreparedData', data, prompts }));
  }

  private injectUI(): void {
    if (this.container && document.body.contains(this.container)) return;
    const { container, libraryButton } = buildFolderPanel(
      {
        t: this.translate,
        onCloudUpload: () => void this.transfer.upload(),
        onCloudSync: () => void this.transfer.sync(),
        uploadTooltip: () => readSyncTooltip('aistudio', 'upload'),
        syncTooltip: () => readSyncTooltip('aistudio', 'sync'),
        onCreateFolder: () => {
          if (this.canEdit) this.tree?.startCreateFolder();
        },
      },
      this.historyRoot !== null,
    );
    this.libraryShortcutBtn = libraryButton;
    updateLibraryShortcut(libraryButton);
    // A re-inject builds a new container; the old tree goes with the old one.
    this.unmountTree();
    this.tree = mountAIStudioTree({
      data: this.data,
      actions: this.treeActions(),
      activeConversationId: currentPromptId(),
    });
    container.appendChild(this.tree.host);
    if (!insertFolderPanel(container, this.historyRoot)) return;
    this.container = container;
    this.render();
    this.applyFolderEnabledSetting();
  }

  private treeActions(): TreeActions {
    return aistudioTreeActions({
      commands: this.commands,
      canEdit: () => this.canEdit,
      data: () => this.data,
      commit: () => void this.save().then(() => this.render()),
      onNavigate: ({ conversationId, url }) => {
        if (openPromptInApp(conversationId, url)) {
          setTimeout(() => this.highlightActiveConversation(), 0);
        }
      },
      placeDrop: (event, folderId) => this.placeDroppedPrompt(event, folderId),
      confirmFolderRemoval: this.dialogs.confirmFolderRemoval,
      confirmConversationRemoval: this.dialogs.confirmConversationRemoval,
    });
  }

  private unmountTree(): void {
    this.tree?.destroy();
    this.tree = null;
  }

  private render(): void {
    if (!this.container) return;
    this.container.inert = !this.canEdit;
    this.container.setAttribute('aria-busy', String(!this.canEdit));
    this.container
      .querySelectorAll<HTMLButtonElement>('.gv-folder-header-actions button')
      .forEach((button) => {
        button.disabled = !this.canEdit;
      });
    this.tree?.update(this.data);
    this.highlightActiveConversation();
    this.syncNudge();
  }

  private highlightActiveConversation(): void {
    this.tree?.setActiveConversation(currentPromptId());
  }

  /** Moves a dropped prompt into `folderId` (null: Uncategorized); false when it carries none. */
  private placeDroppedPrompt(event: DragEvent, folderId: string | null): boolean {
    const prompt = readPromptDragData(event);
    if (!prompt || prompt.type !== 'conversation' || !prompt.conversationId) return false;
    const created = { untitledTitle: this.t('conversation_untitled'), at: Date.now() };
    const dropped = { ...prompt, conversationId: prompt.conversationId };
    void this.commands.run({
      kind: 'placeAIStudioPrompt',
      prompt: dropped,
      target: folderId,
      untitledTitle: created.untitledTitle,
      at: created.at,
    });
    return true;
  }

  /** Native titles reach folders that hold the prompt, unless the user renamed it. */
  private async syncConversationTitlesFromPromptList(): Promise<void> {
    if (!this.canEdit || !hasStoredPrompts(this.data)) return;
    await this.commands.run({ kind: 'syncNativeSidebarTitles' });
  }

  /** Re-attaches a panel Angular tore down, and re-arms the watch on a rebuilt nav. */
  private ensureContainerMounted(): void {
    if (!this.folderEnabled) return;
    if (this.container && document.body.contains(this.container)) return;
    this.container = null;
    try {
      this.injectUI();
    } catch (error) {
      console.error('[AIStudioFolderManager] Failed to ensure folder panel mounted:', error);
    }
    this.watchContainerMount();
  }

  private installRouteChangeListener(): void {
    this.stopRouteWatcher?.();
    this.stopRouteWatcher = watchRouteChanges(
      () => void setTimeout(() => this.handleRouteChange(), 0),
    );
  }

  private handleRouteChange(): void {
    this.ensureContainerMounted();
    updateLibraryShortcut(this.libraryShortcutBtn);
    if (isLibraryPath()) this.library.attach();
    else this.library.detach();
    this.highlightActiveConversation();
  }

  private applyHideArchived(): void {
    this.hideArchived.applyToLibrary(this.data);
  }

  private syncNudge(): void {
    if (this.container) this.hideArchived.syncNudge(this.container, this.data);
  }

  private async loadFolderEnabledSetting(): Promise<void> {
    try {
      const result = await browser.storage.sync.get({ geminiFolderEnabled: true });
      this.folderEnabled = result.geminiFolderEnabled !== false;
    } catch (error) {
      console.error('[AIStudioFolderManager] Failed to load folder enabled setting:', error);
      this.folderEnabled = true;
    }
  }

  private setupStorageListener(): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes.geminiFolderEnabled) {
        this.folderEnabled = changes.geminiFolderEnabled.newValue !== false;
        this.applyFolderEnabledSetting();
      }
      if (
        changes[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] ||
        changes[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]
      ) {
        void this.account
          .readIsolationSetting()
          .then((enabled) => this.handleAccountIsolationToggle(enabled));
      }
      if (changes[SIDEBAR_WIDTH_KEY]) {
        this.sidebarWidth.applyStoredWidth(changes[SIDEBAR_WIDTH_KEY].newValue);
      }
      if (this.hideArchived.applyStorageChanges(changes)) {
        this.applyHideArchived();
        this.syncNudge();
      }
    });
  }

  private applyFolderEnabledSetting(): void {
    if (!this.folderEnabled) {
      // A disabled feature costs nothing; a re-enable rebuilds from scratch.
      this.destroy();
      return;
    }
    // Re-enabling after destroy(): restart the poller it stopped.
    if (!this.account.polling) this.startAccountPolling();
    if (this.container) {
      this.container.style.display = '';
      return;
    }
    this.account
      .refresh(true)
      .then(() => this.initializeFolderUI())
      .catch((error) => {
        console.error('[AIStudioFolderManager] Failed to initialize folder UI:', error);
      });
  }

  /**
   * Removes everything the feature attached to the page. Idempotent. The
   * storage and runtime-message listeners stay, so a re-enable can rebuild.
   */
  private destroy(): void {
    this.repository.suspend();
    for (const cleanup of this.cleanupFns.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    for (const stop of [this.stopMountWatch, this.stopBodyPopovers]) stop?.();
    this.stopMountWatch = this.stopBodyPopovers = null;
    this.account.stop();
    this.stopRouteWatcher?.();
    this.stopRouteWatcher = null;
    this.library.destroy();
    this.dialogs.closeAll();
    this.toaster.clear();
    // With the feature off nothing would show the /library rows it hid.
    clearArchivedRows();
    this.unmountTree();
    this.container?.remove();
    this.container = null;
    this.libraryShortcutBtn = null;
    this.historyRoot = null;
    document.documentElement.classList.remove('gv-aistudio-root');
  }
}

export async function startAIStudioFolderManager(): Promise<void> {
  try {
    await new AIStudioFolderManager().init();
  } catch (error) {
    console.error('[AIStudioFolderManager] Start error:', error);
  }
}
