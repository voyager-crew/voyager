import { isStaticallyInjectedHost } from '@/features/plugins/sites/hostPolicy';

import { RESEARCH_PACK_LIMITS, type ResearchPackCitation } from './types';

const TRACKING_PARAM_PATTERN = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid)$/i;

/** Hosts whose links are the chat app's own chrome, never a cited source. */
const INTERNAL_HOSTS = new Set([
  'accounts.google.com',
  'myaccount.google.com',
  'support.google.com',
  'policies.google.com',
  'chatgpt.com',
  'claude.ai',
]);

/**
 * Hosts whose `/url?q=` redirect is unwrapped to its target. An exact list:
 * a pattern such as `google.*` would let `google.evil.com/url?q=<arxiv>` pass
 * itself off as an arXiv citation.
 */
const GOOGLE_REDIRECT_HOSTS = new Set(['www.google.com', 'google.com']);

function isGoogleRedirect(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    GOOGLE_REDIRECT_HOSTS.has(url.hostname.toLowerCase()) &&
    url.pathname === '/url'
  );
}

/**
 * The URL as an absolute http(s) string, or null for any other scheme
 * (`javascript:`, `data:`, `vbscript:`, `file:` ...) or an unparseable value.
 * Every link that leaves the pack (Markdown, panel) goes through this.
 */
export function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Turn a raw link into the URL a reader should open, or null when it is not a
 * citable external http(s) source. Unwraps Google `/url?q=` redirects, drops
 * the fragment and tracking parameters, and trims a trailing slash so the same
 * page cited twice dedupes to one entry.
 */
export function normalizeCitationUrl(raw: string, baseUrl?: string): string | null {
  let url: URL;
  try {
    url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return null;
  }

  if (isGoogleRedirect(url)) {
    const target = url.searchParams.get('q') ?? url.searchParams.get('url');
    return target ? normalizeCitationUrl(target) : null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (isStaticallyInjectedHost(host) || INTERNAL_HOSTS.has(host)) return null;

  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAM_PATTERN.test(key)) url.searchParams.delete(key);
  }
  url.hostname = host;

  let normalized = url.toString();
  if (url.pathname !== '/' && normalized.endsWith('/') && !url.search) {
    normalized = normalized.slice(0, -1);
  }
  if (url.pathname === '/' && !url.search) {
    normalized = `${url.protocol}//${url.host}`;
  }
  return normalized;
}

function cleanTitle(title: string, url: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  if (!compact || compact === url) return '';
  return compact.slice(0, RESEARCH_PACK_LIMITS.maxTitleChars);
}

/**
 * Normalize and dedupe a list of links in first-seen order. When the same URL
 * appears more than once the first non-empty title wins.
 */
export function dedupeCitations(
  links: ReadonlyArray<{ url: string; title?: string }>,
  baseUrl?: string,
): ResearchPackCitation[] {
  const byUrl = new Map<string, ResearchPackCitation>();
  for (const link of links) {
    const url = normalizeCitationUrl(link.url, baseUrl);
    if (!url) continue;
    const title = cleanTitle(link.title ?? '', url);
    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      continue;
    }
    if (byUrl.size >= RESEARCH_PACK_LIMITS.maxCitationsPerItem) continue;
    byUrl.set(url, { url, title });
  }
  return Array.from(byUrl.values());
}
