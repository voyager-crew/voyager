import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { sameItems } from '@/core/utils/array';
import {
  queryOutsideThoughts,
  shouldSkipElement,
} from '@/features/export/services/exportDomPolicy';

import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '../selectors';

const THOUGHTS_AND_ACTIONS =
  'model-thoughts, .thoughts-container, .thoughts-content, message-actions, .message-actions';

/** The native content leaves are independent of every online locator. */
export function readGeminiContentLeaves(root: Element): Node[] {
  const leaves: Node[] = [];
  const visit = (node: Node): void => {
    if (node instanceof Element) {
      if (node.matches(THOUGHTS_AND_ACTIONS) || shouldSkipElement(node)) return;
      if (node.shadowRoot || node.matches('img, canvas, svg, math, br, hr')) {
        leaves.push(node);
        return;
      }
    }
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) leaves.push(node);
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return leaves;
}

function belongsToHost(candidate: Element, host: Element): boolean {
  let current: Element | null = candidate;
  while (current && current !== host) {
    if (
      current.matches(
        'model-response, user-query, .conversation-container, [data-turn="user"], [data-turn="assistant"], [data-turn="model"]',
      )
    )
      return false;
    current = current.parentElement;
  }
  return current === host;
}

/** A repaired root cannot cut away a heading, code block, link, math or image protocol frame. */
export function preservesGeminiContentFrames(candidate: Element, host: Element): boolean {
  let current: Element | null = candidate;
  while (current && current !== host) {
    // Angular's custom elements and presentation attributes wrap real answers; only
    // content protocol frames are unsafe to skip when extraction starts at the repair.
    if (
      current.matches(
        'h1, h2, h3, h4, h5, h6, p, pre, code, a, ul, ol, li, dl, dt, dd, table, thead, tbody, tfoot, tr, th, td, blockquote, b, strong, em, i, u, s, sub, sup, figure, figcaption, math, img, svg, canvas, code-block, table-block, single-image, generated-image, .code-block, .math-block, .math-inline, .katex, .katex-display, .image-container, .attachment-container, .generated-images, [data-math], [data-full-size-image-uri], [role="heading"], [role="link"], [role="listitem"], [role="table"], [role="math"]',
      ) ||
      Array.from(current.classList).some((name) => name.startsWith('gv-'))
    )
      return false;
    current = current.parentElement;
  }
  return current === host;
}

function readAnswer(host: HTMLElement, view: GeminiSelectorView): HTMLElement | null {
  for (const selector of view.profiles['content.answer']) {
    const match = queryOutsideThoughts<HTMLElement>(host, selector);
    if (match) return match;
  }
  return null;
}

export function bundledGeminiAnswerElement(host: HTMLElement): HTMLElement {
  return readAnswer(host, getBundledGeminiSelectorView()) ?? host;
}

/**
 * Select the whole answer before extraction can mark code/images. A renamed container is
 * accepted only when it contains all native content of the exact response passed by its owner.
 */
export function resolveGeminiAnswerElement(
  host: HTMLElement,
  fallback: () => HTMLElement = () => bundledGeminiAnswerElement(host),
  view: GeminiSelectorView = getGeminiSelectorView(),
): HTMLElement {
  if (!view.remoteKeys.has('content.answer')) return fallback();
  try {
    const candidate = readAnswer(host, view);
    const bundled = readAnswer(host, getBundledGeminiSelectorView());
    // A matching fragment must never replace a complete answer or another response's content.
    if (!candidate || !belongsToHost(candidate, host) || candidate.closest(THOUGHTS_AND_ACTIONS))
      return fallback();
    if (bundled) {
      // A caller may already have accepted message-content itself; descending again loses siblings.
      const expected = fallback();
      return candidate === expected ? candidate : expected;
    }
    const native = readGeminiContentLeaves(host);
    return native.length > 0 &&
      preservesGeminiContentFrames(candidate, host) &&
      sameItems(readGeminiContentLeaves(candidate), native)
      ? candidate
      : fallback();
  } catch {
    return fallback();
  }
}

export function readGeminiUserLines(
  host: Element,
  view: GeminiSelectorView = getGeminiSelectorView(),
): NodeListOf<HTMLElement> {
  const bundle = getBundledGeminiSelectorView();
  const read = (selected: GeminiSelectorView) =>
    host.querySelectorAll<HTMLElement>(selected.profiles['content.userLines'].join(','));
  const bundled = read(bundle);
  if (!view.remoteKeys.has('content.userLines')) return bundled;
  try {
    const candidates = read(view);
    if (bundled.length > 0)
      return sameItems(Array.from(candidates), Array.from(bundled)) ? candidates : bundled;
    // Native paragraphs preserve line boundaries; text-equivalent wrappers could change Markdown.
    const native = Array.from(host.querySelectorAll<HTMLElement>('p')).filter(
      (line) =>
        belongsToHost(line, host) &&
        !line.closest('button, user-query-file-preview') &&
        !hasVoyagerOwner(line, host),
    );
    const text = (nodes: readonly Node[]) =>
      nodes.filter(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          !node.parentElement?.closest('user-query-file-preview') &&
          (!node.parentElement || !hasVoyagerOwner(node.parentElement, host)),
      );
    const complete = sameItems(
      text(native.flatMap(readGeminiContentLeaves)),
      text(readGeminiContentLeaves(host)),
    );
    return native.length > 0 && complete && sameItems(Array.from(candidates), native)
      ? candidates
      : bundled;
  } catch {
    return bundled;
  }
}

/** A pure read used on the detached capture clone, before image fetching starts. */
export function readGeminiContextImages(
  host: HTMLElement,
  view: GeminiSelectorView = getGeminiSelectorView(),
): HTMLImageElement[] {
  const bundle = getBundledGeminiSelectorView();
  const read = (selected: GeminiSelectorView) =>
    Array.from(
      host.querySelectorAll<HTMLImageElement>(selected.profiles['context.images'].join(',')),
    );
  const bundled = read(bundle);
  if (!view.remoteKeys.has('context.images')) return bundled;
  try {
    const candidates = read(view);
    if (bundled.length > 0) return sameItems(candidates, bundled) ? candidates : bundled;
    const native = Array.from(host.querySelectorAll<HTMLImageElement>('img')).filter(
      (image) =>
        belongsToHost(image, host) &&
        !image.closest('button, mat-icon, message-actions') &&
        !hasVoyagerOwner(image, host),
    );
    // A plain img can be an avatar or decorative icon; only the native full-size source
    // attribute proves a renamed content image, and every eligible image must be accounted for.
    return native.length > 0 &&
      native.every((image) => image.closest('[data-full-size-image-uri]')) &&
      sameItems(candidates, native)
      ? candidates
      : bundled;
  } catch {
    return bundled;
  }
}

/** Validate a complete export/fork collection before any member may commit extraction markers. */
export function acceptsGeminiContentCollection(
  users: readonly HTMLElement[],
  assistants: readonly HTMLElement[],
  view: GeminiSelectorView,
): boolean {
  if (view.remoteKeys.has('content.answer')) {
    for (const host of assistants) {
      const candidate = readAnswer(host, view);
      if (
        !candidate ||
        resolveGeminiAnswerElement(host, () => bundledGeminiAnswerElement(host), view) !== candidate
      )
        return false;
    }
  }
  if (view.remoteKeys.has('content.userLines')) {
    for (const host of users) {
      const candidate = Array.from(
        host.querySelectorAll<HTMLElement>(view.profiles['content.userLines'].join(',')),
      );
      if (!sameItems(candidate, Array.from(readGeminiUserLines(host, view)))) return false;
    }
  }
  return true;
}

/** Query probes are pure; a capture chooses one view for every message before fetching images. */
export function acceptsGeminiContextImages(host: HTMLElement, view: GeminiSelectorView): boolean {
  if (!view.remoteKeys.has('context.images')) return true;
  try {
    const raw = Array.from(
      host.querySelectorAll<HTMLImageElement>(view.profiles['context.images'].join(',')),
    );
    return sameItems(raw, readGeminiContextImages(host, view));
  } catch {
    return false;
  }
}
