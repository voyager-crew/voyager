import type { SiteAdapter } from '@/features/plugins/types';

export interface FindComposerOptions {
  readonly doc?: Document;
  /** Native health probes may count a folded composer as present. */
  readonly requireVisible?: boolean;
  /** Handoffs refuse ambiguous main composers instead of choosing one. */
  readonly requireUnique?: boolean;
}

const UNAVAILABLE = '[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]';
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password']);

export function isTextField(field: HTMLElement): field is HTMLTextAreaElement | HTMLInputElement {
  return (
    field instanceof HTMLTextAreaElement ||
    (field instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(field.type))
  );
}

export function isEditable(field: HTMLElement): boolean {
  if (field.matches(':disabled, [readonly]') || field.closest(UNAVAILABLE)) return false;
  return (
    isTextField(field) ||
    field.isContentEditable ||
    field.contentEditable === 'true' ||
    field.contentEditable === 'plaintext-only' ||
    field.matches('[contenteditable="true"], [contenteditable="plaintext-only"]')
  );
}

function isVisible(field: HTMLElement): boolean {
  if (field.getBoundingClientRect().height <= 0) return false;
  const view = field.ownerDocument.defaultView;
  for (let node: HTMLElement | null = field; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

/** Resolve only the adapter's composer, or an explicitly supplied selector. */
export function findComposer(
  adapterOrSelector: Pick<SiteAdapter, 'selectors'> | string | null,
  options: FindComposerOptions = {},
): HTMLElement | null {
  const selector =
    typeof adapterOrSelector === 'string'
      ? adapterOrSelector
      : adapterOrSelector?.selectors.composer;
  if (!selector) return null;
  const doc = options.doc ?? document;
  let candidates: HTMLElement[];
  try {
    candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isEditable);
  } catch {
    return null;
  }
  const visible = candidates.filter(isVisible);
  const usable = visible.length > 0 || options.requireVisible !== false ? visible : candidates;
  if (options.requireUnique && usable.length !== 1) return null;
  return usable[0] ?? null;
}
