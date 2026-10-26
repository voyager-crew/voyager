import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/vim-packaged.json';

const EDITABLE_SELECTOR = packaged['vim.editable'].join(',');

/** Wrapper selectors may contain several hidden editors; prefer the rendered control. */
export function resolveConfiguredComposer(
  selector: string,
  options: { requireVisible?: boolean } = {},
  doc: Document = document,
): HTMLElement | null {
  const requireVisible = options.requireVisible ?? true;
  let fallback: HTMLElement | null = null;
  try {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      if (!(element instanceof HTMLElement)) continue;
      const editables = element.matches(EDITABLE_SELECTOR)
        ? [element]
        : Array.from(element.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR));
      for (const editable of editables) {
        if (!fallback) fallback = editable;
        if (isVisibleHudMount(editable)) return editable;
      }
    }
  } catch {
    // Invalid selector from a site file: fall back to the generic lookup.
    return null;
  }
  return requireVisible ? null : fallback;
}

function hasVisibleLayout(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isElementHidden(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;

  const style = window.getComputedStyle?.(element);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

export function isVisibleHudMount(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || isElementHidden(element)) return false;
  return hasVisibleLayout(element);
}
