import type browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import type { FolderCommands } from '@/features/folder/commands/folderCommands';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';
import { setAccountUnknownNotice } from '@/features/plugins/verbs/folders/accountNotice';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import type { FolderFeedback } from './FolderFeedback';
import type { FolderNavigation } from './FolderNavigation';
import type { FolderSelection } from './FolderSelection';
import type { FolderSidebarRuntime } from './FolderSidebarRuntime';
import type { FolderTransferController } from './FolderTransferController';
import type { FolderViewMode } from './activityView';
import type { FolderDialogs } from './folderDialogs';
import type { createFolderHeaderMenus } from './headerMenus';
import {
  buildNativeConversationTitleMap,
  lookupNativeConversationTitle,
} from './nativeConversationTitles';
import type { GeminiFolderReads } from './session/geminiFolderSession';
import { SidebarActivityList, ensureActivityListStyle } from './sidebarActivityList';
import { type SidebarDropContext, bindRootDropZone } from './sidebarDrops';
import { type FolderSearchCriteria, createSidebarFilter, searchCriteriaOf } from './sidebarFilter';
import {
  applyCollapsedState,
  applyUserFilterButtonState,
  applyViewModeState,
  createSidebarHeader,
  refreshHeaderLanguage,
} from './sidebarHeader';
import {
  type SidebarPrefs,
  clampFolderTreeIndent,
  defaultSidebarPrefs,
  loadSidebarPrefs,
  persistPref,
  toSortMode,
  toViewMode,
} from './sidebarPrefs';
import { type FolderSearchBox, createFolderSearch } from './sidebarSearch';
import { type SidebarTree, type SidebarTreeView, mountSidebarTree } from './sidebarTree';
import type { ConversationReference } from './types';

interface FolderSidebarViewOptions {
  store: GeminiFolderReads;
  commands: FolderCommands;
  runtime: FolderSidebarRuntime;
  selection: FolderSelection;
  navigation: FolderNavigation;
  feedback: FolderFeedback;
  dialogs: FolderDialogs;
  transfer: FolderTransferController;
  headerMenus: ReturnType<typeof createFolderHeaderMenus>;
  getContext(): { enabled: boolean; hideArchivedConversations: boolean; isDestroyed: boolean };
  onRefresh(): void;
  onRenameNative(conversation: ConversationReference): Promise<boolean>;
  onSortModeChange(mode: ConversationSortMode): void;
}

type FilterKey = { search: string; currentUserOnly: boolean };

/**
 * Gemini's folder section: its header, search, the shared folder tree or the
 * activity list, and the section's own preferences.
 */
export class FolderSidebarView {
  private prefs: SidebarPrefs = defaultSidebarPrefs();
  private searchQuery = '';
  private search: FolderSearchBox | null = null;
  private tree: SidebarTree | null = null;
  /** Another account's data arrived: the next render starts the tree over. */
  private resetPending = false;
  private filter: { key: FilterKey; value: SidebarTreeView['filter'] } | null = null;
  private readonly activity: SidebarActivityList;
  private readonly drops: SidebarDropContext;

  constructor(private readonly options: FolderSidebarViewOptions) {
    this.drops = {
      store: options.store,
      commands: options.commands,
      rootBucketId: ROOT_CONVERSATIONS_ID,
      feedback: options.feedback,
      sortMode: () => this.prefs.conversationSortMode,
      conversationIdentity: FOLDER_SITE_POLICIES.gemini,
      finish: () => options.selection.finishDrop(),
    };
    this.activity = new SidebarActivityList({
      store: options.store,
      commands: options.commands,
      navigation: options.navigation,
      feedback: options.feedback,
      dialogs: options.dialogs,
      onRenameNative: (conversation) => options.onRenameNative(conversation),
      onExpire: () => {
        if (options.getContext().isDestroyed || this.prefs.folderViewMode !== 'activity') return;
        options.onRefresh();
      },
    });
  }

  get sortMode(): ConversationSortMode {
    return this.prefs.conversationSortMode;
  }
  get viewMode(): FolderViewMode {
    return this.prefs.folderViewMode;
  }

  async loadSettings(): Promise<void> {
    this.prefs = await loadSidebarPrefs();
  }

  mount(): void {
    const panel = this.options.runtime.panel;
    if (!panel) return;
    applyCollapsedState(panel, this.prefs.foldersCollapsed);
    applyViewModeState(panel, this.prefs.folderViewMode === 'activity');
    this.tree?.refreshSite();
  }

  updateAvailability(panel = this.options.runtime.panel): void {
    if (!panel) return;
    const { canEdit } = this.options.store;
    const accountUnknown = this.options.store.accountUnknown === true;
    const ready = canEdit && !accountUnknown;
    // An unreadable account control is no load in progress: the panel says why it is empty.
    panel.inert = !ready && !accountUnknown;
    panel.setAttribute('aria-busy', String(!ready && !accountUnknown));
    panel
      .querySelectorAll<HTMLButtonElement>('.gv-folder-header-actions button')
      .forEach((button) => {
        button.disabled = !ready;
      });
    const search = panel.querySelector<HTMLElement>(':scope > .gv-folder-search');
    if (search) search.inert = accountUnknown;
    setAccountUnknownNotice(
      panel,
      'gv-folder-list',
      accountUnknown ? t('folder_account_unknown') : null,
    );
  }

  /** The panel is going away: stop timers and drop the tree, which remounts with the panel. */
  unmount(): void {
    this.search?.cancel();
    this.activity.clear();
    this.options.dialogs.closeInline();
    this.tree?.destroy();
    this.tree = null;
  }

  /** Another account's data: forget per-account view state before the next render. */
  clearRenderContext(): void {
    this.search?.cancel();
    this.activity.clear();
    this.options.dialogs.closeInline();
    this.resetPending = true;
    applyUserFilterButtonState(
      this.options.runtime.panel,
      this.prefs.filterCurrentUserOnly,
      this.options.store.accountIsolationEnabled,
    );
  }

  /** The open conversation or the folder selection changed: mark rows again. */
  refreshSite(): void {
    this.tree?.refreshSite();
  }

  applySettings(changes: Record<string, browser.Storage.StorageChange>, area: string): void {
    const change = (key: string) => changes[key];
    if (area === 'sync') {
      if (change(StorageKeys.GV_FOLDER_TREE_INDENT)) {
        const indent = clampFolderTreeIndent(change(StorageKeys.GV_FOLDER_TREE_INDENT).newValue);
        if (indent !== this.prefs.folderTreeIndent) {
          this.prefs.folderTreeIndent = indent;
          this.tree?.refreshSite();
        }
      }
      if (change(StorageKeys.FOLDER_SEARCH_ENABLED))
        this.applySearchEnabled(change(StorageKeys.FOLDER_SEARCH_ENABLED).newValue);
      if (change(StorageKeys.FOLDER_PROJECT_ENABLED))
        this.prefs.folderProjectEnabled =
          change(StorageKeys.FOLDER_PROJECT_ENABLED).newValue === true;
      if (change(StorageKeys.FOLDER_CONVERSATION_SORT_MODE))
        this.applySortMode(change(StorageKeys.FOLDER_CONVERSATION_SORT_MODE).newValue);
    }
    if (area === 'local' && change(StorageKeys.FOLDERS_COLLAPSED)) {
      const next = change(StorageKeys.FOLDERS_COLLAPSED).newValue === true;
      if (next !== this.prefs.foldersCollapsed) this.setCollapsed(next);
    }
    if (area === 'local' && change(StorageKeys.FOLDERS_VIEW_MODE)) {
      const next = toViewMode(change(StorageKeys.FOLDERS_VIEW_MODE).newValue);
      if (next !== this.prefs.folderViewMode) {
        this.prefs.folderViewMode = next;
        this.mount();
        this.options.onRefresh();
      }
    }
  }

  createPanel(): HTMLElement {
    ensureActivityListStyle();
    const panel = document.createElement('div');
    panel.className = 'gv-folder-container';
    panel.appendChild(this.options.selection.createMultiSelectIndicator());

    const header = createSidebarHeader({
      headerMenus: this.options.headerMenus,
      transfer: this.options.transfer,
      filterCurrentUserOnly: this.prefs.filterCurrentUserOnly,
      accountIsolationEnabled: this.options.store.accountIsolationEnabled,
      onToggleCollapsed: () => this.toggleCollapsed(),
      onToggleViewMode: () => this.toggleViewMode(),
      onToggleUserFilter: () => this.toggleUserFilter(),
      onOpenSettings: (event) =>
        this.options.headerMenus.openSettings(event, this.prefs.conversationSortMode, (mode) =>
          this.setSortMode(mode),
        ),
      onCreateFolder: () => this.createFolder(),
    });
    bindRootDropZone(header, this.drops);
    panel.appendChild(header);

    if (this.prefs.folderSearchEnabled) panel.appendChild(this.createSearch().element);
    panel.appendChild(this.createList());
    this.updateAvailability(panel);
    return panel;
  }

  render(): void {
    const panel = this.options.runtime.panel;
    const existing = panel?.querySelector('.gv-folder-list');
    if (!existing) return;
    const activityMode = this.prefs.folderViewMode === 'activity';
    if (activityMode || !this.tree || existing.classList.contains('gv-folder-activity-list')) {
      this.options.dialogs.closeInline();
      existing.replaceWith(this.createList());
      this.updateAvailability(panel);
    } else {
      this.showTree();
    }
    // Activity rows are page DOM, marked by navigation like before.
    this.options.navigation.highlightActiveConversation();
  }

  refreshLanguage(): void {
    const panel = this.options.runtime.panel;
    if (!panel) return;
    refreshHeaderLanguage(panel);
    this.mount();
    this.search?.refreshLanguage();
    // Notebooks corner swap toggle is mounted on the Notebooks section, not
    // inside our container — refresh its tooltip in the now-current locale.
    this.options.runtime.refreshLanguage();
    // The tree reads its labels on each render; activity rows are rebuilt.
    if (this.prefs.folderViewMode === 'activity') this.options.onRefresh();
  }

  private createSearch(): FolderSearchBox {
    this.search?.cancel();
    this.search = createFolderSearch({
      query: () => this.searchQuery,
      setQuery: (query) => {
        this.searchQuery = query;
      },
      folderOnly: () => this.searchCriteria()?.mode === 'folder',
      hintSeen: () => this.prefs.folderOnlySearchHintSeen,
      markHintSeen: () => {
        this.prefs.folderOnlySearchHintSeen = true;
      },
      onSearch: () => this.options.onRefresh(),
    });
    return this.search;
  }

  /** The folder list: the tree, or the activity list in activity mode. */
  private createList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'gv-folder-list';
    bindRootDropZone(list, this.drops);
    this.tree?.destroy();
    this.tree = null;
    if (this.prefs.folderViewMode === 'activity') {
      list.classList.add('gv-folder-activity-list');
      return this.activity.populate(list, this.searchCriteria(), this.prefs.filterCurrentUserOnly);
    }
    this.activity.clear();
    this.tree = mountSidebarTree({
      store: this.options.store,
      commands: this.options.commands,
      navigation: this.options.navigation,
      selection: this.options.selection,
      dialogs: this.options.dialogs,
      feedback: this.options.feedback,
      drops: this.drops,
      view: () => this.treeView(),
      onRenameNative: (conversation) => this.options.onRenameNative(conversation),
    });
    list.appendChild(this.tree.host);
    this.resetPending = false;
    this.showTree();
    return list;
  }

  private showTree(): void {
    if (!this.tree) return;
    this.syncNativeTitles();
    if (this.resetPending) this.tree.reset();
    else this.tree.render();
    this.resetPending = false;
  }

  private treeView(): SidebarTreeView {
    const search = this.searchCriteria();
    const key: FilterKey = {
      search: search ? `${search.mode}:${search.query}` : '',
      currentUserOnly: this.prefs.filterCurrentUserOnly,
    };
    if (
      !this.filter ||
      this.filter.key.search !== key.search ||
      this.filter.key.currentUserOnly !== key.currentUserOnly
    ) {
      const value = createSidebarFilter(
        { search, currentUserOnly: key.currentUserOnly },
        () => this.options.store.data,
      );
      this.filter = { key, value };
    }
    return {
      sortMode: this.prefs.conversationSortMode,
      searching: !!search,
      filter: this.filter.value,
      projectEnabled: this.prefs.folderProjectEnabled,
      indent: this.prefs.folderTreeIndent,
    };
  }

  /**
   * Shows Gemini's own titles for chats the user has not renamed. One lookup
   * table per render, not a sidebar scan per chat; searches and hidden native
   * lists skip it. The store saves the buffered titles when the refresh flushes.
   */
  private syncNativeTitles(): void {
    if (this.options.getContext().hideArchivedConversations || this.searchCriteria()) return;
    const lookup = buildNativeConversationTitleMap();
    if (lookup.size === 0) return;
    for (const [folderId, list] of Object.entries(this.options.store.data.folderContents)) {
      for (const [index, conversation] of list.entries()) {
        if (conversation.customTitle) continue;
        const synced = lookupNativeConversationTitle(lookup, conversation.conversationId);
        if (synced && synced !== conversation.title) {
          void this.options.commands.run({
            kind: 'bufferNativeTitle',
            folderId,
            index,
            title: synced,
          });
        }
      }
    }
  }

  private searchCriteria(): FolderSearchCriteria | null {
    return this.prefs.folderSearchEnabled ? searchCriteriaOf(this.searchQuery) : null;
  }

  private createFolder(): void {
    if (this.tree) {
      this.tree.startCreateFolder();
      return;
    }
    // The activity list has no tree to type a name into.
    this.options.dialogs.openCreate(
      this.options.runtime.panel?.querySelector<HTMLElement>('.gv-folder-list') ?? null,
      null,
      (name) => {
        void this.options.commands.run({
          kind: 'createFolder',
          folderId: crypto.randomUUID(),
          name,
          parentId: null,
        });
      },
    );
  }

  private setCollapsed(collapsed: boolean): void {
    this.prefs.foldersCollapsed = collapsed;
    const panel = this.options.runtime.panel;
    if (panel) applyCollapsedState(panel, collapsed);
  }

  private toggleCollapsed(): void {
    this.setCollapsed(!this.prefs.foldersCollapsed);
    persistPref('local', { [StorageKeys.FOLDERS_COLLAPSED]: this.prefs.foldersCollapsed });
  }

  private toggleViewMode(): void {
    const next = this.prefs.folderViewMode === 'activity' ? 'folders' : 'activity';
    this.prefs.folderViewMode = next;
    const update: Record<string, unknown> = { [StorageKeys.FOLDERS_VIEW_MODE]: next };
    if (next === 'activity' && this.prefs.foldersCollapsed) {
      this.setCollapsed(false);
      update[StorageKeys.FOLDERS_COLLAPSED] = false;
    }
    this.mount();
    this.options.onRefresh();
    persistPref('local', update);
  }

  private toggleUserFilter(): void {
    this.prefs.filterCurrentUserOnly = !this.prefs.filterCurrentUserOnly;
    persistPref('sync', {
      [StorageKeys.GV_FOLDER_FILTER_USER_ONLY]: this.prefs.filterCurrentUserOnly,
    });
    applyUserFilterButtonState(
      this.options.runtime.panel,
      this.prefs.filterCurrentUserOnly,
      this.options.store.accountIsolationEnabled,
    );
    this.options.onRefresh();
  }

  private applySearchEnabled(value: unknown): void {
    const next = value !== false;
    if (next === this.prefs.folderSearchEnabled) return;
    this.prefs.folderSearchEnabled = next;
    if (!next) this.searchQuery = '';
    const panel = this.options.runtime.panel;
    if (!panel) return;
    panel.querySelector('.gv-folder-search')?.remove();
    this.search?.cancel();
    this.search = null;
    if (next)
      panel.insertBefore(this.createSearch().element, panel.querySelector('.gv-folder-list'));
    this.options.onRefresh();
  }

  private applySortMode(value: unknown): void {
    const next = toSortMode(value);
    if (next === this.prefs.conversationSortMode) return;
    this.prefs.conversationSortMode = next;
    this.options.onRefresh();
    this.options.onSortModeChange(next);
  }

  private setSortMode(mode: ConversationSortMode): void {
    this.applySortMode(mode);
    persistPref('sync', { [StorageKeys.FOLDER_CONVERSATION_SORT_MODE]: mode });
  }
}
