/**
 * Gemini's folders on screen while the folders plugin runs: the folder section
 * in Gemini's sidebar (or the floating panel and its button), native rows as
 * drag sources with hide-filed, the native ⋮ menus and delete tracking, the
 * Activity view, navigation with Gem detection, and the batch-delete surface.
 * The data is Gemini's folder session in core (`GeminiFolderSession`), which
 * outlives this view; every read goes through it, so its account gate decides
 * what shows. `start` attaches, `destroy` removes all it added and detaches.
 */
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { isSaved } from '@/features/folder/commands/folderCommands';
import { geminiBatchDeleteService } from '@/pages/content/batchDelete/gemini';
import { FolderFeedback } from '@/pages/content/folder/FolderFeedback';
import { FolderNavigation } from '@/pages/content/folder/FolderNavigation';
import { FolderSelection } from '@/pages/content/folder/FolderSelection';
import { FolderSidebarRuntime } from '@/pages/content/folder/FolderSidebarRuntime';
import { FolderSidebarView } from '@/pages/content/folder/FolderSidebarView';
import type { FolderStoreChange } from '@/pages/content/folder/FolderStore';
import { FolderTransferController } from '@/pages/content/folder/FolderTransferController';
import { NativeConversationMenus } from '@/pages/content/folder/NativeConversationMenus';
import { NativeSidebarObserver } from '@/pages/content/folder/NativeSidebarObserver';
import { FloatingFolderUI } from '@/pages/content/folder/floatingFolderUI';
import { createFolderDialogs } from '@/pages/content/folder/folderDialogs';
import { folderDebug } from '@/pages/content/folder/folderManagerDebug';
import { openNativeRename } from '@/pages/content/folder/gemini/nativeRename';
import { createFolderHeaderMenus } from '@/pages/content/folder/headerMenus';
import { HideArchivedNudgeState } from '@/pages/content/folder/hideArchivedNudgeState';
import { NativeArchivedRows } from '@/pages/content/folder/nativeArchivedRows';
import { createNativePaginationNudge } from '@/pages/content/folder/nativeListPagination';
import { getNativeConversationElements } from '@/pages/content/folder/nativeSidebarDom';
import { removePageSheets } from '@/pages/content/folder/pageSheet';
import { ligatureIcon } from '@/pages/content/folder/selectionToolbar';
import type {
  GeminiFolderSession,
  GeminiFolderView,
} from '@/pages/content/folder/session/geminiFolderSession';
import { onCachedLanguageChange } from '@/utils/i18n';

import { listenForGeminiFolderSettings, readFloatingModeSetting } from './settings';

/** Sets the session before the view's fields, which are built on it. */
abstract class GeminiFolderSessionView {
  constructor(readonly session: GeminiFolderSession) {}
}

export class GeminiFoldersView extends GeminiFolderSessionView {
  private readonly commands = this.session.commands;
  private readonly transfer = new FolderTransferController({
    // While the account gate is closed there is no session, so nothing imports, uploads or syncs.
    getContext: () => ({
      session: this.session.dataSession,
      activation: this.session.activation,
      data: this.session.data,
    }),
    applyData: async (data) =>
      isSaved(await this.commands.runBulk({ kind: 'commitPreparedData', data })),
    refresh: () => this.refresh(),
    // One transfer notice at a time: a result replaces its "in progress" notice.
    notify: (message, type) => this.feedback.showNotification(message, type, 'transfer'),
  });
  private readonly dialogs = createFolderDialogs();
  private readonly feedback = new FolderFeedback();
  private readonly navigation = new FolderNavigation({
    getContext: () => ({
      container: this.sidebarRuntime.panel,
      sidebar: this.sidebarRuntime.sidebar,
      isDestroyed: this.isDestroyed,
      accountIsolationEnabled: this.session.accountIsolationEnabled,
    }),
    // The session follows the route on its own too, with the folders off; this is the fast path.
    onRouteChange: () => void this.session.followRoute(),
    folderAccount: () => this.session.folderAccount(),
    onOpened: (id) => {
      void this.commands.run({
        kind: 'markConversationOpened',
        conversationId: id,
        at: Date.now(),
      });
    },
    onTitleChange: (id, title) => {
      void this.commands.run({
        kind: 'syncNativeTitles',
        entries: [{ conversationId: id, title }],
      });
    },
    onGemDetected: (id, gemId) => {
      void this.commands.run({ kind: 'setConversationGem', hexId: id, gemId });
    },
    onActiveChange: () => this.treeView.refreshSite(),
  });
  private hideArchivedConversations = false;
  // Floating mode (a popup opt-in): never inject into Gemini's sidebar; mount the
  // body-level floating panel (or its FAB) and the native ⋮ menu observer instead.
  private floatingModeEnabled = false;
  private floatingOpenOnStart = true;
  private isDestroyed = false;
  private readonly lifetimeCleanup: Array<() => void> = [];
  private readonly floatingUI = new FloatingFolderUI({
    store: this.session,
    commands: this.commands,
    dialogs: this.dialogs,
    transfer: this.transfer,
    navigation: this.navigation,
    isActive: () => !this.isDestroyed,
    isFloatingMode: () => this.sidebarRuntime.isFloatingMode,
    getSortMode: () => this.treeView.sortMode,
    removeFloatingHost: () => this.selection.removeFloatingHost(),
  });
  private readonly paginationNudge = createNativePaginationNudge();
  private readonly archivedRows = new NativeArchivedRows({
    getSidebar: () => this.sidebarRuntime.sidebar,
    isHidingArchived: () => this.hideArchivedConversations,
    isInFolders: (id, pass) => this.session.isConversationInFolders(id, pass),
    onRowHidden: (row) => this.paginationNudge.rowHidden(row),
  });
  private readonly hideArchivedNudge = new HideArchivedNudgeState({
    isHidingArchived: () => this.hideArchivedConversations,
    getPanel: () => this.sidebarRuntime.panel,
  });
  private readonly headerMenus = createFolderHeaderMenus();
  private readonly nativeSidebarObserver = new NativeSidebarObserver({
    isDestroyed: () => this.isDestroyed,
    enhanceConversation: (row, pass) => {
      this.selection.makeConversationDraggable(row);
      this.archivedRows.apply(row, pass);
    },
    hasStoredConversations: () => this.session.hasStoredConversations(),
    onTitlesChanged: async () => {
      await this.commands.run({ kind: 'syncNativeSidebarTitles' });
    },
  });
  private readonly nativeConversationMenus: NativeConversationMenus = new NativeConversationMenus({
    getContext: () => ({
      sidebar: this.sidebarRuntime.sidebar,
      storageKey: this.session.storageKey,
      accountIsolationEnabled: this.session.accountIsolationEnabled,
      isDestroyed: this.isDestroyed,
    }),
    onMoveToFolder: ({ id, title, url }, trigger) => {
      if (!this.session.canEdit) return;
      this.dialogs.openMove(
        this.session.data.folders,
        (folderId) => this.session.addConversationToFolderFromNative(folderId, id, title, url),
        trigger,
      );
    },
    onConfirmedDelete: (id) => {
      void this.commands.run({ kind: 'removeConversationEverywhere', conversationId: id });
    },
  });

  private readonly sidebarRuntime: FolderSidebarRuntime = new FolderSidebarRuntime({
    createPanel: () => this.treeView.createPanel(),
    onPanelMount: () => {
      this.treeView.mount();
      this.selection.mount();
      this.batchDelete?.refresh();
      this.navigation.highlightActiveConversation();
      this.navigation.bind();
    },
    onPanelUnmount: (reason) => {
      this.selection.unmount();
      this.batchDelete?.unmount();
      this.treeView.unmount();
      this.navigation.unbind();
      this.feedback.hideTooltip();
      this.headerMenus.close();
      this.transfer.closeImportDialog();
      // A remount rebuilds the panel under the user; the folder instructions
      // editor and the move-to-folder picker are body-level and hold unsaved
      // input, so they stay. Everything else is anchored to a sidebar row that
      // no longer exists and would be stranded at stale coordinates.
      if (reason === 'stop') this.dialogs.closeAll();
      else this.dialogs.closeTransient();
    },
    nativeSidebar: this.nativeSidebarObserver,
    nativeMenus: this.nativeConversationMenus,
    floating: {
      isOpen: () => this.floatingUI.isOpen,
      open: async (openPanel) => {
        this.navigation.bind();
        if (openPanel) await this.floatingUI.openPanel();
        else await this.floatingUI.showFab();
      },
      close: () => this.floatingUI.close(),
    },
  });

  private readonly selection: FolderSelection = new FolderSelection({
    store: this.session,
    commands: this.commands,
    runtime: this.sidebarRuntime,
    navigation: this.navigation,
    feedback: this.feedback,
    toolbar: {
      host: () => this.sidebarRuntime.panel,
      placement: 'floating',
      icon: ligatureIcon,
    },
    nativeSelection: () => this.batchDelete?.selection() ?? null,
    onFinishNativeDrop: () => this.batchDelete?.exit(),
    onFolderSelectionChange: () => this.treeView.refreshSite(),
    getContext: () => ({
      accountIsolationEnabled: this.session.accountIsolationEnabled,
      isDestroyed: this.isDestroyed,
    }),
  });
  private batchDelete: ReturnType<typeof geminiBatchDeleteService.register> | null = null;

  private readonly treeView: FolderSidebarView = new FolderSidebarView({
    store: this.session,
    commands: this.commands,
    runtime: this.sidebarRuntime,
    selection: this.selection,
    navigation: this.navigation,
    feedback: this.feedback,
    dialogs: this.dialogs,
    transfer: this.transfer,
    headerMenus: this.headerMenus,
    getContext: () => ({
      enabled: !this.isDestroyed,
      hideArchivedConversations: this.hideArchivedConversations,
      isDestroyed: this.isDestroyed,
    }),
    onRefresh: () => this.refresh(),
    onRenameNative: (conversation) =>
      openNativeRename(conversation, {
        sidebar: this.sidebarRuntime.sidebar,
        archivedRows: this.archivedRows,
        menus: this.nativeConversationMenus,
        commands: this.commands,
      }),
    onSortModeChange: (mode) => this.floatingUI.handle?.update(this.session.data, mode),
  });

  /** What the session reads of this view and tells it. */
  private readonly view: GeminiFolderView = {
    context: () => ({
      sidebar: this.sidebarRuntime.sidebar,
      sortMode: this.treeView.sortMode,
      enabled: !this.isDestroyed,
    }),
    onChange: (reason) => this.handleStoreChange(reason),
    onArchive: () => this.hideArchivedNudge.maybeShow(),
    onRecovery: (result) => this.feedback.showRecoveryNotification(result),
    refresh: () => this.refresh(),
  };

  constructor(session: GeminiFolderSession, hideArchived: boolean) {
    super(session);
    this.hideArchivedConversations = hideArchived;
  }

  /** The folder section in Gemini's sidebar while it is mounted. */
  get container(): HTMLElement | null {
    return this.sidebarRuntime.panel;
  }

  /** Whether anything shows the folders: the section, or the floating panel or its button. */
  get onScreen(): boolean {
    if (this.sidebarRuntime.panel?.isConnected) return true;
    return this.sidebarRuntime.isFloatingMode || this.floatingUI.isOpen;
  }

  /** Attaches to the session, which first binds the page's account, and shows the folders. */
  async start(): Promise<void> {
    try {
      await this.session.attach(this.view);
      if (this.isDestroyed) return;
      await this.loadSettings();
      if (this.isDestroyed) return;
      this.setupStorageListener();
      this.attachBatchDelete();
      // The session tracks activity for the view only while it shows the folders.
      await this.session.startActivity();
      if (this.isDestroyed) return;
      await this.sidebarRuntime.start(
        this.floatingModeEnabled ? 'floating' : 'sidebar',
        this.floatingOpenOnStart,
      );
      folderDebug('Initialized successfully');
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return;
      console.error('[FolderManager] Initialization error:', error);
    }
  }

  /** The plugin's `hideFiledChats` setting: Gemini's "hide archived" switch. */
  setHideArchived(hide: boolean): void {
    if (hide === this.hideArchivedConversations) return;
    this.hideArchivedConversations = hide;
    folderDebug('Hide archived setting changed:', hide);
    this.applyHideArchivedSetting();
    this.hideArchivedNudge.onHideArchivedChanged();
  }

  /** Removes everything this view added, lands a pending edit, and detaches from the session. */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.batchDelete?.destroy();
    this.batchDelete = null;
    for (const cleanup of this.lifetimeCleanup.splice(0)) cleanup();
    this.selection.reset();
    // Another view binds these rows when the folders come back; this one's must be gone.
    this.selection.releaseNativeRows();
    this.treeView.unmount();
    this.navigation.destroy();
    this.session.flush();
    this.session.stopActivity();
    this.sidebarRuntime.stop();
    this.paginationNudge.cancel();
    // With the folders off nothing would show the native rows hide-filed hid.
    this.hideArchivedConversations = false;
    this.applyHideArchivedSetting();
    this.session.detach(this.view);
    this.feedback.destroy();
    removePageSheets();
  }

  private attachBatchDelete(): void {
    this.batchDelete ??= geminiBatchDeleteService.register({
      runtime: this.sidebarRuntime,
      toolbar: { host: () => this.sidebarRuntime.panel, placement: 'floating', icon: ligatureIcon },
      activation: () => this.session.activation,
      menus: this.nativeConversationMenus,
      feedback: this.feedback,
      getContext: () => ({
        isDestroyed: this.isDestroyed,
        accountIsolationEnabled: this.session.accountIsolationEnabled,
      }),
      onEnter: () => this.selection.reset(),
      onExit: () => this.navigation.highlightActiveConversation(),
    });
  }

  private async loadSettings(): Promise<void> {
    // Off by default: users flip it from the popup to use a floating panel instead.
    const floatingMode = await readFloatingModeSetting();
    if (floatingMode) {
      this.floatingModeEnabled = floatingMode.enabled;
      this.floatingOpenOnStart = floatingMode.openOnStart;
    }
    // The nudge flag first, so a hide-archived switch already on marks it shown.
    await this.hideArchivedNudge.load();
    this.hideArchivedNudge.markShownIfFeatureKnown();
    await this.sidebarRuntime.loadAnchor();
    await this.treeView.loadSettings();
  }

  private setupStorageListener(): void {
    const removeListener = listenForGeminiFolderSettings({
      isDestroyed: () => this.isDestroyed,
      onAnyChange: (changes, areaName) => this.treeView.applySettings(changes, areaName),
      onFloatingOpenOnStart: (openOnStart) => {
        this.floatingOpenOnStart = openOnStart;
      },
      onFloatingMode: (enabled) => {
        if (enabled === this.floatingModeEnabled) return;
        this.floatingModeEnabled = enabled;
        void this.sidebarRuntime.start(enabled ? 'floating' : 'sidebar', this.floatingOpenOnStart);
      },
      onHideArchivedNudgeShown: (shown) => this.hideArchivedNudge.onShownChanged(shown),
      // Re-anchor the panel without a full reinit, as `toggleFolderAnchor` does in this tab.
      onAnchor: (value) => this.sidebarRuntime.setAnchor(value),
    });
    this.lifetimeCleanup.push(removeListener);
    // Relabel once the new language has loaded, not when storage changes.
    this.lifetimeCleanup.push(onCachedLanguageChange(() => this.treeView.refreshLanguage()));
  }

  private handleStoreChange(reason: FolderStoreChange): void {
    if (this.isDestroyed) return;
    this.treeView.updateAvailability();
    this.floatingUI.updateAvailability();
    if (reason === 'account') {
      this.resetForAccountChange();
    } else if (reason === 'data') {
      this.refresh();
      this.floatingUI.handle?.update(this.session.data, this.treeView.sortMode);
    } else if (reason === 'title') {
      this.treeView.render();
    } else if (reason === 'activity') {
      if (this.treeView.viewMode === 'activity') this.refresh();
    } else {
      this.floatingUI.handle?.update(this.session.data, this.treeView.sortMode);
    }
  }

  private resetForAccountChange(): void {
    this.batchDelete?.reset();
    this.nativeSidebarObserver.clearTitleSync();
    this.treeView.clearRenderContext();
    this.navigation.cancel();
    this.dialogs.closeAll();
    this.headerMenus.close();
    this.transfer.closeImportDialog();
    this.selection.reset();
    this.treeView.render();
    this.floatingUI.handle?.reset(this.session.data, this.treeView.sortMode);
    this.applyHideArchivedSetting();
  }

  private refresh(): void {
    if (!this.sidebarRuntime.panel) return;
    this.treeView.render();
    this.applyHideArchivedSetting();
    void this.commands.run({ kind: 'flushNativeTitles' });
  }

  private applyHideArchivedSetting(): void {
    this.archivedRows.applyAll(getNativeConversationElements(this.sidebarRuntime.sidebar));
  }
}
