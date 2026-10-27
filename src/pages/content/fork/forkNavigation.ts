import { logger } from '@/core/services/LoggerService';

import { findForkSidebarLink } from './forkSidebar';
import type { ForkNode } from './forkTypes';

function readConversationRoute(url: URL): { path: string; id: string; account: string } | null {
  const match = url.pathname.match(/^(?:\/u\/(\d+))?(\/app\/([^/]+)|\/gem\/[^/]+\/([^/]+))\/?$/);
  if (!match) return null;
  try {
    return {
      path: match[2],
      id: decodeURIComponent(match[3] ?? match[4]),
      account: match[1] ?? '0',
    };
  } catch {
    return null;
  }
}

/** Fork navigation stays in the current account without restarting the page. */
export function navigateToForkConversation(
  node: Pick<ForkNode, 'conversationId' | 'conversationUrl'>,
): void {
  if (!node.conversationId) return;
  const accountPrefix = window.location.pathname.match(/^\/u\/\d+(?=\/|$)/)?.[0] ?? '';
  const account = accountPrefix.split('/')[2] ?? '0';
  let target = new URL(
    `${accountPrefix}/app/${encodeURIComponent(node.conversationId)}`,
    window.location.origin,
  );
  try {
    const saved = new URL(node.conversationUrl, window.location.origin);
    const route = readConversationRoute(saved);
    if (saved.origin === window.location.origin && route?.id === node.conversationId) {
      // Stored fork URLs may belong to an old slot; keep their Gem path, not their account.
      saved.pathname = `${accountPrefix}${route.path}`;
      target = saved;
    }
  } catch {
    // Older or malformed URLs still have a usable conversation id.
  }
  if (window.location.pathname === target.pathname) return;

  const targetRoute = readConversationRoute(target);
  if (!targetRoute) return;
  const link = findForkSidebarLink((url) => {
    const route = readConversationRoute(url);
    return (
      url.origin === window.location.origin &&
      route?.account === account &&
      route.path === targetRoute.path
    );
  });
  if (link) {
    const options = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      link.dispatchEvent(new MouseEvent(type, options));
    }
    return;
  }

  try {
    window.history.pushState({}, '', `${target.pathname}${target.search}${target.hash}`);
    window.dispatchEvent(
      typeof PopStateEvent === 'function'
        ? new PopStateEvent('popstate', { state: window.history.state })
        : new Event('popstate'),
    );
  } catch (error) {
    // A failed router transition must not fall back to a full reload and lose page state.
    logger.warn('Fork SPA navigation failed', { error });
  }
}
