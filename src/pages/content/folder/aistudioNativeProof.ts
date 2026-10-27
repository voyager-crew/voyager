import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { aistudioAdapter } from '@/features/plugins/sites/adapters/aistudio';

const NAVIGATION = 'nav, [role="navigation"]';
const OVERLAY = 'dialog, [role="dialog"], [role="alertdialog"], [role="menu"]';

export function aistudioAccountPrefix(pathname: string): string {
  return /^\/u\/\d+(?=\/)/.exec(pathname)?.[0] ?? '';
}

/** Remote reads cannot borrow a link from a reply, overlay or Voyager's folder tree. */
export function isOriginalAIStudioNavigation(element: Element): boolean {
  if (
    hasVoyagerOwner(element) ||
    element.closest('[contenteditable="true"], ms-chat-turn, [data-turn-role]')
  )
    return false;
  // AI Studio has no proved app-root protocol here; copied navigation and a composer cannot certify an overlay.
  if (element.closest(OVERLAY)) return false;
  // The captured navbar is beside main; content tabs and breadcrumbs cannot supply sidebar links.
  if (element.closest('main, [role="main"]')) return false;
  // Content navigation and preview copies must not make the original sidebar ambiguous.
  const navigations = Array.from(element.ownerDocument.querySelectorAll(NAVIGATION)).filter(
    (navigation) =>
      !navigation.closest('main, [role="main"]') &&
      !navigation.closest(OVERLAY) &&
      !hasVoyagerOwner(navigation),
  );
  if (navigations.length !== 1) return false;
  const sidebar = navigations[0].parentElement;
  return Boolean(
    sidebar?.matches(aistudioAdapter.folders!.sidebar) &&
    sidebar.parentElement?.matches('ms-navbar-v2') &&
    sidebar.contains(element),
  );
}

export function nativeAIStudioPromptAnchor(anchor: Element): anchor is HTMLAnchorElement {
  if (!(anchor instanceof HTMLAnchorElement) || !isOriginalAIStudioNavigation(anchor)) return false;
  return nativePromptUrl(anchor);
}

function nativePromptUrl(anchor: HTMLAnchorElement): boolean {
  try {
    const doc = anchor.ownerDocument;
    const url = new URL(anchor.href, doc.location.href);
    return (
      url.origin === doc.location.origin &&
      aistudioAccountPrefix(url.pathname) === aistudioAccountPrefix(doc.location.pathname) &&
      /^\/(?:u\/\d+\/)?prompts\/[^/?#]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Table reads share the same immutable URL/account protocol, but tables live in main. */
export function nativeAIStudioLibraryAnchor(anchor: Element): anchor is HTMLAnchorElement {
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    hasLibraryVoyagerOwner(anchor) ||
    anchor.closest(`ms-chat-turn, [data-turn-role], ${OVERLAY}`)
  )
    return false;
  return nativePromptUrl(anchor);
}

const LIBRARY_DECORATIONS = new Set([
  'gv-conversation-archived',
  'gv-library-row-selected',
  'gv-multi-select-mode',
]);
function hasLibraryVoyagerOwner(anchor: Element): boolean {
  const doc = anchor.ownerDocument;
  for (
    let node: Element | null = anchor;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    // Hiding or selecting an original row must not make its next read look like Voyager content.
    if (
      node.matches('[data-gv-component], [data-gv-layer], [data-gv-plugin]') ||
      (hasVoyagerOwner(node, node.parentElement ?? undefined) &&
        Array.from(node.classList).some(
          (name) => name.startsWith('gv-') && !LIBRARY_DECORATIONS.has(name),
        ))
    )
      return true;
  }
  return false;
}
