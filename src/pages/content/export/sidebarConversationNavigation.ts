/**
 * Opens the Gemini conversation behind a sidebar "⋮ → Export" menu so the
 * export dialog can run against it.
 *
 * Navigation goes through the sidebar's own link (a native SPA route change).
 * A hard navigation to the target URL happens only when no sidebar link exists.
 */
import { showExportAlert } from '../../../features/export/ui/exportToasts';
import { waitForAnyElement } from './domWait';
import type { ExportTranslate } from './exportLocale';
import { resolveSidebarConversationTarget } from './sidebarConversationTarget';

function conversationIdFromPathname(pathname: string): string | null {
  const appMatch = pathname.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  const gemMatch = pathname.match(/\/gem\/[^/]+\/([^/?#]+)/);
  if (gemMatch?.[1]) return gemMatch[1];
  return null;
}

/** Gemini conversation id of the current route (`/app/<id>` or `/gem/<gem>/<id>`). */
export function geminiConversationIdFromLocation(): string | null {
  return conversationIdFromPathname(window.location.pathname);
}

function conversationIdFromHref(href: string): string | null {
  if (!href) return null;
  try {
    return conversationIdFromPathname(new URL(href, window.location.origin).pathname);
  } catch {
    return null;
  }
}

function escapeCssAttributeValue(value: string): string {
  const escape = globalThis.CSS?.escape;
  if (typeof escape === 'function') {
    return escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findSidebarConversationLinkById(conversationId: string): HTMLAnchorElement | null {
  const escapedConversationId = escapeCssAttributeValue(conversationId);
  const byJslog = document.querySelector(
    `[data-test-id="conversation"][jslog*="c_${escapedConversationId}"] a[href]`,
  ) as HTMLAnchorElement | null;
  if (byJslog) return byJslog;

  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      '[data-test-id="conversation"] a[href], a[data-test-id="conversation"][href]',
    ),
  );
  for (const link of links) {
    if (conversationIdFromHref(link.href) === conversationId) {
      return link;
    }
  }

  return null;
}

function triggerNativeClick(target: HTMLElement): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  target.dispatchEvent(new MouseEvent('pointerdown', opts));
  target.dispatchEvent(new MouseEvent('mousedown', opts));
  target.dispatchEvent(new MouseEvent('mouseup', opts));
  target.dispatchEvent(new MouseEvent('click', opts));
}

async function waitForConversationUrl(
  conversationId: string,
  timeoutMs: number = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (geminiConversationIdFromLocation() === conversationId) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

async function navigateToConversationAndWait(
  conversationId: string,
  fallbackUrl: string,
  userSelectors: () => string[],
): Promise<boolean> {
  const currentConversationId = geminiConversationIdFromLocation();
  if (currentConversationId === conversationId) {
    const existing = await waitForAnyElement(userSelectors, 8000);
    return !!existing;
  }

  const link = findSidebarConversationLinkById(conversationId);
  if (link) {
    triggerNativeClick(link);
  } else if (fallbackUrl) {
    window.location.assign(fallbackUrl);
  } else {
    return false;
  }

  const routeReady = await waitForConversationUrl(conversationId, 12000);
  if (!routeReady) return false;
  const contentReady = await waitForAnyElement(userSelectors, 15000);
  return !!contentReady;
}

/**
 * Navigate to the conversation a sidebar menu trigger belongs to and wait
 * until its user turns render. Tells the user and resolves false when the
 * conversation cannot be located or opened.
 */
export async function openSidebarConversationForExport(
  trigger: HTMLElement,
  userSelectors: () => string[],
  t: ExportTranslate,
): Promise<boolean> {
  const target = resolveSidebarConversationTarget(trigger);
  if (!target) {
    showExportAlert(t('export_error_conversation_not_found'), t);
    return false;
  }

  const ready = await navigateToConversationAndWait(
    target.conversationId,
    target.url,
    userSelectors,
  );
  if (!ready) {
    showExportAlert(t('export_error_conversation_open_failed'), t);
    return false;
  }
  return true;
}
