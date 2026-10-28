/**
 * The page route a site check report may carry: the path only (never the host,
 * query or hash), keeping just the site's own route words and replacing every
 * other segment with a placeholder. What a segment looks like proves nothing:
 * a Gemini id can be plain hex letters and a ChatGPT GPT id a short token, so
 * only explicitly configured route words survive. An unknown site without
 * routeWords keeps no segment.
 */
import { BUNDLED_SITE_ADAPTERS } from '../../catalog/sites';
import { parseSiteConversation } from '../../sites/siteConversation';
import type { SiteAdapter } from '../../types';

export const ROUTE_ID_PLACEHOLDER = ':id';

const MAX_SEGMENTS = 8;
/** `/u/<n>/` is an account slot index, which bug reports ask for; it names no account. */
const ACCOUNT_SLOT = /^\d{1,2}$/;

export interface RedactedRoute {
  readonly route: string;
  /** The site's pattern matched, or (without one) the route is a known conversation route. */
  readonly conversation: boolean;
}

/** Redact `url`'s path for `site`; an unparsable URL reports `/`. */
export function redactRoute(
  url: string,
  site?: Pick<SiteAdapter, 'id' | 'conversationIdPattern'> | null,
): RedactedRoute {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { route: '/', conversation: false };
  }
  // Route facts come from this build only: remote data must never expose an identifier.
  const bundled = site ? BUNDLED_SITE_ADAPTERS.find((entry) => entry.id === site.id) : undefined;
  const words = new Set(bundled?.routeWords ?? []);
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const kept = segments.slice(0, MAX_SEGMENTS).map((segment, index) => {
    if (bundled?.accountSlots && index === 1 && segments[0] === 'u' && ACCOUNT_SLOT.test(segment)) {
      return segment;
    }
    if (bundled?.accountSlots && index === 0 && segment === 'u') return segment;
    return words.has(segment) ? segment : ROUTE_ID_PLACEHOLDER;
  });
  if (segments.length > MAX_SEGMENTS) kept.push('…');
  const route = `/${kept.join('/')}`;
  const pattern = site?.conversationIdPattern;
  const conversation = pattern
    ? parseSiteConversation({ siteId: site.id, conversationIdPattern: pattern }, url) !== null
    : (bundled?.conversationRoutes ?? []).includes(route.replace(/^\/u\/\d{1,2}(?=\/|$)/, ''));
  return { route, conversation };
}
