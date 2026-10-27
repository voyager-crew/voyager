import { hasVoyagerOwner } from '../composer/ownedInput';
import { hasGeminiBoundaryConflict } from '../domBoundary';
import type { GeminiSidebarProfileKey } from '../selectors/sidebarKeys';

const FOREIGN =
  'bard-sidenav-content, chat-window, model-response, user-query, [data-message-author-role], [contenteditable]:not([contenteditable="false"]), input, textarea, select';
const LANDMARKS =
  'main, [role="main"], form, dialog, [role="dialog"], [role="alertdialog"], [role="menu"]';
const SIDEBAR = 'bard-sidenav, side-nav, side-navigation-content';
const APP = 'chat-app, #app-root';
const CONTENT =
  '[data-test-id="conversation"], [storagekey="chats"], [storagekey="notebooks"], [data-test-id="chats-expandable-section"], mat-nav-list';

/** Prefer the complete sidebar over nested conversation-list navigation landmarks. */
export function getGeminiSidebarOwner(element: Element): Element | null {
  return (
    element.closest('bard-sidenav, side-nav') ??
    element.closest('side-navigation-content') ??
    element.closest('nav, aside, [role="navigation"]')
  );
}

function originalElement(element: Element, boundary: Element | null = element): boolean {
  return (
    element !== element.ownerDocument.body &&
    element !== element.ownerDocument.documentElement &&
    element.isConnected &&
    !hasVoyagerOwner(element) &&
    !element.closest(FOREIGN) &&
    !hasGeminiBoundaryConflict(element, boundary, LANDMARKS)
  );
}

/** Sidebar identity is native evidence; shared app landmarks do not own its descendants. */
export function isOriginalGeminiSidebarNode(element: Element): boolean {
  const owner = getGeminiSidebarOwner(element);
  return owner !== null && originalElement(element, owner);
}

function isUniqueSidebarOwner(owner: Element): boolean {
  const owners = new Set<Element>();
  for (const native of owner.ownerDocument.querySelectorAll(SIDEBAR)) {
    const candidate = getGeminiSidebarOwner(native);
    if (candidate && originalElement(candidate, candidate)) owners.add(candidate);
  }
  // A complete native-looking copy outside the chat or overlays is still an ambiguous owner.
  return owners.size === 1 && owners.has(owner);
}

/** Native sidebar content remains independently identifiable when a containing tag is renamed. */
function sidebarRegion(element: HTMLElement): boolean {
  if (
    element.matches(`${SIDEBAR}, ${APP}`) ||
    element.querySelector('main, [role="main"], chat-window')
  )
    return false;
  const owner = getGeminiSidebarOwner(element);
  if (!owner || !isUniqueSidebarOwner(owner)) return false;
  const content = Array.from(owner.querySelectorAll(CONTENT)).filter((node) =>
    originalElement(node, owner),
  );
  return content.length > 0 && content.every((node) => element.contains(node));
}

function sidebarHost(element: HTMLElement): boolean {
  if (element.querySelector('main, [role="main"], chat-window')) return false;
  const contents = element.querySelectorAll('side-navigation-content');
  const owner = getGeminiSidebarOwner(contents[0] ?? element);
  if (!owner || !isUniqueSidebarOwner(owner)) return false;
  if (contents.length === 1 && contents[0].parentElement === element) return true;
  return (
    element.matches('nav, aside, [role="navigation"]') &&
    element.querySelector(
      '[data-test-id="conversation"] a[href], a[data-test-id="conversation"][href]',
    ) !== null
  );
}

function stateOwner(
  key: 'sidebar.openHost' | 'sidebar.visibilityHost',
  element: HTMLElement,
): boolean {
  if (element.matches('bard-sidenav-container')) return false;
  const sidebar = element.querySelector(SIDEBAR);
  if (!sidebar) return false;
  if (key === 'sidebar.openHost') return sidebar.closest('.side-nav-open') === element;
  const mains = Array.from(element.ownerDocument.querySelectorAll('main, [role="main"]')).filter(
    (main) =>
      !main.parentElement?.closest('main, [role="main"]') &&
      !hasVoyagerOwner(main) &&
      !main.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"]'),
  );
  // Closing removes the state class; only native outer mains can establish the app owner.
  return mains.length === 1 && mains[0].parentElement === element;
}

/** Proof belongs to the operation's original element, never to a remote locator's spelling. */
export function acceptsGeminiSidebarElement(
  key: GeminiSidebarProfileKey,
  element: HTMLElement | null,
  original: HTMLElement | null,
): element is HTMLElement {
  if (!element) return false;
  if (original) return element === original;
  if (!originalElement(element, getGeminiSidebarOwner(element) ?? element)) return false;
  if (key === 'sidebar.overflow') return sidebarRegion(element);
  if (key === 'sidebar.host') return sidebarHost(element);
  if (key === 'sidebar.openHost' || key === 'sidebar.visibilityHost')
    return stateOwner(key, element);
  if (key === 'sidebar.interactionButton')
    return element.matches('button, [role="button"]') && !!element.closest(SIDEBAR);
  return false;
}

/** A repaired paginator is the original row's innermost native scrolling ancestor. */
export function acceptsGeminiSidebarScroller(
  row: HTMLElement,
  candidate: HTMLElement | null,
  original: HTMLElement | null,
): candidate is HTMLElement {
  if (!candidate) return false;
  if (original) return candidate === original;
  const boundary = getGeminiSidebarOwner(row);
  if (
    !boundary ||
    !originalElement(row, boundary) ||
    !originalElement(candidate, boundary) ||
    !row.matches('[data-test-id="conversation"]') ||
    !boundary.contains(candidate)
  )
    return false;
  for (
    let parent = row.parentElement;
    parent && boundary.contains(parent);
    parent = parent.parentElement
  ) {
    if (
      /^(auto|scroll|overlay)$/.test(
        getComputedStyle(parent).overflowY || getComputedStyle(parent).overflow,
      )
    )
      return parent === candidate;
  }
  return false;
}
