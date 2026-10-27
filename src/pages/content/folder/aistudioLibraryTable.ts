import { getBundledSiteSelectorView } from '@/core/selectors';
/**
 * The `/library` history table: which rows are prompts, how a row drags its
 * prompt, and which rows a filed prompt hides. Pure DOM; no state of its own
 * beyond the bound markers on rows.
 */
import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';

import { readAIStudioLibraryRows, readAIStudioLibraryTableSelector } from './aistudioLocatorReads';
import {
  PROMPT_LINK_SELECTOR,
  type PromptDragData,
  extractPromptIdFromHref,
  promptDragData,
  writePromptDragData,
} from './aistudioPromptLinks';
import type { FolderData } from './types';

const ARCHIVED_ROW_CLASS = 'gv-conversation-archived';

type BoundRow = HTMLElement & { _gvLibraryDragBound?: boolean };

export function isLibraryPath(): boolean {
  return /\/library(\/|$)/.test(location.pathname);
}

function promptAnchor(row: HTMLElement): HTMLAnchorElement | null {
  return row.querySelector<HTMLAnchorElement>(PROMPT_LINK_SELECTOR);
}

export function getLibraryPromptRows(): HTMLElement[] {
  return readAIStudioLibraryRows().map(({ row }) => row);
}

/** The prompt a table row links to, or null for a row without one. */
export function libraryPromptData(row: HTMLElement): PromptDragData | null {
  const anchor = promptAnchor(row);
  if (!anchor) return null;
  const data = promptDragData(anchor);
  return data.conversationId ? data : null;
}

export function findLibraryPromptRow(conversationId: string): HTMLElement | null {
  return (
    getLibraryPromptRows().find(
      (row) => libraryPromptData(row)?.conversationId === conversationId,
    ) ?? null
  );
}

function bindRowDrag(row: HTMLElement, anchor: HTMLAnchorElement): void {
  row.draggable = true;
  row.style.cursor = 'grab';
  // An <a href> drags as a bare URL, which would take the drag from the row
  // and drop a payload with no title.
  anchor.draggable = false;
  try {
    (anchor.style as CSSStyleDeclaration & { webkitUserDrag?: string }).webkitUserDrag = 'none';
  } catch {}

  const onDragStart = (event: DragEvent) => {
    // Keep Angular Material's own drag handling out of it.
    event.stopPropagation();
    const data = libraryPromptData(row);
    if (!data) return;
    writePromptDragData(event, data, row);
    row.style.opacity = '0.5';
  };
  // The row covers every cell; the anchor listener fills the same payload if a
  // browser still starts the anchor's own drag.
  row.addEventListener('dragstart', onDragStart, true);
  anchor.addEventListener('dragstart', onDragStart, true);
  row.addEventListener('dragend', () => {
    row.style.opacity = '';
  });
}

/** Makes every not-yet-bound prompt row drag its prompt with its title. */
export function bindLibraryRows(): void {
  for (const row of getLibraryPromptRows() as BoundRow[]) {
    const anchor = promptAnchor(row);
    if (!anchor || row._gvLibraryDragBound) continue;
    row._gvLibraryDragBound = true;
    bindRowDrag(row, anchor);
  }
}

function tableMutated(mutations: MutationRecord[]): boolean {
  const tableSelector = readAIStudioLibraryTableSelector();
  const tableParts = `${tableSelector}, ${getBundledSiteSelectorView('aistudio').profiles['library.rows'].join(',')}`;
  return mutations.some(
    (mutation) =>
      (mutation.target instanceof Element && !!mutation.target.closest(tableSelector)) ||
      Array.from(mutation.addedNodes).some(
        (node) =>
          node instanceof Element && (node.matches(tableParts) || !!node.querySelector(tableParts)),
      ),
  );
}

/**
 * Calls `onRowsChanged` when the library table or its rows change. Watches
 * `document.body`, so a navigation that swaps the table subtree keeps it live.
 */
export function watchLibraryTable(onRowsChanged: () => void): () => void {
  const observer = new MutationObserver((mutations) => {
    // The table exists only on /library; skip all selector work elsewhere.
    if (!isLibraryPath() || !tableMutated(mutations)) return;
    onRowsChanged();
  });
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {}
  return () => observer.disconnect();
}

/** Ids of prompts filed in a real folder; Uncategorized does not count. */
function collectArchivedPromptIds(data: FolderData): Set<string> {
  const archived = new Set<string>();
  for (const [folderId, conversations] of Object.entries(data.folderContents)) {
    if (folderId === AISTUDIO_ROOT_BUCKET_ID || !Array.isArray(conversations)) continue;
    for (const conversation of conversations) archived.add(conversation.conversationId);
  }
  return archived;
}

/** Hides (or shows) each /library row by whether its prompt is filed. No-op elsewhere. */
export function applyHideArchivedRows(data: FolderData, enabled: boolean): void {
  if (!isLibraryPath()) return;
  const rows = readAIStudioLibraryRows(true);
  if (rows.length === 0) return;
  const archivedIds = collectArchivedPromptIds(data);
  rows.forEach(({ row, anchor }) => {
    const id = anchor ? extractPromptIdFromHref(anchor.getAttribute('href') || anchor.href) : null;
    if (id) row.classList.toggle(ARCHIVED_ROW_CLASS, enabled && archivedIds.has(id));
  });
}

/** Shows every row hidden as archived; the feature is going away. */
export function clearArchivedRows(): void {
  document
    .querySelectorAll(`.${ARCHIVED_ROW_CLASS}`)
    .forEach((row) => row.classList.remove(ARCHIVED_ROW_CLASS));
}
