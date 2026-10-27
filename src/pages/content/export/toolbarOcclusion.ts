// Whether a host layer covers the persistent export toolbar's row. Under one,
// the row hit-test cannot see the header controls (a backdrop is topmost, or
// a menu set `pointer-events: none` on body), so a measurement there would put
// the toolbar back on its default offset, right over Share.
import { VOYAGER_SURFACE_SELECTOR, coveringLayer, hostStackAt } from './toolbarAvoidance';

const HOST_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

export type ToolbarOcclusion = {
  /** What ends it when changed or removed: the backdrop, and body for a pointer lock. */
  occluders: HTMLElement[];
  /** A host dialog's backdrop covers the row: the toolbar steps under it. */
  modal: boolean;
};

function locksPointers(element: Element): boolean {
  return getComputedStyle(element).pointerEvents === 'none';
}

// <html> carries Voyager's own `gv-platform-themed`, so an ancestor check that
// reached it took every host dialog for a Voyager one.
function isVoyagerDialog(dialog: Element): boolean {
  for (
    let element: Element | null = dialog;
    element && element !== document.body && element !== document.documentElement;
    element = element.parentElement
  ) {
    if (element.matches(VOYAGER_SURFACE_SELECTOR)) return true;
    if (Array.from(element.classList).some((name) => name.startsWith('gv-'))) return true;
  }
  return false;
}

function hasHostDialog(): boolean {
  return Array.from(document.querySelectorAll(HOST_DIALOG_SELECTOR)).some(
    (dialog) => !isVoyagerDialog(dialog),
  );
}

/**
 * What covers the toolbar's row before measuring: a page-wide pointer lock
 * (a menu), or a backdrop over the toolbar's own spot. `found` adds backdrops
 * the measurement's hit-test met. Null when the row is visible.
 */
export function detectToolbarOcclusion(
  toolbarRoot: HTMLElement,
  found: readonly HTMLElement[] = [],
): ToolbarOcclusion | null {
  const pointersLocked = locksPointers(document.body) || locksPointers(document.documentElement);
  const occluders = [...found];
  const rect = toolbarRoot.getBoundingClientRect();
  if (
    occluders.length === 0 &&
    typeof document.elementsFromPoint === 'function' &&
    rect.width > 0
  ) {
    const layer = coveringLayer(
      hostStackAt(toolbarRoot, rect.left + rect.width / 2, rect.top + rect.height / 2),
      toolbarRoot,
    );
    if (layer) occluders.push(layer);
  }
  const backdrop = occluders.length > 0;
  if (pointersLocked) occluders.push(document.body);
  if (occluders.length === 0) return null;
  return { occluders, modal: backdrop && hasHostDialog() };
}
