import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import { sameItems } from '@/core/utils/array';
import menus from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-entry.json';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

import { resolveCanvasDocumentRoots } from './documentTargets';

const KEY = 'canvasEntry.menus';
const BUNDLED = menus[KEY].join(',');
const OWNER = packaged['canvasEntry.owner'];
const FOREIGN = 'form, input-area, rich-textarea, dialog, [role="dialog"], [contenteditable]';

/** Cleanup retains the native outer menu even when it contains an inner menu role. */
export function canvasMenuForCleanup(button: HTMLElement): HTMLElement | null {
  const native = button.closest<HTMLElement>(BUNDLED);
  return native || !getGeminiSelectorView().remoteKeys.has(KEY)
    ? native
    : button.closest<HTMLElement>(canvasMenuSelector());
}

function controllers(panel: HTMLElement, all = true): HTMLElement[] {
  if (!panel.id) return [];
  const elements = Array.from(
    panel.ownerDocument.querySelectorAll<HTMLElement>('[aria-controls], [aria-owns]'),
  );
  const associated = (element: HTMLElement) =>
    `${element.getAttribute('aria-controls') || ''} ${element.getAttribute('aria-owns') || ''}`
      .split(/\s+/)
      .includes(panel.id);
  if (all) return elements.filter(associated);
  const first = elements.find(associated);
  return first ? [first] : [];
}

function sourceWithin(owner: Element): HTMLElement | null {
  if (!getGeminiSelectorView().remoteKeys.has('canvas.documentEditors'))
    return owner.querySelector(packaged['canvasEntry.editor']);
  return (
    resolveCanvasDocumentRoots(owner.ownerDocument)
      .find((root) => owner.contains(root))
      ?.querySelector('.ProseMirror') ?? null
  );
}

function remoteMenuSource(panel: HTMLElement): HTMLElement | null {
  const triggers = controllers(panel);
  const trigger = triggers[0];
  if (
    !panel.matches('[role="menu"]') ||
    triggers.length !== 1 ||
    trigger.getAttribute('aria-expanded') !== 'true' ||
    trigger.closest(FOREIGN) ||
    panel.closest(FOREIGN) ||
    hasVoyagerOwner(trigger) ||
    hasVoyagerOwner(panel) ||
    !panel.querySelector(packaged['canvasEntry.downloadItem'])
  )
    return null;
  const owner = trigger.closest(OWNER);
  return owner ? sourceWithin(owner) : null;
}

/** Copy always rechecks the current menu association, including after deferred button insertion. */
export function canvasMenuSource(panel: HTMLElement): HTMLElement | null {
  if (panel.ownerDocument.querySelector('deep-research-immersive-panel')) return null;
  const view = getGeminiSelectorView();
  if (view.remoteKeys.has(KEY) && !panel.matches(BUNDLED)) {
    if (!panel.matches(view.profiles[KEY].join(','))) return null;
    return remoteMenuSource(panel);
  }
  const owner = (controllers(panel, false)[0] || panel).closest(OWNER);
  return owner ? sourceWithin(owner) : null;
}

export function canvasMenuSelector(doc: Document = document): string {
  const view = getGeminiSelectorView();
  if (
    locatorSiteForHost(doc.defaultView?.location.hostname ?? '') !== 'gemini' ||
    !view.remoteKeys.has(KEY)
  )
    return BUNDLED;
  try {
    const selector = view.profiles[KEY].join(',');
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    const native = Array.from(doc.querySelectorAll<HTMLElement>(BUNDLED));
    if (native.length) return sameItems(candidates, native) ? selector : BUNDLED;
    // A menu-shaped preview cannot borrow another Canvas's download action or document.
    return candidates.length && candidates.every((panel) => remoteMenuSource(panel))
      ? selector
      : BUNDLED;
  } catch {
    return BUNDLED;
  }
}
