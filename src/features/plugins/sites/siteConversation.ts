/**
 * Which conversation a URL names on a catalog site, read from its route with
 * the site's `conversationIdPattern`. Every feature that keys a conversation
 * by its route (stars, ChatGPT folders, export) reads it here, so one site
 * names one conversation the same way everywhere.
 */
import { MAX_REGEX_INPUT_LENGTH } from './safeRegex';

/**
 * A site's conversation namespace: its site.json id and the route pattern in
 * force (`siteConversationConfig` picks a manifest's pattern over site.json's).
 */
export interface SiteConversationNamespace {
  readonly siteId: string;
  readonly conversationIdPattern?: string;
}

export interface SiteConversation {
  /** The id the pattern's first group captures. */
  readonly id: string;
  /** `<site>:conv:<id>`: the key stars and ChatGPT folder entries are filed under. */
  readonly key: string;
  /** The part of the path the pattern matched, which ends at the id for every bundled site. */
  readonly path: string;
}

/** The path of an absolute URL or a root-relative link; a link is read as is, unparsed. */
function routePath(href: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href.split(/[?#]/, 1)[0];
  try {
    return new URL(href).pathname;
  } catch {
    return null;
  }
}

/** The conversation `href` names, or `null` for any other page or a site without the pattern. */
export function parseSiteConversation(
  namespace: SiteConversationNamespace,
  href: string,
): SiteConversation | null {
  const pattern = namespace.conversationIdPattern;
  if (!pattern) return null;
  const path = routePath(href);
  if (path === null) return null;
  try {
    // The pattern policy (safeRegex.ts) forbids the constructs that backtrack
    // catastrophically; a bounded subject caps the rest.
    const match = new RegExp(pattern).exec(path.slice(0, MAX_REGEX_INPUT_LENGTH));
    const id = match?.[1];
    return id ? { id, key: `${namespace.siteId}:conv:${id}`, path: match[0] } : null;
  } catch {
    return null;
  }
}
