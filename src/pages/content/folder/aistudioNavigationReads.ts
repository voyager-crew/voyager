import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
  type SiteSelectorView,
} from '@/core/selectors';
import { resolvePlacementOperation } from '@/core/selectors/placement';

import { isOriginalAIStudioNavigation, nativeAIStudioPromptAnchor } from './aistudioNativeProof';

const selector = (view: SiteSelectorView, key: string): string => view.profiles[key].join(',');
const bundle = () => getBundledSiteSelectorView('aistudio');
const nativeLinks = (root: ParentNode): HTMLAnchorElement[] =>
  Array.from(root.querySelectorAll('a[href]')).filter(nativeAIStudioPromptAnchor);

/** This owner only places Voyager UI; native URL proofs never depend on it. */
export function readAIStudioSidebar(
  doc: Document = document,
  bundledSelector = selector(bundle(), 'navigation.sidebar'),
): HTMLElement | null {
  return resolvePlacementOperation(
    getSiteSelectorView('aistudio'),
    'navigation.sidebar',
    (query) => doc.querySelector<HTMLElement>(query),
    { fallback: [bundledSelector] },
  );
}

/** Observer prefilter only; the consumer must call the guarded read before mounting. */
export function mayContainAIStudioSidebar(node: Element): boolean {
  const view = getSiteSelectorView('aistudio');
  const query = view.remoteKeys.has('navigation.sidebar')
    ? `${selector(bundle(), 'navigation.sidebar')}, ${selector(view, 'navigation.sidebar')}`
    : selector(view, 'navigation.sidebar');
  return node.matches(query) || Boolean(node.querySelector(query));
}

export function readAIStudioNavChild(sidebar: Element | null): HTMLElement | null {
  if (!sidebar) return null;
  return resolvePlacementOperation(
    getSiteSelectorView('aistudio'),
    'navigation.navChild',
    (query) => sidebar.querySelector<HTMLElement>(query),
  );
}

export function readAIStudioHistoryRoot(doc: Document = document): HTMLElement | null {
  // The actual insertion is before the history wrapper; never insert within an editable wrapper.
  return resolvePlacementOperation(
    getSiteSelectorView('aistudio'),
    'navigation.historyRoot',
    (query) => doc.querySelector<HTMLElement>(query),
  );
}

export function readAIStudioNavigationSlot(
  root: Element,
  key: 'navigation.anchorSteps' | 'navigation.empty' | 'navigation.bottom',
): HTMLElement | null {
  return resolvePlacementOperation(getSiteSelectorView('aistudio'), key, (query) =>
    root.querySelector<HTMLElement>(query),
  );
}

export function readAIStudioPromptLink(
  promptId: string,
  escapedId: string,
  doc: Document = document,
): HTMLAnchorElement | null {
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    doc.querySelector<HTMLAnchorElement>(
      candidate.profiles['navigation.promptLink']
        .map((query) => `${query}[href*="/prompts/${escapedId}"]`)
        .join(','),
    );
  if (!view.remoteKeys.has('navigation.promptLink')) return read(bundle());
  const expected = read(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected) return actual === expected;
    if (!actual || !nativeAIStudioPromptAnchor(actual)) return false;
    const matches = nativeLinks(doc).filter(
      (anchor) => new URL(anchor.href).pathname.replace(/\/$/, '').split('/').at(-1) === promptId,
    );
    return matches.length === 1 && actual === matches[0];
  }).value;
}

export function readAIStudioPromptClick(target: Element, root: HTMLElement): Element | null {
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    target.closest(selector(candidate, 'history.click'));
  if (!view.remoteKeys.has('history.click')) return read(bundle());
  const expected = read(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) =>
    expected
      ? actual === expected
      : Boolean(actual && root.contains(actual) && nativeAIStudioPromptAnchor(actual)),
  ).value;
}

export function readAIStudioDragHost(anchor: HTMLAnchorElement): HTMLElement {
  const view = getSiteSelectorView('aistudio');
  const locate = (candidate: SiteSelectorView): HTMLElement | null => {
    for (const query of candidate.profiles['history.dragHosts']) {
      const match = anchor.closest<HTMLElement>(query);
      if (match) return match;
    }
    return null;
  };
  const read = (candidate: SiteSelectorView) => locate(candidate) ?? anchor.parentElement ?? anchor;
  if (!view.remoteKeys.has('history.dragHosts')) return read(bundle());
  const expected = locate(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected) return actual === expected;
    if (!nativeAIStudioPromptAnchor(anchor) || !isOriginalAIStudioNavigation(actual)) return false;
    const links = nativeLinks(actual);
    const siblings = Array.from(actual.parentElement?.children ?? []);
    // Each sibling row owns exactly one prompt; the list itself is never a drag source for one chat.
    return (
      links.length === 1 &&
      links[0] === anchor &&
      siblings.length > 1 &&
      siblings.every((sibling) => nativeLinks(sibling).length === 1)
    );
  }).value;
}
