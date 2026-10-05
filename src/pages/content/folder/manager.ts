import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { isSaved } from '@/features/folder/commands/folderCommands';
import { initI18n } from '@/utils/i18n';

import { FolderFeedback } from './FolderFeedback';
import { FolderNavigation } from './FolderNavigation';
import { FolderSelection } from './FolderSelection';
import { FolderSidebarRuntime } from './FolderSidebarRuntime';
import { FolderSidebarView } from './FolderSidebarView';
import { FolderStore, type FolderStoreChange } from './FolderStore';
import { FolderTransferController } from './FolderTransferController';
import { NativeConversationMenus } from './NativeConversationMenus';
import { NativeSidebarObserver } from './NativeSidebarObserver';
import { FloatingFolderUI } from './floatingFolderUI';
import { resolveConversationRouteId } from './folderConversationIdentity';
import { createFolderDialogs } from './folderDialogs';
import { folderDebug, folderDebugWarn } from './folderManagerDebug';
import {
  listenForFolderSettingChanges,
  migrateLegacySyncMode,
  readFloatingModeSetting,
  readFolderEnabled,
  readHideArchived,
} from './folderManagerSettings';
import { listenForFolderRuntimeMessages } from './folderRuntimeMessages';
import { createFolderHeaderMenus } from './headerMenus';
import { HideArchivedNudgeState } from './hideArchivedNudgeState';
import { createLegacyFolderCommands } from './legacyFolderCommands';
import { NativeArchivedRows } from './nativeArchivedRows';
import { extractNativeConversationTitle } from './nativeConversationTitles';
import { findNativeConversationElement, getNativeConversationElements } from './nativeSidebarDom';
import { ligatureIcon } from './selectionToolbar';
import type { ConversationReference, Folder } from './types';

export class FolderManager {
  private readonly store: FolderStore = new FolderStore({
    getContext: () => ({
      sidebar: this.sidebarRuntime.sidebar,
      sortMode: this.treeView.sortMode,
      enabled: this.folderEnabled,
    }),
    onChange: (reason) => this.handleStoreChange(reason),
    onArchive: () => this.hideArchivedNudge.maybeShow(),
    onRecovery: (result) => this.feedback.showRecoveryNotification(result),
  });
  private readonly commands = createLegacyFolderCommands(this.store);
  private readonly transfer = new FolderTransferController({
    getContext: () => ({
      session: this.store.session,
      activation: this.store.activation,
      data: this.store.data,
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
      accountIsolationEnabled: this.store.accountIsolationEnabled,
    }),
    onRouteChange: () => {
      void this.store.reloadScopedDataOnAccountRouteChange();
    },
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
  private folderEnabled: boolean = true;
  private hideArchivedConversations: boolean = false; // Whether to hide conversations in folders
  // Floating mode (a popup opt-in): never inject into Gemini's sidebar; mount the
  // body-level floating panel (or its FAB) and the native ⋮ menu observer instead.
  private floatingModeEnabled: boolean = false;
  private floatingOpenOnStart: boolean = true;
  private isDestroyed: boolean = false;
  private readonly lifetimeCleanup: Array<() => void> = [];
  private readonly floatingUI = new FloatingFolderUI({
    store: this.store,
    commands: this.commands,
    dialogs: this.dialogs,
    transfer: this.transfer,
    navigation: this.navigation,
    isActive: () => !this.isDestroyed && this.folderEnabled,
    isFloatingMode: () => this.sidebarRuntime.isFloatingMode,
    getSortMode: () => this.treeView.sortMode,
    removeFloatingHost: () => this.selection.removeFloatingHost(),
  });
  private readonly archivedRows = new NativeArchivedRows({
    getSidebar: () => this.sidebarRuntime.sidebar,
    isHidingArchived: () => this.hideArchivedConversations,
    isInFolders: (id, pass) => this.store.isConversationInFolders(id, pass),
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
    hasStoredConversations: () => this.store.hasStoredConversations(),
    onTitlesChanged: async () => {
      await this.commands.run({ kind: 'syncNativeSidebarTitles' });
    },
  });
  private readonly nativeConversationMenus: NativeConversationMenus = new NativeConversationMenus({
    getContext: () => ({
      sidebar: this.sidebarRuntime.sidebar,
      storageKey: this.store.storageKey,
      accountIsolationEnabled: this.store.accountIsolationEnabled,
      isDestroyed: this.isDestroyed,
    }),
    onMoveToFolder: ({ id, title, url }, trigger) => {
      if (!this.store.canEdit) return;
      this.dialogs.openMove(
        this.store.data.folders,
        (folderId) => {
          this.addConversationToFolderFromNative(folderId, id, title, url);
        },
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
      this.navigation.highlightActiveConversation();
      this.navigation.bind();
    },
    onPanelUnmount: (reason) => {
      this.selection.unmount();
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
    store: this.store,
    commands: this.commands,
    runtime: this.sidebarRuntime,
    navigation: this.navigation,
    feedback: this.feedback,
    toolbar: {
      host: () => this.sidebarRuntime.panel,
      placement: 'floating',
      icon: ligatureIcon,
    },
    nativeDelete: {
      activation: () => this.store.activation,
      menus: this.nativeConversationMenus,
      feedback: this.feedback,
    },
    onFolderSelectionChange: () => this.treeView.refreshSite(),
    getContext: () => ({
      accountIsolationEnabled: this.store.accountIsolationEnabled,
      isDestroyed: this.isDestroyed,
    }),
  });
  private readonly treeView: FolderSidebarView = new FolderSidebarView({
    store: this.store,
    commands: this.commands,
    runtime: this.sidebarRuntime,
    selection: this.selection,
    navigation: this.navigation,
    feedback: this.feedback,
    dialogs: this.dialogs,
    transfer: this.transfer,
    headerMenus: this.headerMenus,
    getContext: () => ({
      enabled: this.folderEnabled,
      hideArchivedConversations: this.hideArchivedConversations,
      isDestroyed: this.isDestroyed,
    }),
    onRefresh: () => this.refresh(),
    onRenameNative: (conversation) => this.openNativeRenameForFolderConversation(conversation),
    onSortModeChange: (mode) => this.floatingUI.handle?.update(this.store.data, mode),
  });

  constructor() {
    // Initialize i18n system
    initI18n().catch((e) => {
      folderDebugWarn('Failed to initialize i18n:', e);
    });
  }

  async init(): Promise<void> {
    try {
      // Initialize storage adapter (handles migration for Safari automatically)
      await this.store.init();
      if (this.isDestroyed) return;

      await this.loadSettings();
      if (this.isDestroyed) return;

      // Set up storage change listener (always needed to respond to setting changes)
      this.setupStorageListener();

      // Set up message listener (for popup communication)
      this.setupMessageListener();

      // If folder feature is disabled, skip initialization
      if (!this.folderEnabled) {
        folderDebug('Folder feature is disabled, skipping initialization');
        return;
      }

      // Two mounting strategies:
      //  - Floating mode (opt-in): body-level floating panel, skip sidebar.
      //  - Default: inject the folder panel into Gemini's sidebar.
      if (this.floatingModeEnabled) {
        await this.sidebarRuntime.start('floating', this.floatingOpenOnStart);
      } else {
        await this.sidebarRuntime.start('sidebar');
      }

      folderDebug('Initialized successfully');
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        return;
      }
      console.error('[FolderManager] Initialization error:', error);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    for (const cleanup of this.lifetimeCleanup.splice(0)) cleanup();
    this.selection.reset();
    this.treeView.unmount();
    this.navigation.destroy();
    this.sidebarRuntime.stop();
    this.store.destroy();
    this.feedback.destroy();
  }

  private async loadSettings(): Promise<void> {
    this.folderEnabled = await readFolderEnabled();
    if (this.folderEnabled) {
      await this.store.initializeConversationActivityTracking();
    }

    // Load the opt-in "always use floating window" mode. Off by default —
    // users flip it from the popup when they want to skip sidebar injection
    // entirely and work with folders in a floating panel.
    const floatingMode = await readFloatingModeSetting();
    if (floatingMode) {
      this.floatingModeEnabled = floatingMode.enabled;
      this.floatingOpenOnStart = floatingMode.openOnStart;
    }

    // Load hide-archived onboarding nudge flag first, so the hide-archived
    // setting can mark it "shown" if the user already has the feature enabled.
    await this.hideArchivedNudge.load();
    this.hideArchivedConversations = await readHideArchived();
    this.hideArchivedNudge.markShownIfFeatureKnown();

    // Load folder anchor preference (which native section to sit above)
    await this.sidebarRuntime.loadAnchor();
    await this.treeView.loadSettings();
  }

  private teardownMountedFolderRuntime(): void {
    this.selection.reset();
    this.treeView.unmount();
    this.navigation.destroy();
    this.store.flushPendingSaveData();
    this.store.teardownConversationActivityTracking();
    this.sidebarRuntime.stop();
  }

  private async openNativeRenameForFolderConversation(
    conversation: ConversationReference,
  ): Promise<boolean> {
    const conversationId = resolveConversationRouteId(
      conversation.url,
      conversation.conversationId,
    );
    if (!conversationId) return false;

    const conversationEl = findNativeConversationElement(
      this.sidebarRuntime.sidebar,
      conversationId,
    );
    if (!conversationEl) {
      folderDebugWarn('Could not find native conversation element for rename:', conversationId);
      return false;
    }

    const restoreArchivedVisibility = this.archivedRows.reveal(conversationEl);
    const nativeTitle = extractNativeConversationTitle(conversationEl);
    let moreButton: HTMLElement | null = null;

    try {
      moreButton = await this.nativeConversationMenus.findAndClickMoreButton(conversationEl);
      if (!moreButton) {
        folderDebugWarn('Could not find native more button for rename:', conversationId);
        return false;
      }

      const renamed = await this.nativeConversationMenus.waitForRenameButtonAndClick();
      if (!renamed) {
        folderDebugWarn('Could not find native rename button:', conversationId);
      } else {
        await this.commands.run({ kind: 'restoreNativeTitle', conversationId, nativeTitle });
      }
      return renamed;
    } finally {
      if (moreButton) {
        this.nativeConversationMenus.resetNativeConversationMenuTrigger(moreButton);
      }
      restoreArchivedVisibility();
    }
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

  getFolders(): Folder[] {
    return this.store.data.folders;
  }

  async ensureDataLoaded(): Promise<void> {
    await this.store.ensureDataLoaded();
  }

  private handleStoreChange(reason: FolderStoreChange): void {
    if (this.isDestroyed) return;
    this.treeView.updateAvailability();
    this.floatingUI.handle?.setDataReady(this.store.canEdit);
    if (reason === 'account') {
      this.resetForAccountChange();
    } else if (reason === 'data') {
      this.refresh();
      this.floatingUI.handle?.update(this.store.data, this.treeView.sortMode);
    } else if (reason === 'title') {
      this.treeView.render();
    } else if (reason === 'activity') {
      if (this.treeView.viewMode === 'activity') this.refresh();
    } else {
      this.floatingUI.handle?.update(this.store.data, this.treeView.sortMode);
    }
  }

  private resetForAccountChange(): void {
    this.nativeSidebarObserver.clearTitleSync();
    this.treeView.clearRenderContext();
    this.navigation.cancel();
    this.dialogs.closeAll();
    this.headerMenus.close();
    this.transfer.closeImportDialog();
    this.selection.reset();
    this.treeView.render();
    this.floatingUI.handle?.reset(this.store.data, this.treeView.sortMode);
    this.applyHideArchivedSetting();
  }

  private refresh(): void {
    if (!this.sidebarRuntime.panel) return;
    this.treeView.render();
    this.applyHideArchivedSetting();
    void this.commands.run({ kind: 'flushNativeTitles' });
  }

  private setupStorageListener(): void {
    const removeListener = listenForFolderSettingChanges({
      isDestroyed: () => this.isDestroyed,
      onAnyChange: (changes, areaName) => this.treeView.applySettings(changes, areaName),
      onFolderEnabled: (enabled) => {
        this.folderEnabled = enabled;
        folderDebug('Folder enabled setting changed:', enabled);
        this.applyFolderEnabledSetting();
      },
      onFloatingOpenOnStart: (openOnStart) => {
        this.floatingOpenOnStart = openOnStart;
        folderDebug('Floating-mode startup panel setting changed:', openOnStart);
      },
      onFloatingMode: (enabled) => this.applyFloatingModeSetting(enabled),
      onHideArchived: (hide) => {
        this.hideArchivedConversations = hide;
        folderDebug('Hide archived setting changed:', hide);
        this.applyHideArchivedSetting();
        this.hideArchivedNudge.onHideArchivedChanged();
      },
      onHideArchivedNudgeShown: (shown) => this.hideArchivedNudge.onShownChanged(shown),
      // Re-anchor the panel without a full reinit. Mirrors `toggleFolderAnchor`
      // for the cross-tab case.
      onAnchor: (value) => this.sidebarRuntime.setAnchor(value),
    });
    this.lifetimeCleanup.push(removeListener);

    // NOTE: the popup's 'gv.folders.reload' message is handled in
    // setupMessageListener. A second chrome.runtime.onMessage listener here
    // used to double-handle it (double loadData + double render per sync) and
    // its unconditional `return true` left responder-less broadcasts pending
    // forever on the sender side.

    void migrateLegacySyncMode();
  }

  private applyFloatingModeSetting(enabled: boolean): void {
    if (enabled === this.floatingModeEnabled) return;
    this.floatingModeEnabled = enabled;
    folderDebug('Floating-mode toggle changed:', enabled);
    // With the folder feature off there is nothing to swap in or out; the
    // setting is remembered for when the user turns folders back on.
    if (!this.folderEnabled) return;
    void this.sidebarRuntime.start(enabled ? 'floating' : 'sidebar', this.floatingOpenOnStart);
  }

  private applyFolderEnabledSetting(): void {
    if (!this.folderEnabled) {
      folderDebug('Folder feature disabled, tearing down mounted runtime');
      this.teardownMountedFolderRuntime();
      return;
    }
    folderDebug('Folder feature enabled');
    void this.store.initializeConversationActivityTracking();

    if (this.floatingModeEnabled) {
      void this.sidebarRuntime.start('floating', this.floatingOpenOnStart).catch((error) => {
        console.error('[FolderManager] Failed to initialize floating folder UI:', error);
      });
      return;
    }

    if (!this.sidebarRuntime.panel) {
      folderDebug('Folder feature enabled, initializing sidebar UI');
      void this.sidebarRuntime.start('sidebar').catch((error) => {
        console.error('[FolderManager] Failed to initialize folder UI:', error);
      });
    } else {
      this.sidebarRuntime.panel.style.display = '';
    }
  }

  private applyHideArchivedSetting(): void {
    this.archivedRows.applyAll(getNativeConversationElements(this.sidebarRuntime.sidebar));
  }

  private setupMessageListener(): void {
    const removeListener = listenForFolderRuntimeMessages({
      store: this.store,
      refresh: () => this.refresh(),
      getSidebarContext: () => ({
        sidebar: this.sidebarRuntime.sidebar,
        accountIsolationEnabled: this.store.accountIsolationEnabled,
        isDestroyed: this.isDestroyed,
      }),
    });
    this.lifetimeCleanup.push(removeListener);
  }
}
