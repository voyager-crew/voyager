import { getBundledSiteSelectorView } from './bundle';
import type { SiteSelectorView } from './types';

const INTERACTIVE_MOUNT =
  'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="switch"], [role="checkbox"], [role="radio"], [role="treeitem"], [role="tab"], [role="option"], [role="slider"], summary, label, pre, code';

function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Catalog mounts must not make Voyager controls activate a host action or alter copied code. */
export function isSafePlacementMount(element: Element, decorationOwner?: HTMLElement): boolean {
  if (!isSafePlacementTarget(element)) return false;
  // A slot can put a light-DOM mount inside a shadow button; closest() misses that host action.
  for (let current: Element | null = element; current; current = composedParent(current)) {
    if (!current.matches(INTERACTIVE_MOUNT)) continue;
    // Picker stars may cross only their native row, never nested or surrounding controls.
    if (
      current !== decorationOwner ||
      !(
        decorationOwner.localName === 'gem-menu-item' ||
        decorationOwner.matches('button[role="menuitem"], button[role="menuitemradio"]')
      )
    )
      return false;
  }
  return true;
}

function isSafePlacementTarget(element: Element): boolean {
  for (let current: Element | null = element; current; current = composedParent(current)) {
    if (
      current.matches(
        '[contenteditable]:not([contenteditable="false"]), input, textarea, select, option, [role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]',
      )
    )
      return false;
  }
  return true;
}

type PlacementResult = Element | readonly Element[] | null;
interface PlacementOptions {
  /** Pure measurement can inspect controls; only the final insertion target is a mount. */
  readonly mount?: boolean;
  readonly fallback?: readonly string[];
  /** Narrow exception for the existing star decoration inside a native picker button row. */
  readonly decorationOwner?: HTMLElement;
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
      if (
        nodes.length &&
        nodes.every((node) => (mount ? isSafePlacementMount(node) : isSafePlacementTarget(node)))
      )
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
        elements.every((element) =>
          options.mount === false
            ? isSafePlacementTarget(element)
            : isSafePlacementMount(element, options.decorationOwner),
        )
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
        matches.every((element) =>
          options.mount === false
            ? isSafePlacementTarget(element)
            : isSafePlacementMount(element, options.decorationOwner),
        )
      )
        selected = selector === remote.join(',') ? remote : selected;
      return matches;
    },
    options,
  );
  return selected.join(',');
}
