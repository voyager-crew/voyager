import { hasVoyagerOwner } from './composer/voyagerOwner';

const SIDEBAR = 'bard-sidenav, side-nav, side-navigation-content';
const CHAT = 'chat-window';
const COMPOSER = 'input-area, input-area-v2, input-container, .text-input-field, .input-area';
const CANVAS = 'immersive-panel, inline-preview';
const LANDMARK =
  'main, [role="main"], form, nav, [role="navigation"], dialog, [role="dialog"], [role="alertdialog"], [role="menu"], .sidebar, .mat-drawer, .mat-mdc-dialog-container';

const FOREIGN_PEER =
  'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], model-response, user-query, bot-editor, [contenteditable]:not([contenteditable="false"])';

function nativePeer(peer: Element, main: Element): boolean {
  if (hasVoyagerOwner(peer, main)) return false;
  for (
    let current: Element | null = peer;
    current && current !== main;
    current = current.parentElement
  ) {
    if (current.matches(FOREIGN_PEER)) return false;
  }
  return true;
}

function hasSeparateRegions(main: Element, left: string, right: string): boolean {
  return Array.from(main.querySelectorAll(left))
    .filter((peer) => nativePeer(peer, main))
    .some((first) =>
      Array.from(main.querySelectorAll(right))
        .filter((peer) => nativePeer(peer, main))
        .some((second) => !first.contains(second) && !second.contains(first)),
    );
}

/** The app's own outer main is independent of both the candidate and preview copies below it. */
function nativeMain(doc: Document): Element | null {
  const apps = Array.from(doc.querySelectorAll('chat-app')).filter(
    (app) => !app.parentElement?.closest('chat-app') && !hasVoyagerOwner(app),
  );
  if (apps.length > 1) return null;
  const scope = apps[0] ?? doc;
  const mains = Array.from(scope.querySelectorAll('main, [role="main"]')).filter((main) => {
    const ancestor = main.parentElement?.closest('main, [role="main"]');
    return (!ancestor || !scope.contains(ancestor)) && !hasVoyagerOwner(main);
  });
  if (mains.length !== 1) return null;
  const app = apps[0];
  const root = app?.parentElement;
  const trustedApp =
    root?.matches('chat-app-orchestrator#app-root') === true && !hasVoyagerOwner(root);
  if (
    !trustedApp &&
    mains[0].closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"]')
  )
    return null;
  return mains[0];
}

/** Native peers distinguish an app shell from a copied sidebar, editor or dialog preview. */
function isSharedShell(shell: Element): boolean {
  const main = nativeMain(shell.ownerDocument);
  if (!main || !shell.contains(main)) return false;
  return (
    hasSeparateRegions(main, SIDEBAR, `${CHAT}, ${COMPOSER}, ${CANVAS}`) ||
    hasSeparateRegions(main, CANVAS, `${CHAT}, ${COMPOSER}`)
  );
}

/** Test a packaged boundary, allowing only an outer landmark proved to wrap separate app regions. */
export function hasGeminiBoundaryConflict(
  element: Element,
  boundary: Element | null,
  excluded: string,
): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (!current.matches(excluded)) continue;
    // Gemini places sidebar and conversation under the same main; an outer landmark is not ownership.
    if (
      boundary &&
      current !== boundary &&
      current.matches(LANDMARK) &&
      current.contains(boundary) &&
      isSharedShell(current)
    )
      continue;
    return true;
  }
  return false;
}
