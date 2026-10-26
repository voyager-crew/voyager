import { getBundledSiteSelectorView } from './bundle';
import type { SiteSelectorView } from './types';

/** A catalog mount may move our UI, but must never insert it into the host editor. */
export function isSafePlacementMount(element: Element): boolean {
  return isSafePlacementTarget(element) && !element.closest('button');
}

function isSafePlacementTarget(element: Element): boolean {
  return !element.closest(
    '[contenteditable]:not([contenteditable="false"]), input, textarea, select, option, [role="textbox"], [role="combobox"]',
  );
}

type PlacementResult = Element | readonly Element[] | null;
interface PlacementOptions {
  /** Pure measurement can inspect controls; only the final insertion target is a mount. */
  readonly mount?: boolean;
  readonly fallback?: readonly string[];
}

export function resolvePlacementViewOperation<T extends PlacementResult>(
  view: SiteSelectorView,
  keys: readonly string[],
  read: (view: SiteSelectorView) => T,
  mount = true,
): T {
  const bundle = getBundledSiteSelectorView(view.siteId);
  if (keys.some((key) => view.remoteKeys.has(key))) {
    try {
      const value = read(view);
      const nodes = value === null ? [] : Array.isArray(value) ? value : [value as Element];
      if (nodes.length && nodes.every(mount ? isSafePlacementMount : isSafePlacementTarget))
        return value;
    } catch {
      // A rejected placement retries the complete operation with bundled candidates.
    }
  }
  return read(bundle);
}

/** One operation, one fallback. OFF does only the original bundled query. */
export function resolvePlacementOperation<T extends PlacementResult>(
  view: SiteSelectorView,
  key: string,
  read: (selector: string) => T,
  options: PlacementOptions = {},
): T {
  return resolvePlacementListOperation(
    view,
    key,
    (selectors) => read(selectors.join(',')),
    options,
  );
}

export function resolvePlacementListOperation<T extends PlacementResult>(
  view: SiteSelectorView,
  key: string,
  read: (selectors: readonly string[]) => T,
  options: PlacementOptions = {},
): T {
  const fallback = options.fallback ?? getBundledSiteSelectorView(view.siteId).profiles[key];
  if (view.remoteKeys.has(key)) {
    try {
      const value = read(view.profiles[key]);
      const elements = value === null ? [] : Array.isArray(value) ? value : [value as Element];
      if (
        elements.length > 0 &&
        elements.every(options.mount === false ? isSafePlacementTarget : isSafePlacementMount)
      )
        return value;
    } catch {
      // Invalid/retired DOM reads leave the installed behavior available.
    }
  }
  return read(fallback);
}

/** Selector-only seams still validate against the operation's own query root. */
export function placementSelector(
  view: SiteSelectorView,
  key: string,
  root: ParentNode,
  options: PlacementOptions = {},
): string {
  let selected = options.fallback ?? getBundledSiteSelectorView(view.siteId).profiles[key];
  if (!view.remoteKeys.has(key)) return selected.join(',');
  const remote = view.profiles[key];
  resolvePlacementOperation(
    view,
    key,
    (selector) => {
      const matches = Array.from(root.querySelectorAll(selector));
      if (
        matches.length &&
        matches.every(options.mount === false ? isSafePlacementTarget : isSafePlacementMount)
      )
        selected = selector === remote.join(',') ? remote : selected;
      return matches;
    },
    options,
  );
  return selected.join(',');
}
