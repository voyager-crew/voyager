import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperation,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
} from '../selectors';
import type { GeminiSidebarProfileKey } from '../selectors/sidebarKeys';

/** A joined query preserves DOM order; ordered fallbacks iterate `profiles[key]` instead. */
export function geminiSidebarSelector(
  key: GeminiSidebarProfileKey,
  view: GeminiSelectorView = getGeminiSelectorView(),
): string {
  return view.profiles[key].join(', ');
}

export function readGeminiSidebarElements(
  root: ParentNode,
  key: GeminiSidebarProfileKey,
  view: GeminiSelectorView,
): HTMLElement[] {
  return Array.from(root.querySelectorAll(geminiSidebarSelector(key, view))).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

/** Callers select a complete pure read before mounting, styling, clicking or storing. */
export function resolveGeminiSidebarOperation<T>(
  read: (view: GeminiSelectorView) => T,
  usable: (value: T) => boolean,
  view?: GeminiSelectorView,
): GeminiSelectorOperation<T> {
  return view
    ? resolveGeminiSelectorOperationInView(view, read, usable)
    : resolveGeminiSelectorOperation(read, usable);
}

export function closestGeminiSidebarElement(
  element: Element,
  key: GeminiSidebarProfileKey,
  view?: GeminiSelectorView,
): HTMLElement | null {
  return resolveGeminiSidebarOperation(
    (selected) => {
      const match = element.closest(geminiSidebarSelector(key, selected));
      return match instanceof HTMLElement ? match : null;
    },
    (match) => match !== null,
    view,
  ).value;
}

/** Packaged proof for action owners; a remote root never narrows deletion evidence. */
export function packagedGeminiSidebarRoot(): HTMLElement | null {
  const candidates = readGeminiSidebarElements(
    document,
    'sidebar.overflow',
    getBundledGeminiSelectorView(),
  );
  return firstVisibleSidebar(candidates);
}

export function firstVisibleSidebar(candidates: readonly HTMLElement[]): HTMLElement | null {
  return (
    candidates.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ??
    candidates[0] ??
    null
  );
}

/** Whether a cached folder-sidebar root may have been selected by the online channel. */
export function hasOnlineSidebarRoot(): boolean {
  return getGeminiSelectorView().remoteKeys.has('sidebar.overflow');
}
