import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';

export function aistudioAccountPrefix(pathname: string): string {
  return /^\/u\/\d+(?=\/)/.exec(pathname)?.[0] ?? '';
}

/** Remote reads cannot borrow a link from a reply, overlay or Voyager's folder tree. */
export function isOriginalAIStudioNavigation(element: Element): boolean {
  return (
    !hasVoyagerOwner(element) &&
    !element.closest(
      'main, [role="main"], dialog, [role="dialog"], [role="alertdialog"], [contenteditable="true"], ms-chat-turn, [data-turn-role]',
    )
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
    anchor.closest('dialog, [role="dialog"], [data-turn-role]')
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
