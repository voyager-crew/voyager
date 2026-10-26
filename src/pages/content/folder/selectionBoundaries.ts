import { closestGeminiSidebarElement } from '@/core/gemini/sidebar/queries';

const VOYAGER_LAYER_SELECTOR = [
  '[data-gv-shadow-surface]',
  '.gv-folder-menu',
  '.gv-folder-dialog-overlay',
  '.gv-color-picker-dialog',
].join(', ');

/** These are selection-dismissal boundaries, never conversation or folder identities. */
export function isOutsideFolderSelection(
  target: HTMLElement,
  sidebar: HTMLElement | null,
  panel: HTMLElement | null,
  insideFloating: boolean,
): boolean {
  const insideSidebar =
    sidebar?.contains(target) || !!closestGeminiSidebarElement(target, 'sidebar.overflow');
  const overlay = target.closest(
    `.cdk-overlay-container, .mat-mdc-dialog-container, ${VOYAGER_LAYER_SELECTOR}`,
  );
  return !insideSidebar && !panel?.contains(target) && !insideFloating && !overlay;
}
