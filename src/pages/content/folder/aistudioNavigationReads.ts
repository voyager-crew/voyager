import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
  type SiteSelectorView,
} from '@/core/selectors';

import {
  aistudioAccountPrefix,
  isOriginalAIStudioNavigation,
  nativeAIStudioPromptAnchor,
} from './aistudioNativeProof';

const selector = (view: SiteSelectorView, key: string): string => view.profiles[key].join(',');
const bundle = () => getBundledSiteSelectorView('aistudio');
const nativeLinks = (root: ParentNode): HTMLAnchorElement[] =>
  Array.from(root.querySelectorAll('a[href]')).filter(nativeAIStudioPromptAnchor);

function nativeLibraryLink(anchor: Element): boolean {
  if (!(anchor instanceof HTMLAnchorElement) || !isOriginalAIStudioNavigation(anchor)) return false;
  const doc = anchor.ownerDocument;
  const url = new URL(anchor.href, doc.location.href);
  return (
    url.origin === doc.location.origin &&
    aistudioAccountPrefix(url.pathname) === aistudioAccountPrefix(doc.location.pathname) &&
    /^\/(?:u\/\d+\/)?library\/?$/.test(url.pathname)
  );
}

/** The navigation landmark and its current-account Library URL prove the sidebar owner. */
export function readAIStudioSidebar(
  doc: Document = document,
  bundledSelector = selector(bundle(), 'navigation.sidebar'),
): HTMLElement | null {
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    doc.querySelector<HTMLElement>(
      candidate.remoteKeys.has('navigation.sidebar')
        ? selector(candidate, 'navigation.sidebar')
        : bundledSelector,
    );
  if (!view.remoteKeys.has('navigation.sidebar')) return read(bundle());
  const expected = read(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected) return actual === expected;
    if (!actual || !isOriginalAIStudioNavigation(actual)) return false;
    const landmarks = Array.from(
      doc.querySelectorAll<HTMLElement>('nav, [role="navigation"]'),
    ).filter(
      (nav) =>
        isOriginalAIStudioNavigation(nav) &&
        Array.from(nav.querySelectorAll('a[href]')).some(nativeLibraryLink),
    );
    // A remote wrapper cannot absorb an unrelated main panel or a second navigation landmark.
    return (
      landmarks.length === 1 &&
      (actual === landmarks[0] ||
        (landmarks[0].parentElement === actual &&
          Array.from(actual.children).filter(isOriginalAIStudioNavigation).length === 1))
    );
  }).value;
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
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    sidebar.querySelector<HTMLElement>(selector(candidate, 'navigation.navChild'));
  if (!view.remoteKeys.has('navigation.navChild')) return read(bundle());
  const expected = read(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected) return actual === expected;
    const native = Array.from(sidebar.children).filter((child) =>
      child.matches('nav, [role="navigation"]'),
    );
    return native.length === 1 && actual === native[0] && isOriginalAIStudioNavigation(actual);
  }).value;
}

export function readAIStudioHistoryRoot(doc: Document = document): HTMLElement | null {
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    doc.querySelector<HTMLElement>(selector(candidate, 'navigation.historyRoot'));
  if (!view.remoteKeys.has('navigation.historyRoot')) return read(bundle());
  const expected = read(bundle());
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected) return actual === expected;
    const sidebar = readAIStudioSidebar(doc);
    if (!actual || !sidebar?.contains(actual) || !isOriginalAIStudioNavigation(actual))
      return false;
    const lists = Array.from(sidebar.querySelectorAll<HTMLElement>('ul, ol, [role="list"]')).filter(
      (list) => nativeLinks(list).length > 0,
    );
    const links = nativeLinks(sidebar);
    const owned = nativeLinks(actual);
    const parent = actual.parentElement;
    // The legacy insertion moves before the list's wrapper, so that wrapper must own only this list.
    return (
      lists.length === 1 &&
      actual === lists[0] &&
      links.length > 0 &&
      owned.length === links.length &&
      owned.every((link, index) => link === links[index]) &&
      parent !== sidebar &&
      parent?.children.length === 1 &&
      parent.parentElement === sidebar
    );
  }).value;
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
    const sidebar = readAIStudioSidebar(doc);
    if (!actual || !sidebar || !nativeAIStudioPromptAnchor(actual)) return false;
    const matches = nativeLinks(sidebar).filter(
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
