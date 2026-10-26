import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import {
  geminiSidebarSelector,
  hasOnlineSidebarRoot,
  packagedGeminiSidebarRoot,
  readGeminiSidebarElements,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

/** Native actions and folder writes use a root whose provenance is packaged. */
export function packagedConversationRoot(sidebar: HTMLElement | null): ParentNode {
  if (hasOnlineSidebarRoot()) return packagedGeminiSidebarRoot() ?? document;
  return sidebar?.isConnected ? sidebar : document;
}

export function sidebarConversationRoot(
  sidebar: HTMLElement | null,
  view: GeminiSelectorView,
): ParentNode {
  // A fallback cannot keep the online root and only swap its descendants' locators.
  if (hasOnlineSidebarRoot() && !view.remoteKeys.has('sidebar.overflow')) {
    return packagedGeminiSidebarRoot() ?? document;
  }
  return sidebar?.isConnected ? sidebar : document;
}

/** A DOM-only locator may observe a row; only the native row protocol can file it. */
export function isPackagedNativeConversationRow(element: HTMLElement): boolean {
  return element.matches(geminiSidebarSelector('sidebar.row', getBundledGeminiSelectorView()));
}

export function readSidebarConversationRows(
  root: ParentNode,
  view: GeminiSelectorView,
): HTMLElement[] {
  const rows = readGeminiSidebarElements(root, 'sidebar.row', view);
  if (!view.remoteKeys.has('sidebar.row')) return rows;
  return rows.filter((row) => isUsableSidebarObservationRow(row, view));
}

export function isUsableSidebarObservationRow(row: HTMLElement, view: GeminiSelectorView): boolean {
  if (!view.remoteKeys.has('sidebar.row')) return true;
  const nativeRow = geminiSidebarSelector('sidebar.row', getBundledGeminiSelectorView());
  // A container around several conversations must never become one draggable record.
  if (row.querySelector(nativeRow)) return false;
  if (row.closest('.gv-folder-container, [data-gv-shadow-surface]')) return false;
  return !row.parentElement?.closest(nativeRow);
}

export function packagedConversationRows(sidebar: HTMLElement | null): HTMLElement[] {
  return readSidebarConversationRows(
    packagedConversationRoot(sidebar),
    getBundledGeminiSelectorView(),
  );
}

/**
 * Native rows for sweeps that hide, select, enhance or collect. An online list missing a row the
 * package sees would leave that row hidden, selected or undraggable, so it rereads the bundle.
 */
export function readCompleteNativeConversationRows(
  rootFor: (view: GeminiSelectorView) => ParentNode,
  packagedRoot: () => ParentNode,
): HTMLElement[] {
  return (
    resolveGeminiSidebarOperation(
      (view) => {
        const rows = readSidebarConversationRows(rootFor(view), view).filter(
          isPackagedNativeConversationRow,
        );
        if (view.remoteKeys.size === 0) return rows;
        const found = new Set(rows);
        const packaged = readSidebarConversationRows(
          packagedRoot(),
          getBundledGeminiSelectorView(),
        );
        return packaged.every((row) => found.has(row)) ? rows : null;
      },
      (rows) => rows !== null && rows.length > 0,
    ).value ?? []
  );
}
