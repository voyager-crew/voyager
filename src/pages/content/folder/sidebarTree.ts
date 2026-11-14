import { isSaved, type FolderCommands } from '@/features/folder/commands/folderCommands';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import type { FolderFeedback } from './FolderFeedback';
import type { FolderNavigation } from './FolderNavigation';
import type { FolderSelection } from './FolderSelection';
import { createFloatingTreeStoreActions } from './floatingPanelActions';
import { FLOATING_PANEL_CSS as panelCss } from './floatingPanelCss';
import {
  FLOATING_PANEL_CLASS,
  type FolderMenuItem,
  type TreeActions,
  type TreeSiteOptions,
  FOLDER_TOGGLE_DELAY_MS,
} from './floatingTree/shared';
import { mountFolderTree } from './floatingTree/treeController';
import { INLINE_TREE_ATTR } from './floatingTree/treeStyle';
import { normalizeConversationId, resolveConversationRouteId } from './folderConversationIdentity';
import type { FolderDialogs } from './folderDialogs';
import { FOLDER_INDENT_PROPERTY } from './folderDisplay';
import { DEFAULT_CONVERSATION_ICON, getGemIcon } from './gemConfig';
import { getCurrentHexIdFromLocation } from './nativeConversationIds';
import type { GeminiFolderReads } from './session/geminiFolderSession';
import { attachShadowSurface } from './shadowHost';
import { type SidebarDropContext, acceptsSidebarDrag, dropOnSidebar } from './sidebarDrops';
import { searchAndSortOptions } from './sidebarFilter';
import { SIDEBAR_TREE_CSS } from './sidebarTreeCss';
import type { ConversationReference, Folder } from './types';

export const SIDEBAR_TREE_HOST_CLASS = 'gv-folder-tree-host';
/**
 * The open folder chat's title, kept in the page for readers that cannot see
 * into the tree: the timeline title, the export adapter and the PDF exporter
 * all read `.gv-folder-conversation-selected .gv-conversation-title`.
 */
const ACTIVE_TITLE_MARKER_CLASS = 'gv-folder-conversation-selected gv-folder-active-title-marker';

/** What the sidebar shows right now, read on every render. */
export type SidebarTreeView = {
  sortMode: ConversationSortMode;
  searching: boolean;
  filter: TreeSiteOptions['filter'];
  projectEnabled: boolean;
  /**
   * The folder tree indent setting (GV_FOLDER_TREE_INDENT, -8 to 32): added to
   * each nesting level's row padding, as in the old list.
   */
  indent: number;
};

export type SidebarTreeOptions = {
  store: GeminiFolderReads;
  commands: FolderCommands;
  navigation: FolderNavigation;
  selection: FolderSelection;
  dialogs: FolderDialogs;
  feedback: FolderFeedback;
  drops: SidebarDropContext;
  view: () => SidebarTreeView;
  onRenameNative: (conversation: ConversationReference) => Promise<boolean>;
};

export type SidebarTree = {
  /** Insert into the panel; `destroy` removes it. */
  host: HTMLElement;
  /** Shows the store's data and the current view; waits while a folder name is typed. */
  render: () => void;
  /** Another account's data: drops open name forms and the folder menu. */
  reset: () => void;
  /** Marks rows again (open chat, selection, indent, language) without new data. */
  refreshSite: () => void;
  /** Opens the name form for a new top-level folder. */
  startCreateFolder: () => void;
  destroy: () => void;
};

/** The folder a stored conversation record lives in, found by identity. */
function bucketOf(store: GeminiFolderReads, conversation: ConversationReference): string | null {
  for (const [bucketId, list] of Object.entries(store.data.folderContents)) {
    if (list.includes(conversation)) return bucketId;
  }
  return null;
}

/**
 * "New chat in this folder" on every folder; its instructions only with
 * Folder-as-Project on, which alone puts them in a send.
 */
function projectMenuItems(options: SidebarTreeOptions, folder: Folder): FolderMenuItem[] {
  const { store, dialogs, feedback, navigation } = options;
  const newChat: FolderMenuItem = {
    labelKey: 'folder_new_chat_in_folder',
    run: () => navigation.createNewChatInFolder(folder.id),
  };
  if (!options.view().projectEnabled) return [newChat];
  return [
    newChat,
    {
      labelKey: folder.instructions
        ? 'folderAsProject_editInstructions'
        : 'folderAsProject_setInstructions',
      run: () =>
        dialogs.openInstructions(folder.instructions, async (instructions) => {
          const activation = store.activation;
          const saved = isSaved(
            await options.commands.run({
              kind: 'setFolderInstructions',
              folderId: folder.id,
              instructions: instructions ?? null,
            }),
          );
          if (!saved && activation === store.activation) {
            feedback.showNotification(t('folder_save_error'), 'error');
          }
          return saved;
        }),
    },
  ];
}

function createActions(options: SidebarTreeOptions): TreeActions {
  const { store, dialogs, navigation, selection, drops, onRenameNative } = options;
  // The row clicked last, for a record replaced in storage since the tree drew it.
  let clicked: { conversation: ConversationReference; bucketId: string } | null = null;
  const selecting = selection.treeActions();
  return {
    ...createFloatingTreeStoreActions(options.commands, dialogs),
    // Opens the folder's latest stored record, so the route uses current data.
    onNavigate: (conversation) => {
      const bucketId =
        bucketOf(store, conversation) ??
        (clicked?.conversation === conversation ? clicked.bucketId : null);
      clicked = null;
      const latest = bucketId
        ? store.data.folderContents[bucketId]?.find(
            (item) => item.conversationId === conversation.conversationId,
          )
        : undefined;
      navigation.navigate(latest ?? conversation, bucketId ?? undefined);
    },
    onDrop: (e, folderId, placement) => dropOnSidebar(drops, e, folderId, placement),
    acceptsDrag: acceptsSidebarDrag,
    onRenameConversation: (conversation) => void onRenameNative(conversation),
    onConversationMenu: (e, conversation) =>
      dialogs.openMenu(
        e,
        [{ label: t('folder_rename'), action: () => void onRenameNative(conversation) }],
        'conversation',
      ),
    folderMenuItems: (folder) => projectMenuItems(options, folder),
    ...selecting,
    interceptConversationClick: (e, conversation, bucketId, row) => {
      clicked = { conversation, bucketId };
      return selecting.interceptConversationClick(e, conversation, bucketId, row);
    },
  };
}

/**
 * The folder row of the open conversation: the one it was opened from, or
 * every row of it when it was opened elsewhere. Matches legacy ids by route.
 */
function activeConversation(options: SidebarTreeOptions) {
  const { store, navigation } = options;
  const currentId = normalizeConversationId(getCurrentHexIdFromLocation());
  const matches = (conversation: ConversationReference) =>
    !!currentId &&
    resolveConversationRouteId(
      navigation.getConversationHref(conversation),
      conversation.conversationId,
    ) === currentId;
  let first: ConversationReference | null = null;
  let opened: { bucketId: string; conversation: ConversationReference } | null = null;
  if (currentId) {
    for (const [bucketId, list] of Object.entries(store.data.folderContents)) {
      for (const conversation of list) {
        if (!matches(conversation)) continue;
        first ??= conversation;
        if (navigation.isActiveInstance(bucketId, conversation.conversationId)) {
          opened ??= { bucketId, conversation };
        }
      }
    }
  }
  return {
    title: (opened?.conversation ?? first)?.title ?? null,
    isActive: (conversation: ConversationReference, bucketId: string) =>
      matches(conversation) && (!opened || opened.bucketId === bucketId),
  };
}

function siteOptions(options: SidebarTreeOptions, view: SidebarTreeView): TreeSiteOptions {
  const { navigation, selection } = options;
  return {
    folderMenuButton: { labelKey: 'folder_settings' },
    folderBodyDrop: true,
    folderDrag: true,
    ...searchAndSortOptions(view.searching, view.sortMode),
    filter: view.filter,
    isActiveConversation: activeConversation(options).isActive,
    isConversationSelected: (conversation, bucketId) =>
      selection.isFolderConversationSelected(conversation.conversationId, bucketId),
    conversationHref: (conversation) => navigation.getConversationHref(conversation),
    conversationIcon: (conversation) =>
      conversation.isGem && conversation.gemId
        ? getGemIcon(conversation.gemId)
        : DEFAULT_CONVERSATION_ICON,
    folderToggleDelayMs: FOLDER_TOGGLE_DELAY_MS,
    // The sidebar's own folder row: SVG controls, a pin and menu on hover, and
    // no count or add-subfolder button (the menu has it).
    lineIcons: true,
    folderPinButton: true,
    hideFolderCount: true,
    hideAddSubfolderButton: true,
    renameFillsRow: true,
    conversationIdentity: FOLDER_SITE_POLICIES.gemini,
  };
}

export function mountSidebarTree(options: SidebarTreeOptions): SidebarTree {
  const { store } = options;
  const host = document.createElement('div');
  host.className = SIDEBAR_TREE_HOST_CLASS;
  host.setAttribute(INLINE_TREE_ATTR, '');
  const surface = attachShadowSurface(host, `${panelCss}\n${SIDEBAR_TREE_CSS}`);
  const body = document.createElement('div');
  body.className = `${FLOATING_PANEL_CLASS}__body`;
  surface.root.appendChild(body);

  const marker = document.createElement('span');
  marker.className = ACTIVE_TITLE_MARKER_CLASS;
  marker.hidden = true;
  marker.style.display = 'none';
  const markerTitle = marker.appendChild(document.createElement('span'));
  markerTitle.className = 'gv-conversation-title';

  let view = options.view();
  const tree = mountFolderTree({
    body,
    boundary: host,
    focusRoot: surface.root,
    data: store.data,
    rootBucketId: ROOT_CONVERSATIONS_ID,
    conversationSortMode: view.sortMode,
    actions: createActions(options),
    site: siteOptions(options, view),
    popoverLayer: { css: panelCss },
  });

  const show = () => {
    view = options.view();
    host.style.setProperty(FOLDER_INDENT_PROPERTY, `${view.indent}px`);
    if (!marker.isConnected && host.isConnected) host.after(marker);
    markerTitle.textContent = activeConversation(options).title ?? '';
    tree.setSite(siteOptions(options, view));
  };

  return {
    host,
    render: () => {
      show();
      tree.update(store.data, view.sortMode);
    },
    reset: () => {
      show();
      tree.reset(store.data, view.sortMode);
    },
    refreshSite: show,
    startCreateFolder: () => {
      // A second "+" returns to the open name field instead of opening another.
      const open = surface.root.querySelector<HTMLInputElement>(
        `.${FLOATING_PANEL_CLASS}__inline-form--root input`,
      );
      if (open) {
        open.focus();
        return;
      }
      tree.apply({ inlineEditor: { mode: 'create', parentId: null }, contextMenu: null });
    },
    destroy: () => {
      tree.destroy();
      surface.disconnect();
      host.remove();
      marker.remove();
    },
  };
}
