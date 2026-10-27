/**
 * The /library floating drop zone: while a table row is dragged, a card lists
 * Uncategorized and every folder, nested under its parent, as targets.
 */
import { sortFoldersByCreation } from '@/features/folder/model/folderData';

import { isAIStudioLibraryRowDrag } from './aistudioLocatorReads';
import type { Folder, FolderData } from './types';

// With no dragover for this long while the zone shows, the drag is over: the
// source row may have been torn out by an Angular refresh, so dragend never fires.
const DRAG_HEARTBEAT_MS = 800;
const HIDE_DELAY_MS = 100;
const LIBRARY_DROP_ZONE_CLASS = 'gv-library-drop-zone';

const ZONE_STYLE = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(32, 33, 36, 0.95);
      border: 2px dashed rgba(138, 180, 248, 0.5);
      border-radius: 12px;
      padding: 16px;
      min-width: 200px;
      max-width: 300px;
      max-height: 400px;
      overflow-y: auto;
      z-index: 2147483646;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      transform: translateY(10px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
    `;
const TITLE_STYLE = `
      color: #e8eaed;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
const ROOT_ITEM_STYLE = `
        padding: 10px 12px;
        margin: 4px 0 12px 0;
        background: rgba(138, 180, 248, 0.1);
        border-radius: 8px;
        color: #8ab4f8;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.15s, border-color 0.15s;
        border: 2px dashed rgba(138, 180, 248, 0.4);
      `;
const folderItemStyle = (paddingLeft: string) => `
          padding: 10px ${paddingLeft};
          margin: 4px 0;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          color: #e8eaed;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.15s, border-color 0.15s;
          border: 2px solid transparent;
        `;

type Highlight = { background: string; borderColor: string };
const ROOT_IDLE: Highlight = {
  background: 'rgba(138, 180, 248, 0.1)',
  borderColor: 'rgba(138, 180, 248, 0.4)',
};
const ROOT_DROPPED: Highlight = { background: 'rgba(138, 180, 248, 0.2)', borderColor: '#8ab4f8' };
const ROOT_HOVER: Highlight = { background: 'rgba(138, 180, 248, 0.3)', borderColor: '#8ab4f8' };
const FOLDER_IDLE: Highlight = {
  background: 'rgba(255, 255, 255, 0.05)',
  borderColor: 'transparent',
};
const FOLDER_HOVER: Highlight = { background: 'rgba(138, 180, 248, 0.2)', borderColor: '#8ab4f8' };

export type LibraryDropZoneOptions = {
  t: (key: string) => string;
  canEdit: () => boolean;
  /** Folder data to list, read each time the zone shows. */
  data: () => FolderData;
  /** Gives an empty library its first folder before the list is built. */
  ensureFolder: () => void;
  /** A prompt was dropped on a folder, or on Uncategorized (`null`). */
  onDrop: (event: DragEvent, folder: Folder | null) => void;
};

export type LibraryDropZone = { destroy: () => void };

function paint(element: HTMLElement, highlight: Highlight): void {
  element.style.background = highlight.background;
  element.style.borderColor = highlight.borderColor;
}

/** Makes `item` a drop target: hover paints it; a drop paints `dropped` and calls `onDrop`. */
function bindDropTarget(
  item: HTMLElement,
  styles: { idle: Highlight; hover: Highlight; dropped: Highlight },
  canEdit: () => boolean,
  onDrop: (event: DragEvent) => void,
): void {
  item.addEventListener('dragenter', (event) => {
    event.preventDefault();
    event.stopPropagation();
    paint(item, styles.hover);
  });
  item.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } catch {}
  });
  item.addEventListener('dragleave', (event) => {
    event.stopPropagation();
    paint(item, styles.idle);
  });
  item.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit()) return;
    paint(item, styles.dropped);
    onDrop(event);
  });
}

function rootItem(options: LibraryDropZoneOptions): HTMLElement {
  const item = document.createElement('div');
  item.className = 'gv-library-folder-item gv-library-root-item';
  item.style.cssText = ROOT_ITEM_STYLE;
  item.innerHTML = `<span class="google-symbols" data-icon="inbox">inbox</span>${options.t('folder_uncategorized') || 'Uncategorized'}`;
  const styles = { idle: ROOT_IDLE, hover: ROOT_HOVER, dropped: ROOT_DROPPED };
  bindDropTarget(item, styles, options.canEdit, (event) => options.onDrop(event, null));
  return item;
}

function folderItem(folder: Folder, depth: number, options: LibraryDropZoneOptions) {
  const item = document.createElement('div');
  item.className = 'gv-library-folder-item';
  item.dataset.folderId = folder.id;
  item.style.cssText = folderItemStyle(`${12 + depth * 16}px`);
  const icon = document.createElement('span');
  icon.className = 'google-symbols';
  icon.style.cssText = 'font-size: 16px; color: #8ab4f8;';
  icon.textContent = depth > 0 ? 'subdirectory_arrow_right' : 'folder';
  item.append(icon, document.createTextNode(folder.name));
  const styles = { idle: FOLDER_IDLE, hover: FOLDER_HOVER, dropped: FOLDER_IDLE };
  bindDropTarget(item, styles, options.canEdit, (event) => options.onDrop(event, folder));
  return item;
}

/** Uncategorized, then every folder depth-first under its parent, siblings in creation order. */
function listItems(options: LibraryDropZoneOptions): HTMLElement[] {
  options.ensureFolder();
  const { folders } = options.data();
  const items = [rootItem(options)];
  // Legacy data may hold a parent cycle; each folder is listed once.
  const listed = new Set<string>();
  const visit = (parentId: string | null, depth: number): void => {
    const children = folders.filter((folder) => (folder.parentId || null) === parentId);
    for (const folder of sortFoldersByCreation(children)) {
      if (listed.has(folder.id)) continue;
      listed.add(folder.id);
      items.push(folderItem(folder, depth, options));
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return items;
}

function createZone(t: (key: string) => string): { zone: HTMLElement; list: HTMLElement } {
  const zone = document.createElement('div');
  zone.className = LIBRARY_DROP_ZONE_CLASS;
  zone.style.cssText = ZONE_STYLE;
  const title = document.createElement('div');
  title.style.cssText = TITLE_STYLE;
  title.innerHTML = `<span class="google-symbols" style="font-size: 18px;">folder</span>${t('folder_title')}`;
  const list = document.createElement('div');
  list.className = 'gv-library-folder-list';
  zone.append(title, list);
  return { zone, list };
}

/** Whether a drag started on a /library table row that links a prompt. */
function isLibraryRowDrag(event: DragEvent): boolean {
  return event.target instanceof Element && isAIStudioLibraryRowDrag(event.target);
}

/**
 * Mounts the zone and its document drag listeners; `destroy` removes both.
 * A zone already on the page is left alone, and this one then does nothing.
 */
export function mountLibraryDropZone(options: LibraryDropZoneOptions): LibraryDropZone {
  if (document.querySelector(`.${LIBRARY_DROP_ZONE_CLASS}`)) {
    return { destroy: () => {} };
  }
  const { zone, list } = createZone(options.t);
  document.body.appendChild(zone);

  let visible = false;
  let heartbeat: number | null = null;
  const clearHeartbeat = () => {
    if (heartbeat !== null) clearTimeout(heartbeat);
    heartbeat = null;
  };
  const setShown = (shown: boolean) => {
    visible = shown;
    zone.style.opacity = shown ? '1' : '0';
    zone.style.pointerEvents = shown ? 'auto' : 'none';
    zone.style.transform = shown ? 'translateY(0)' : 'translateY(10px)';
  };
  const hide = () => {
    clearHeartbeat();
    setShown(false);
  };
  // Every document dragover while the zone shows re-arms this; silence hides it.
  const armHeartbeat = () => {
    clearHeartbeat();
    heartbeat = window.setTimeout(hide, DRAG_HEARTBEAT_MS);
  };
  const show = () => {
    if (!options.canEdit()) return;
    visible = true;
    list.replaceChildren(...listItems(options));
    setShown(true);
    armHeartbeat();
  };

  const onDragStart = (event: DragEvent) => {
    if (isLibraryRowDrag(event)) setTimeout(show, 0);
  };
  const onDragOver = () => {
    if (visible) armHeartbeat();
  };
  // A drop anywhere also ends it, for sources whose dragend is swallowed.
  const onDragEnd = () => setTimeout(hide, HIDE_DELAY_MS);
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragend', onDragEnd);
  document.addEventListener('drop', onDragEnd);

  return {
    destroy: () => {
      clearHeartbeat();
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('drop', onDragEnd);
      zone.remove();
    },
  };
}
