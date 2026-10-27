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

/** Native sidebar content remains independently identifiable when a containing tag is renamed. */
function sidebarRegion(element: HTMLElement): boolean {
  if (
    element.matches(`${SIDEBAR}, ${APP}`) ||
    element.querySelector('main, [role="main"], chat-window')
  )
    return false;
  const owner = getGeminiSidebarOwner(element);
  if (!owner) return false;
  const content = Array.from(owner.querySelectorAll(CONTENT)).filter((node) =>
    originalElement(node, owner),
  );
  return content.length > 0 && content.every((node) => element.contains(node));
}

function sidebarHost(element: HTMLElement): boolean {
  if (element.querySelector('main, [role="main"], chat-window')) return false;
  const contents = element.querySelectorAll('side-navigation-content');
  if (contents.length === 1 && contents[0].parentElement === element) return true;
  return (
    element.matches('nav, aside, [role="navigation"]') &&
    element.querySelector(
      '[data-test-id="conversation"] a[href], a[data-test-id="conversation"][href]',
    ) !== null
  );
}

function stateOwner(element: HTMLElement): boolean {
  if (element.matches('bard-sidenav-container')) return false;
  const sidebar = element.querySelector(SIDEBAR);
  return sidebar !== null && sidebar.closest('.side-nav-open') === element;
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
  if (key === 'sidebar.openHost' || key === 'sidebar.visibilityHost') return stateOwner(element);
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
