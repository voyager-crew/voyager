import menuProtocol from '@/features/plugins/catalog/sites/gemini/selector-data/menu-packaged.json';

import { hasVoyagerOwner } from '../composer/ownedInput';
import { getGeminiSelectorView } from '../selectors';
import { GEMINI_PACKAGED_SIDEBAR_SELECTORS } from './packaged';

function nativeControl(element: Element): boolean {
  const archived = ['gv-conversation-archived', 'gv-conversation-archived-actions'];
  const decorated = Array.from(element.classList).some((name) => archived.includes(name));
  const voyager = decorated
    ? (!!element.parentElement && hasVoyagerOwner(element.parentElement)) ||
      Array.from(element.classList).some(
        (name) => name.startsWith('gv-') && !archived.includes(name),
      )
    : hasVoyagerOwner(element);
  return (
    element.isConnected &&
    !voyager &&
    !element.closest(
      'model-response, user-query, form, [contenteditable]:not([contenteditable="false"]), input, textarea, select, dialog, [role="dialog"], [role="alertdialog"], [role="menu"]',
    )
  );
}

/** An expanded-state control must name the independently recognisable sidenav. */
export function isProvenGeminiSidebarToggle(button: Element): button is HTMLButtonElement {
  if (!(button instanceof HTMLButtonElement) || !nativeControl(button) || button.disabled)
    return false;
  const expanded = button.getAttribute('aria-expanded');
  const id = button.getAttribute('aria-controls');
  const sidebar = id && button.ownerDocument.getElementById(id);
  return (
    (expanded === 'true' || expanded === 'false') &&
    !!sidebar &&
    sidebar.matches(GEMINI_PACKAGED_SIDEBAR_SELECTORS.sidenav) &&
    nativeControl(sidebar) &&
    Array.from(
      button.ownerDocument.querySelectorAll(GEMINI_PACKAGED_SIDEBAR_SELECTORS.sidenav),
    ).filter(nativeControl).length === 1
  );
}

export function remoteGeminiSidebarToggle(doc: Document = document): HTMLButtonElement | null {
  const view = getGeminiSelectorView();
  if (!view.remoteKeys.has('sidebar.toggleButton')) return null;
  const matches = Array.from(doc.querySelectorAll(view.profiles['sidebar.toggleButton'].join(',')));
  // A remotely named button must never borrow another control's sidebar association.
  if (!matches.length || !matches.every(isProvenGeminiSidebarToggle)) return null;
  return (
    matches.find((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? matches[0]
  );
}

export function findGeminiNewChat(doc: Document = document): HTMLElement | null {
  const view = getGeminiSelectorView();
  if (view.remoteKeys.has('sidebar.newChat')) {
    const matches = Array.from(doc.querySelectorAll(view.profiles['sidebar.newChat'].join(',')));
    const location = doc.defaultView?.location;
    const prefix = location?.pathname.match(/^\/u\/\d+/)?.[0] ?? '';
    if (
      location &&
      matches.length === 1 &&
      matches[0] instanceof HTMLAnchorElement &&
      nativeControl(matches[0])
    ) {
      const url = new URL(matches[0].href, location.href);
      // Never let a renamed new-chat link navigate to another account, Gem or origin.
      if (
        url.origin === location.origin &&
        url.pathname.replace(/\/$/, '') === `${prefix}/app` &&
        !url.search &&
        !url.hash
      )
        return matches[0];
    }
  }
  return doc.querySelector<HTMLElement>(GEMINI_PACKAGED_SIDEBAR_SELECTORS.newChat);
}

/** A legacy sibling action owner must be associated with exactly this native conversation row. */
export function remoteGeminiActionsContainer(row: HTMLElement): HTMLElement | null {
  const view = getGeminiSelectorView();
  const parent = row.parentElement;
  if (!view.remoteKeys.has('sidebar.actionsContainer') || !parent || !nativeControl(row))
    return null;
  const rows = parent.querySelectorAll('[data-test-id="conversation"]');
  if (rows.length !== 1 || rows[0] !== row) return null;
  const matches = Array.from(
    parent.querySelectorAll<HTMLElement>(view.profiles['sidebar.actionsContainer'].join(',')),
  );
  if (matches.length !== 1) return null;
  const candidate = matches[0];
  if (
    candidate === row ||
    candidate.contains(row) ||
    row.contains(candidate) ||
    !nativeControl(candidate)
  )
    return null;
  const controls = candidate.querySelectorAll<HTMLButtonElement>(
    'button[aria-haspopup="menu"][aria-controls]',
  );
  if (controls.length !== 1 || !controls[0].matches(menuProtocol['menu.conversationTriggers']))
    return null;
  const id = controls[0].getAttribute('aria-controls');
  const menu = id && row.ownerDocument.getElementById(id);
  // A sibling wrapper alone cannot prove that these actions belong to the row being hidden.
  return menu &&
    menu.getAttribute('role') === 'menu' &&
    menu.getAttribute('aria-labelledby') === controls[0].id &&
    !!controls[0].id
    ? candidate
    : null;
}
