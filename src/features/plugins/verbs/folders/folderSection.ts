/**
 * The folder tree as a section of a site's own sidebar, just before the anchor
 * the site names (ChatGPT's: Recents). It reuses the floating panel's tree and
 * sheet inside its own shadow host, styled by the site's sheet. The site's app
 * may drop it on any re-render or remount the whole sidebar; `place` puts it
 * back and is called after every sidebar change. While the sidebar or the
 * anchor is missing it stays out of the page and the plugin offers the
 * floating panel's button instead.
 */
import type { FolderData } from '@/core/types/folder';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import { hasSeenCoachmark } from '@/pages/content/coachmark';
import { FLOATING_PANEL_CSS as panelCss } from '@/pages/content/folder/floatingPanelCss';
import {
  type FolderDropTarget,
  folderDropTargetAt,
} from '@/pages/content/folder/floatingTree/dropTargets';
import {
  FLOATING_PANEL_CLASS,
  FOLDER_TOGGLE_DELAY_MS,
  type TreeActions,
  type TreeSiteOptions,
} from '@/pages/content/folder/floatingTree/shared';
import {
  type FolderTreeController,
  mountFolderTree,
} from '@/pages/content/folder/floatingTree/treeController';
import { INLINE_TREE_ATTR } from '@/pages/content/folder/floatingTree/treeStyle';
import { applyFolderDisplay } from '@/pages/content/folder/folderDisplay';
import { FOLDER_HEADER_CSS } from '@/pages/content/folder/folderHeader/folderHeader';
import type { FolderHeaderActionsOptions } from '@/pages/content/folder/folderHeader/folderHeaderActions';
import { closeFolderHeaderMenu } from '@/pages/content/folder/folderHeader/folderHeaderMenu';
import { type ShadowSurface, attachShadowSurface } from '@/pages/content/folder/shadowHost';
import {
  ACTIVITY_LIST_CSS,
  SidebarActivityList,
  type SidebarActivityListOptions,
} from '@/pages/content/folder/sidebarActivityList';
import {
  type FolderSearchCriteria,
  createSidebarFilter,
  searchAndSortOptions,
  searchCriteriaOf,
} from '@/pages/content/folder/sidebarFilter';
import { FOLDER_ONLY_SEARCH_HINT_ID } from '@/pages/content/folder/sidebarPrefs';
import { type FolderSearchBox, createFolderSearch } from '@/pages/content/folder/sidebarSearch';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import {
  createSectionHeader,
  setSectionHeaderReady,
  showSectionHeaderPrefs,
} from './sectionHeader';
import type { SiteFolderSectionPrefs } from './sectionPrefs';
import { treeSiteOf } from './treeSite';
import type { SectionSite } from './types';

/**
 * Gemini's folder sidebar drawn in the site's line-icon style: chevrons, tinted
 * folder icons, a menu button on each folder, and the same drags.
 */
function baseTreeSite(site: SectionSite): TreeSiteOptions {
  return {
    lineIcons: true,
    // No per-folder count, as in Gemini's sidebar.
    hideFolderCount: true,
    // Keep hover/focus row actions from squeezing the name editor.
    renameFillsRow: true,
    folderMenuButton: { labelKey: 'folder_settings' },
    folderBodyDrop: true,
    folderDrag: true,
    conversationHref: site.conversationHref,
    folderToggleDelayMs: FOLDER_TOGGLE_DELAY_MS,
    conversationIdentity: site.policy,
    ...treeSiteOf(site.tree),
  };
}

export type SiteFolderSectionOptions = {
  /** The site's class, sheet, anchor, links and identity policy. */
  site: SectionSite;
  data: FolderData;
  rootBucketId: string;
  actions: TreeActions;
  /** The header's import/export and cloud menus. */
  transfer: FolderHeaderActionsOptions['transfer'];
  cloud: FolderHeaderActionsOptions['cloud'];
  prefs: SiteFolderSectionPrefs;
  /** The section was collapsed, its conversation order changed, or it switched views. */
  onPrefsChange: (prefs: SiteFolderSectionPrefs) => void;
  /** Long-press multi-select: its toolbar, shown atop the tree, and the rows it holds. */
  selection?: {
    toolbar: HTMLElement;
    isConversationSelected: NonNullable<TreeSiteOptions['isConversationSelected']>;
  };
  /**
   * The Activity view (recent chats by last send) and its bell, offered only
   * where the page records when chats were last sent to.
   */
  activity?: Omit<SidebarActivityListOptions, 'store' | 'onExpire'>;
};

const POINTER_CHECK_EVENTS = ['pointermove', 'pointerdown'] as const;

/** Names the section's runtime on its host, which the site's clones of it carry along. */
const OWNER_ATTR = 'data-gv-folder-section-owner';
let nextOwner = 0;

export class SiteFolderSection {
  readonly element: HTMLElement;
  /** The header row with the section's title: what the one-time guide points at. */
  readonly header: HTMLElement;
  /** Holds the multi-select toolbar and carries the mode class while selecting. */
  readonly selectionBar: HTMLElement;
  private readonly surface: ShadowSurface;
  private readonly body: HTMLElement;
  /** The search box and the tree, hidden while the section is collapsed. */
  private readonly content: HTMLElement;
  private readonly search: FolderSearchBox;
  private readonly tree: FolderTreeController;
  /** The Activity view's rows, shown in place of the tree. */
  private readonly activityBody: HTMLElement;
  private readonly activity: SidebarActivityList | null;
  private readonly onPrefsChange: (prefs: SiteFolderSectionPrefs) => void;
  /** The site's host class, from which every class of the section derives. */
  private readonly className: string;
  private readonly anchorOf: SectionSite['anchor'];
  private readonly baseSite: TreeSiteOptions;
  private readonly isConversationSelected: TreeSiteOptions['isConversationSelected'];
  private readonly stopDisplay: () => void;
  private readonly owner = String(++nextOwner);
  private activeConversationId: string | null = null;
  private data: FolderData;
  private prefs: SiteFolderSectionPrefs;
  private searchQuery = '';
  private searchHintSeen = false;
  private filter: TreeSiteOptions['filter'];
  private pointerInside = false;
  private stopPointerCheck: (() => void) | null = null;
  /** `data` holds open times the tree has not laid out yet. */
  private layoutHeld = false;

  constructor({
    site,
    data,
    rootBucketId,
    actions,
    transfer,
    cloud,
    prefs,
    onPrefsChange,
    selection,
    activity,
  }: SiteFolderSectionOptions) {
    const className = site.className;
    this.className = className;
    this.anchorOf = site.anchor;
    this.baseSite = baseTreeSite(site);
    this.data = data;
    this.isConversationSelected = selection?.isConversationSelected;
    this.prefs = { ...prefs };
    this.onPrefsChange = onPrefsChange;
    this.element = document.createElement('div');
    this.element.className = className;
    this.element.setAttribute(OWNER_ATTR, this.owner);
    this.element.setAttribute(INLINE_TREE_ATTR, '');
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', t('floatingPanelTitle'));
    this.element.addEventListener('pointerenter', () => (this.pointerInside = true));
    this.element.addEventListener('pointerleave', () => this.pointerLeft());

    const header = createSectionHeader({
      sectionClass: className,
      activity: activity ? { pressed: this.prefs.viewMode === 'activity' } : null,
      transfer,
      cloud,
      sortMode: () => this.prefs.sortMode,
      onToggleCollapsed: () => this.setPrefs({ collapsed: !this.prefs.collapsed }),
      onToggleActivity: () =>
        this.prefs.viewMode === 'activity'
          ? this.setPrefs({ viewMode: 'folders' })
          : this.setPrefs({ viewMode: 'activity', collapsed: false }),
      onSortModeChange: (sortMode) => this.setPrefs({ sortMode }),
      onCreate: () => {
        // The new folder's name is typed into the tree.
        if (this.prefs.collapsed || this.activityMode)
          this.setPrefs({ collapsed: false, viewMode: 'folders' });
        this.tree.apply({
          inlineEditor: { mode: 'create', parentId: null },
          contextMenu: null,
        });
      },
    });
    this.header = header;

    this.search = createFolderSearch({
      query: () => this.searchQuery,
      setQuery: (query) => (this.searchQuery = query),
      folderOnly: () => this.searchCriteria()?.mode === 'folder',
      hintSeen: () => this.searchHintSeen,
      markHintSeen: () => (this.searchHintSeen = true),
      onSearch: () => this.applySearch(),
    });
    void hasSeenCoachmark(FOLDER_ONLY_SEARCH_HINT_ID).then((seen) => {
      this.searchHintSeen ||= seen;
      this.search.refreshLanguage();
    });

    this.body = document.createElement('div');
    this.body.className = `${FLOATING_PANEL_CLASS}__body`;
    this.content = document.createElement('div');
    this.content.className = `${className}__content`;
    this.selectionBar = document.createElement('div');
    this.selectionBar.className = `${className}__selection`;
    if (selection) this.selectionBar.append(selection.toolbar);
    this.activityBody = document.createElement('div');
    this.activityBody.className = 'gv-folder-activity-list';
    this.content.append(this.search.element, this.selectionBar, this.body, this.activityBody);
    const currentData = () => this.data;
    this.activity = activity
      ? new SidebarActivityList({
          ...activity,
          store: {
            get data() {
              return currentData();
            },
          },
          onExpire: () => this.showView(),
        })
      : null;

    const css = `${panelCss}\n${FOLDER_HEADER_CSS}\n${ACTIVITY_LIST_CSS}\n${site.css}`;
    this.surface = attachShadowSurface(this.element, css);
    this.surface.root.append(header, this.content);
    // Gemini's font size, spacing and indent, which the section's sheet reads from its host.
    this.stopDisplay = applyFolderDisplay(this.element);

    // The sidebar scrolls and clips, so the folder menu renders in a body-level layer.
    this.tree = mountFolderTree({
      body: this.body,
      boundary: this.element,
      focusRoot: this.surface.root,
      data,
      rootBucketId,
      conversationSortMode: this.prefs.sortMode,
      actions: actions.onRenameConversation
        ? {
            ...actions,
            onConversationMenu: (e, conversation) =>
              this.tree.apply({
                inlineEditor: null,
                contextMenu: { conversation, x: e.clientX, y: e.clientY },
              }),
          }
        : actions,
      site: this.site(),
      popoverLayer: { css },
    });
    this.showPrefs();
  }

  /** The conversation order the tree shows, for drops that place by position. */
  get sortMode(): ConversationSortMode {
    return this.prefs.sortMode;
  }

  /**
   * Puts the section just before the site's anchor in `sidebar`, unless it is
   * already there. Drops copies the site may have cloned along with its own
   * nodes; another runtime's section (a successor starting while this one
   * stops) is not a copy and stays.
   */
  place(sidebar: HTMLElement | null): void {
    if (!sidebar) return;
    for (const copy of sidebar.querySelectorAll(
      `.${this.className}[${OWNER_ATTR}="${this.owner}"]`,
    )) {
      if (copy !== this.element) copy.remove();
    }
    // A section dropped while hovered never hears `pointerleave`, which froze the recent order.
    if (!this.element.isConnected && this.pointerInside) this.recheckPointer();
    const anchor = this.anchorOf(sidebar);
    const parent = anchor?.parentElement;
    if (!anchor || !parent) {
      this.element.remove();
      return;
    }
    if (this.element.parentElement === parent && this.element.nextElementSibling === anchor) {
      // Reinserting here would wake our sidebar watcher forever.
      return;
    }
    parent.insertBefore(this.element, anchor);
  }

  /**
   * After a remount, the next pointer event says where the pointer is. Unfreezing at
   * once would move rows under a double-click whose first click made the site re-render.
   */
  private recheckPointer(): void {
    if (this.stopPointerCheck) return;
    const doc = this.element.ownerDocument;
    const check = (event: Event): void => {
      stop();
      if (!(event.target instanceof Node) || !this.element.contains(event.target)) {
        this.pointerLeft();
      }
    };
    const stop = (): void => {
      for (const type of POINTER_CHECK_EVENTS) doc.removeEventListener(type, check, true);
      this.stopPointerCheck = null;
    };
    for (const type of POINTER_CHECK_EVENTS) doc.addEventListener(type, check, true);
    this.stopPointerCheck = stop;
  }

  /** The pointer is off the section: rows held for it take their new order. */
  private pointerLeft(): void {
    this.pointerInside = false;
    if (this.layoutHeld) this.update(this.data);
  }

  update(data: FolderData): void {
    this.data = data;
    this.layoutHeld = false;
    this.tree.update(data);
    if (this.activityMode) this.showView();
  }

  /**
   * New data in which only open or send times changed. While the pointer is
   * over the section the rows stay put: opening a chat on a double-click's
   * first click would otherwise move another chat under its second. The recent
   * order and the Activity view catch up once the pointer leaves, as Gemini's
   * do on their next render.
   */
  updateOpened(data: FolderData): void {
    if (!this.pointerInside) {
      this.update(data);
      return;
    }
    this.data = data;
    this.layoutHeld = true;
  }

  /** Marks the rows of the conversation the page has open (its stored id), or none. */
  setActiveConversation(conversationId: string | null): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    this.tree.setSite(this.site());
  }

  /** The selection changed: rows show whether they are selected again. */
  refreshSelection(): void {
    this.tree.setSite(this.site());
  }

  setDataReady(ready: boolean): void {
    this.body.inert = !ready;
    this.body.setAttribute('aria-busy', String(!ready));
    this.activityBody.inert = !ready;
    setSectionHeaderReady(this.header, this.className, ready);
  }

  /** True while the section's own folder menu or name field is open. */
  get busy(): boolean {
    return this.tree.busy();
  }

  /** The folder drop target under a viewport point, for a drag driven by pointer events. */
  dropTargetAt(x: number, y: number): FolderDropTarget | null {
    return folderDropTargetAt(this.surface.root, x, y);
  }

  destroy(): void {
    this.stopPointerCheck?.();
    this.activity?.clear();
    closeFolderHeaderMenu();
    this.stopDisplay();
    this.search.cancel();
    this.tree.destroy();
    this.surface.disconnect();
    this.element.remove();
  }

  private site(): TreeSiteOptions {
    return {
      ...this.baseSite,
      ...searchAndSortOptions(this.searchCriteria() !== null, this.prefs.sortMode),
      filter: this.filter,
      activeConversationId: this.activeConversationId,
      isConversationSelected: this.isConversationSelected,
    };
  }

  /** The Activity view is offered and chosen. */
  private get activityMode(): boolean {
    return !!this.activity && this.prefs.viewMode === 'activity';
  }

  /** Shows the tree, or redraws the Activity view in its place. */
  private showView(): void {
    const activity = this.activityMode;
    this.body.hidden = activity;
    this.activityBody.hidden = !activity;
    this.activityBody.replaceChildren();
    if (activity) this.activity!.populate(this.activityBody, this.searchCriteria(), false);
    else this.activity?.clear();
  }

  private searchCriteria(): FolderSearchCriteria | null {
    return searchCriteriaOf(this.searchQuery);
  }

  /** Filters the tree by the search box once typing pauses. */
  private applySearch(): void {
    const search = this.searchCriteria();
    this.filter = search
      ? createSidebarFilter({ search, currentUserOnly: false }, () => this.data)
      : undefined;
    this.tree.setSite(this.site());
    if (this.activityMode) this.showView();
  }

  private setPrefs(change: Partial<SiteFolderSectionPrefs>): void {
    const sortChanged = change.sortMode !== undefined && change.sortMode !== this.prefs.sortMode;
    const viewChanged = change.viewMode !== undefined && change.viewMode !== this.prefs.viewMode;
    this.prefs = { ...this.prefs, ...change };
    this.showPrefs(viewChanged);
    if (sortChanged) {
      this.layoutHeld = false;
      this.tree.setSite(this.site());
      this.tree.update(this.data, this.prefs.sortMode);
    }
    this.onPrefsChange({ ...this.prefs });
  }

  /** `redraw`: the view changed, so the tree or the Activity view is shown anew. */
  private showPrefs(redraw = true): void {
    const { collapsed } = this.prefs;
    this.content.hidden = collapsed;
    showSectionHeaderPrefs(this.header, this.className, collapsed, this.activityMode);
    if (redraw) this.showView();
  }
}
