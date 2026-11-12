import { StorageKeys } from '@/core/types/common';
import type { ConversationSortMode } from '@/features/folder/model/folderData';
import {
  type SubfolderPlacement,
  toSubfolderPlacement,
} from '@/features/folder/model/subfolderPlacement';

import { watchSyncSetting } from '../folderDisplay';
import { eventPassedThrough } from '../shadowHost';
import type { Folder, FolderData } from '../types';
import { renderContextMenu } from './ContextMenu';
import { renderFolderTree } from './FolderTree';
import { mountPopoverLayer } from './popoverLayer';
import { type TreeProjection, buildTreeProjection } from './projection';
import {
  type ContextMenuState,
  type InlineEditorState,
  type TreeActions,
  type TreeChange,
  type TreeProps,
  type TreeSiteOptions,
  cls,
  isFolderMenu,
} from './shared';

export type FolderTreeOptions = {
  /** The element the tree renders into. */
  body: HTMLElement;
  /** The surface the tree lives in: clicks outside it close the folder menu. */
  boundary: HTMLElement;
  /** The shadow root holding `body`, read for the focused inline input. */
  focusRoot: ShadowRoot;
  data: FolderData;
  rootBucketId: string;
  conversationSortMode: ConversationSortMode;
  actions: TreeActions;
  site?: TreeSiteOptions;
  /**
   * Renders the folder menu in its own surface on `document.body`, styled by
   * `css`, for a tree inside a container that transforms or clips. Removed
   * with the tree.
   */
  popoverLayer?: { css: string };
};

export type FolderTreeController = {
  /** Applies a view change, runs `effect`, then re-renders. */
  apply: (change: TreeChange, effect?: () => void) => void;
  /** New data; waits for an open inline edit the user is typing in. */
  update: (data: FolderData, conversationSortMode?: ConversationSortMode) => void;
  /** Replaces account data and discards transient edits. */
  reset: (data: FolderData, conversationSortMode?: ConversationSortMode) => void;
  /** Changes site options, such as the open conversation, and re-renders. */
  setSite: (site: TreeSiteOptions) => void;
  /** Whether the folder menu or an inline name form is open. */
  busy: () => boolean;
  /** Unmounts the tree and removes its document listener; the caller removes `body`. */
  destroy: () => void;
};

/** Whether the folder or filed conversation `menu` is for is still in `data`. */
function menuTargetExists(data: FolderData, menu: ContextMenuState): boolean {
  if (isFolderMenu(menu)) return data.folders.some((folder) => folder.id === menu.folderId);
  const { conversationId } = menu.conversation;
  return Object.values(data.folderContents).some((bucket) =>
    bucket.some((conversation) => conversation.conversationId === conversationId),
  );
}

/**
 * The view state a folder tree keeps between renders: the open inline editor,
 * the folder menu, and expansion when the host does not persist it. It also
 * owns the data revision's projection (the layout the view renders), rebuilt
 * whenever the data or its ordering may have changed. It follows the one
 * subfolder placement setting, shared by every site's tree. Nothing here
 * writes to the data: expansion goes back to the host through
 * `onToggleFolderExpanded`.
 */
export function mountFolderTree({
  body,
  boundary,
  focusRoot,
  data,
  rootBucketId,
  conversationSortMode,
  actions,
  site,
  popoverLayer,
}: FolderTreeOptions): FolderTreeController {
  let currentSite = site;
  let currentData = data;
  let currentConversationSortMode = conversationSortMode;
  let subfolderPlacement: SubfolderPlacement = 'first';
  let inlineEditor: InlineEditorState | null = null;
  let contextMenu: ContextMenuState | null = null;
  // Bumped when another account's data replaces this one; the view starts over.
  let generation = 0;
  let projection: TreeProjection | null = null;
  const project = () => {
    projection = buildTreeProjection({
      data: currentData,
      rootBucketId,
      conversationSortMode: currentConversationSortMode,
      subfolderPlacement,
      site: currentSite,
    });
  };
  const expandedFolders = new Map<string, boolean>();
  const { onToggleFolderExpanded, onRenameFolder } = actions;
  // The rename form keeps the folder it opened on, and renders wait while it
  // has focus; compare with live data, as not every owner ignores a no-op.
  const treeActions: TreeActions = onRenameFolder
    ? {
        ...actions,
        onRenameFolder: (folderId, name) => {
          const live = currentData.folders.find((folder) => folder.id === folderId);
          if (live?.name !== name) onRenameFolder(folderId, name);
        },
      }
    : actions;
  const layer = popoverLayer ? mountPopoverLayer(popoverLayer.css) : null;

  // With a store callback, expansion is the folder's persisted `isExpanded`,
  // shared with the sidebar; without one it stays local to this tree.
  const isExpanded = (folder: Folder): boolean =>
    !!currentSite?.expandAll ||
    (onToggleFolderExpanded
      ? folder.isExpanded
      : (expandedFolders.get(folder.id) ?? folder.isExpanded));
  const setExpanded = (folderId: string, expanded: boolean): void => {
    if (!onToggleFolderExpanded) {
      expandedFolders.set(folderId, expanded);
      return;
    }
    const folder = currentData.folders.find((candidate) => candidate.id === folderId);
    if (folder && folder.isExpanded !== expanded) onToggleFolderExpanded(folderId);
  };

  const render = () => {
    for (const folder of currentData.folders) {
      if (!expandedFolders.has(folder.id)) {
        expandedFolders.set(folder.id, folder.isExpanded);
      }
    }

    if (!projection) project();
    const tree: TreeProps = {
      projection: projection ?? undefined,
      generation,
      data: currentData,
      rootBucketId,
      conversationSortMode: currentConversationSortMode,
      actions: treeActions,
      inlineEditor,
      contextMenu,
      isExpanded,
      apply,
      site: currentSite,
      folderHeader,
    };
    renderFolderTree(body, layer ? { ...tree, menuInLayer: true } : tree);
    if (layer) renderContextMenu(layer.container, tree);
  };

  function folderHeader(folderId: string): HTMLElement | null {
    return (
      Array.from(body.querySelectorAll<HTMLElement>(`.${cls('folder-header')}`)).find(
        (header) => header.dataset.folderId === folderId,
      ) ?? null
    );
  }
  // A menu opened from the keyboard takes focus, and gives it back to its
  // button when it closes and nothing else took it.
  const focusMenuButton = (folderId: string) =>
    folderHeader(folderId)
      ?.querySelector<HTMLElement>(`.${cls('icon-button--menu')}`)
      ?.focus();
  const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

  function apply(change: TreeChange, effect?: () => void): void {
    const closing = contextMenu && change.contextMenu === null ? contextMenu : null;
    if (change.inlineEditor !== undefined) inlineEditor = change.inlineEditor;
    if (change.contextMenu !== undefined) contextMenu = change.contextMenu;
    if (change.expand) setExpanded(change.expand.folderId, change.expand.expanded);
    // The effect may change the data in place; lay it out again.
    if (effect) {
      effect();
      project();
    }
    render();
    if (change.contextMenu?.fromKeyboard) {
      (layer?.container ?? body).querySelector<HTMLElement>(`.${cls('menu-item')}`)?.focus();
    } else if (closing && isFolderMenu(closing) && closing.fromKeyboard && focusIsLost()) {
      focusMenuButton(closing.folderId);
    }
  }
  render();

  const onDocumentClick = (e: MouseEvent) => {
    if (!contextMenu || eventPassedThrough(e, boundary)) return;
    if (layer && eventPassedThrough(e, layer.host)) return;
    apply({ contextMenu: null });
  };
  // Capture: a host that consumes Escape (Gemini closing its overlay sidebar) left the menu
  // floating; the open menu is the top layer, so this Escape is its alone.
  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (!contextMenu || e.key !== 'Escape') return;
    e.stopPropagation();
    apply({ contextMenu: null });
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeyDown, true);

  // Is the user currently typing into an inline create/rename input?
  // Focus inside the shadow root shows as the host on `document.activeElement`.
  const isInlineFormInputFocused = () =>
    !!focusRoot.activeElement?.classList.contains(cls('inline-input'));

  const stopPlacementWatch = watchSyncSetting(StorageKeys.FOLDER_SUBFOLDER_PLACEMENT, (value) => {
    const next = toSubfolderPlacement(value);
    if (next === subfolderPlacement) return;
    subfolderPlacement = next;
    project();
    // As with `update`: an inline form the user is typing in renders on close.
    if (inlineEditor && isInlineFormInputFocused()) return;
    render();
  });

  return {
    apply,
    busy: () => contextMenu !== null || inlineEditor !== null,
    setSite: (next) => {
      const reorders =
        next.folderOrder !== currentSite?.folderOrder ||
        next.conversationOrder !== currentSite?.conversationOrder ||
        next.conversationIdentity !== currentSite?.conversationIdentity ||
        next.rootSection?.labelKey !== currentSite?.rootSection?.labelKey ||
        next.filter !== currentSite?.filter;
      currentSite = next;
      if (reorders) project();
      render();
    },
    reset: (next, nextConversationSortMode) => {
      currentData = next;
      if (nextConversationSortMode) currentConversationSortMode = nextConversationSortMode;
      inlineEditor = null;
      contextMenu = null;
      expandedFolders.clear();
      generation += 1;
      project();
      render();
    },
    update: (next, nextConversationSortMode) => {
      currentData = next;
      if (nextConversationSortMode) currentConversationSortMode = nextConversationSortMode;
      project();
      const nextIds = new Set(next.folders.map((folder) => folder.id));
      for (const folderId of expandedFolders.keys()) {
        if (!nextIds.has(folderId)) expandedFolders.delete(folderId);
      }
      if (inlineEditor?.mode === 'rename') {
        const editingFolderId = inlineEditor.folderId;
        if (!next.folders.some((folder) => folder.id === editingFolderId)) {
          inlineEditor = null;
        }
      }
      if (contextMenu && !menuTargetExists(next, contextMenu)) contextMenu = null;
      // A background update (storage sync, another tab) must not rebuild the
      // tree while the user is typing in an inline form — the rebuild would
      // recreate the form empty, losing their input. `currentData` is already
      // updated above, and every form close path (submit / cancel / outside
      // mousedown) calls render(), which then picks up the deferred data.
      // If the edited folder was deleted remotely, inlineEditor is nulled
      // above and we fall through to render immediately.
      if (inlineEditor && isInlineFormInputFocused()) return;
      render();
    },
    destroy: () => {
      stopPlacementWatch();
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      // Unmount first so the inline form drops its document listener.
      renderFolderTree(body, null);
      if (layer) {
        renderContextMenu(layer.container, null);
        layer.destroy();
      }
    },
  };
}
