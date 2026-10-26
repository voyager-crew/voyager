import { extractConversationData, extractConversationId } from './nativeConversationIds';
import { extractNativeDragTitle } from './nativeConversationTitles';
import {
  isPackagedNativeConversationRow,
  packagedConversationRows,
} from './sidebarConversationQueries';
import type { ConversationReference, DragData } from './types';

const SELECTED_CLASS = 'gv-conversation-selected';
const ROW_MENU_BUTTON =
  '[data-test-id="actions-menu-button"], [data-test-id="conversation-actions-menu-icon-button"]';

/** What a native sidebar row needs from the selection that owns its state. */
export type NativeRowSelection = {
  /** Bind a row discovered by the folder sidebar observer, including floating-mode startup. */
  bindRow?: (element: HTMLElement) => void;
  longPressMs: number;
  schedule: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
  /** A programmatic batch delete is driving Gemini's own menus. */
  isBatchDeleting: () => boolean;
  isMultiSelectMode: () => boolean;
  isSelected: (conversationId: string) => boolean;
  selectedIds: () => readonly string[];
  enterMultiSelect: (conversationId: string) => void;
  toggle: (conversationId: string) => void;
  /** Makes `conversationId` the only selected chat. */
  selectOnly: (conversationId: string) => void;
  /** Marks every row again from the selection. */
  refresh: () => void;
  /** A drag ended: drop the selection it made unless multi-select holds it. */
  endDrag: () => void;
  accountIsolationEnabled: () => boolean;
  findConversationElement: (conversationId: string) => HTMLElement | null;
  setDragImage: (event: DragEvent, label: string) => void;
};

function debug(level: 'log' | 'warn', ...args: unknown[]): void {
  try {
    if (localStorage.getItem('gvFolderDebug') === '1') console[level]('[FolderManager]', ...args);
  } catch {
    /* Debugging must not affect dragging. */
  }
}

/** A selected chat's row: in the folder panel, else in Gemini's own list. */
export function findConversationElement(
  conversationId: string,
  panel: HTMLElement | null,
  sidebar: HTMLElement | null,
): HTMLElement | null {
  const folderConv = panel?.querySelector<HTMLElement>(
    `[data-conversation-id="${conversationId}"]`,
  );
  if (folderConv) return folderConv;
  for (const conv of Array.from(packagedConversationRows(sidebar))) {
    if (extractConversationId(conv as HTMLElement) === conversationId) return conv as HTMLElement;
  }
  return null;
}

/** A small label under the pointer instead of the browser's snapshot of the row. */
export function setLightweightDragImage(
  event: DragEvent,
  label: string,
  images: Set<HTMLElement>,
  schedule: (callback: () => void, delay: number) => number,
): void {
  const transfer = event.dataTransfer;
  if (!transfer || typeof transfer.setDragImage !== 'function') return;

  const dragImage = document.createElement('div');
  dragImage.className = 'gv-folder-drag-image';
  dragImage.textContent = label;
  document.body.appendChild(dragImage);

  try {
    transfer.setDragImage(dragImage, 12, 12);
  } catch {
    dragImage.remove();
    return;
  }

  images.add(dragImage);
  schedule(() => {
    dragImage.remove();
    images.delete(dragImage);
  }, 0);
}

/** The drag data for every selected chat whose row is still on the page. */
function multiDragData(selection: NativeRowSelection): DragData {
  const conversations: ConversationReference[] = [];
  for (const id of selection.selectedIds()) {
    const row = selection.findConversationElement(id);
    if (!row) continue;
    const data = extractConversationData(row, selection.accountIsolationEnabled());
    conversations.push({
      conversationId: id,
      title: extractNativeDragTitle(row, id),
      url: data.url,
      addedAt: Date.now(),
      isGem: data.isGem,
      gemId: data.gemId,
    });
  }
  return { type: 'conversation', title: `${conversations.length} conversations`, conversations };
}

function setSelectedOpacity(selection: NativeRowSelection, opacity: string): void {
  for (const id of selection.selectedIds()) {
    const row = selection.findConversationElement(id);
    if (row) row.style.opacity = opacity;
  }
}

function onDragStart(
  element: HTMLElement,
  selection: NativeRowSelection,
  e: DragEvent,
  cancelLongPress: () => void,
): void {
  const conversationId = extractConversationId(element);
  // A row without a readable id cannot be filed: no folder drag starts from it.
  if (!conversationId) {
    e.preventDefault();
    return;
  }
  // Restrict to move-only to prevent Chrome from triggering split-screen/tab tiling
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';

  // If this conversation is not selected, select it exclusively
  if (!selection.isSelected(conversationId)) {
    selection.selectOnly(conversationId);
    element.classList.add(SELECTED_CLASS);
    selection.refresh();
  }
  cancelLongPress();

  if (selection.selectedIds().length > 1) {
    const dragData = multiDragData(selection);
    e.dataTransfer?.setData('application/json', JSON.stringify(dragData));
    selection.setDragImage(e, dragData.title);
    setSelectedOpacity(selection, '0.5');
    return;
  }

  const title = extractNativeDragTitle(element, conversationId);
  const data = extractConversationData(element, selection.accountIsolationEnabled());
  debug('log', 'Drag start:', { title, isGem: data.isGem, gemId: data.gemId, url: data.url });
  const dragData: DragData = {
    type: 'conversation',
    conversationId,
    title,
    url: data.url,
    isGem: data.isGem,
    gemId: data.gemId,
  };
  e.dataTransfer?.setData('application/json', JSON.stringify(dragData));
  selection.setDragImage(e, title);
  element.style.opacity = '0.5';
}

/** Plugin-owned native selection listeners, released even when Gemini retains the row. */
export function bindNativeConversationSelection(
  element: HTMLElement,
  selection: NativeRowSelection,
): () => void {
  let longPressTriggered = false;
  let longPressTimer: number | null = null;
  const cancelLongPress = () => {
    if (longPressTimer !== null) selection.clearTimer(longPressTimer);
    longPressTimer = null;
  };
  const press = (e: MouseEvent) => {
    if (e.button !== 0 || selection.isBatchDeleting()) return;
    if (e.target instanceof Element && e.target.closest(ROW_MENU_BUTTON)) return;
    longPressTriggered = false;
    cancelLongPress();
    longPressTimer = selection.schedule(() => {
      longPressTimer = null;
      const id = extractConversationId(element);
      if (!id) return;
      longPressTriggered = true;
      selection.enterMultiSelect(id);
    }, selection.longPressMs);
  };
  const click = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest(ROW_MENU_BUTTON)) return;
    if (selection.isBatchDeleting()) return;
    if (longPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggered = false;
      return;
    }
    if (!selection.isMultiSelectMode()) return;
    e.preventDefault();
    e.stopPropagation();
    const id = extractConversationId(element);
    if (id) selection.toggle(id);
    selection.refresh();
  };
  element.addEventListener('mousedown', press);
  element.addEventListener('mouseup', cancelLongPress);
  element.addEventListener('mouseleave', cancelLongPress);
  element.addEventListener('dragstart', cancelLongPress);
  element.addEventListener('click', click, true);
  return () => {
    cancelLongPress();
    element.removeEventListener('mousedown', press);
    element.removeEventListener('mouseup', cancelLongPress);
    element.removeEventListener('mouseleave', cancelLongPress);
    element.removeEventListener('dragstart', cancelLongPress);
    element.removeEventListener('click', click, true);
  };
}

/**
 * Folder-owned drag support survives turning the batch selection plugin off.
 * Returns the binding's release, which takes its listeners and marker off and
 * restores the row's own `draggable` and cursor, so the next folders view binds
 * its own; `null` when the row is bound already.
 */
export function bindNativeConversationRow(
  element: HTMLElement,
  getSelection: () => NativeRowSelection,
): (() => void) | null {
  // Online observations cannot turn an arbitrary container into a folder drag source.
  if (!isPackagedNativeConversationRow(element)) return null;
  if (element.dataset.gvConvDragAttached === 'true') return null;
  element.dataset.gvConvDragAttached = 'true';
  const draggable = element.getAttribute('draggable');
  const cursor = element.style.cursor;
  element.draggable = true;
  element.style.cursor = 'grab';
  const dragStart = (event: DragEvent) => onDragStart(element, getSelection(), event, () => {});
  const dragEnd = () => {
    const selection = getSelection();
    if (selection.selectedIds().length > 1) setSelectedOpacity(selection, '1');
    else element.style.opacity = '1';
    selection.endDrag();
  };
  element.addEventListener('dragstart', dragStart);
  element.addEventListener('dragend', dragEnd);
  return () => {
    element.removeEventListener('dragstart', dragStart);
    element.removeEventListener('dragend', dragEnd);
    delete element.dataset.gvConvDragAttached;
    if (draggable === null) element.removeAttribute('draggable');
    else element.setAttribute('draggable', draggable);
    element.style.cursor = cursor;
  };
}
