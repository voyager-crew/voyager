import {
  DEFAULT_GEMS_SIDEBAR_COUNT,
  normalizeGemsSidebarCount,
} from '@/core/utils/gemsSidebarValues';

import { gemsPackagedSelectors, readGemsList } from './selectorQueries';

/** Single gem as we cache and render it. Keep this small — chrome.storage. */
export interface GemMetadata {
  /** Slug parsed out of `/gem/<id>`. Doubles as a stable React-style key. */
  id: string;
  /** Path-only href; navigation prepends the gemini.google.com origin. */
  href: string;
  /** Display name, e.g. "Resume Coach". */
  name: string;
  /** Optional short description. Some gems don't have one. */
  description?: string;
  /** Single-character logo letter Gemini shows when no avatar is set. */
  iconLetter?: string;
}

/** Cache envelope persisted in chrome.storage.local. */
export interface GemCacheEnvelope {
  items: GemMetadata[];
  cachedAt: number;
  accountSegment?: string;
}

/** A gem the user has opened, plus when. Newest first in storage. */
export interface GemMruEntry extends GemMetadata {
  lastUsedAt: number;
}

const MRU_CAP = 20;
export const DEFAULT_COUNT = DEFAULT_GEMS_SIDEBAR_COUNT;

/**
 * Parse the rendered Gems management page into the cache schema.
 * Pure / side-effect-free so the scraper can be unit-tested in isolation.
 */
export function scrapeGemsFromDocument(doc: Document = document): GemMetadata[] {
  return readGemsList(doc).rows.flatMap(({ metadata }) => (metadata ? [metadata] : []));
}

/**
 * Matches a leading `/u/<n>` Google multi-account segment (e.g. `/u/1`). The
 * default account is served at the bare path, so a missing segment is normal.
 */
const ACCOUNT_SEGMENT_RE = /^\/u\/\d+/;

export function currentAccountSegment(): string {
  return location.pathname.match(ACCOUNT_SEGMENT_RE)?.[0] ?? '';
}

export function parseGemHref(href: string): { id: string; path: string } | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?gem\/([^/?#]+)/);
    if (!match) return null;
    // Store the account-*relative* path. The gem cache + MRU are shared across
    // every window of the same browser profile (chrome.storage.local), so
    // baking in the `/u/<n>` of whichever account happened to populate the
    // cache would leak it into a window signed into a different account. The
    // live account is re-applied at render time — see resolveGemHref.
    const accountRelativePath = url.pathname.replace(ACCOUNT_SEGMENT_RE, '');
    return { id: match[1], path: `${accountRelativePath}${url.search}${url.hash}` };
  } catch {
    return null;
  }
}

/**
 * Resolve a cached gem path to an absolute URL pinned to the *current window's*
 * Google account.
 *
 * Two browser windows signed into two accounts share one chrome.storage.local
 * gem cache/MRU. Without this, the rendered href carries whatever `/u/<n>`
 * segment last populated the cache, so clicking a gem in one window silently
 * switches it to the other window's account (and the cross-tab storage listener
 * spreads that stale href to both windows). Stripping any cached segment — which
 * also heals caches written by older builds — and re-applying the segment from
 * the live URL keeps every click inside the window's own account.
 *
 * `currentPathname` is injectable for tests; it defaults to the live location.
 */
export function resolveGemHref(
  cachedHref: string,
  currentPathname: string = location.pathname,
): string {
  const accountSegment = currentPathname.match(ACCOUNT_SEGMENT_RE)?.[0] ?? '';
  const accountRelative = cachedHref.replace(ACCOUNT_SEGMENT_RE, '');
  return `https://gemini.google.com${accountSegment}${accountRelative}`;
}

export function isGemsViewPathname(pathname: string): boolean {
  return /^\/(?:u\/\d+\/)?gems(?:\/|$)/.test(pathname);
}

/** Field-by-field content equality for cached gem items. Pure. */
export function gemItemsEqual(a: GemMetadata[], b: GemMetadata[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.id === y.id &&
      x.href === y.href &&
      x.name === y.name &&
      x.description === y.description &&
      x.iconLetter === y.iconLetter
    );
  });
}

/**
 * Read the current gem's identity off a `/gem/<id>` page's zero-state hero.
 * `.bot-logo-text` is the same logo-letter class the /gems/view scraper uses,
 * so custom and premade gems resolve identically — no /gems/view visit needed.
 * Pure (DOM + pathname in, metadata out) so it can be unit-tested. Returns null
 * when the path isn't a gem page or the hero hasn't rendered its name yet.
 */
export function readGemMetadata(pathname: string, doc: Document = document): GemMetadata | null {
  const parsed = parseGemHref(pathname);
  if (!parsed) return null;
  const name = doc.querySelector(gemsPackagedSelectors.currentName)?.textContent?.trim();
  if (!name) return null;
  const iconLetter =
    doc.querySelector(gemsPackagedSelectors.currentIcon)?.textContent?.trim() || undefined;
  return { id: parsed.id, href: parsed.path, name, iconLetter };
}

/**
 * Merge a freshly-used gem to the front of the MRU list (newest first),
 * de-duplicating by id and capping the history. Preserves any richer metadata
 * (e.g. description from the /gems/view scrape) the previous entry carried.
 * Pure — returns the next list, does not persist.
 */
export function upsertMru(mru: GemMruEntry[], meta: GemMetadata, now: number): GemMruEntry[] {
  const prev = mru.find((e) => e.id === meta.id);
  const merged: GemMruEntry = { ...prev, ...meta, lastUsedAt: now };
  return [merged, ...mru.filter((e) => e.id !== meta.id)].slice(0, MRU_CAP);
}

/**
 * Final render order: gems the user actually used, newest first, then the
 * scraped catalog (management-page order) to fill the remaining slots. When the
 * MRU is empty this degrades to the catalog order — i.e. the original behavior.
 * Catalog metadata wins for shared ids so descriptions survive. Pure.
 */
export function orderGemsByRecency(mru: GemMruEntry[], catalog: GemMetadata[]): GemMetadata[] {
  const sorted = [...mru].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const byId = new Map(catalog.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const out: GemMetadata[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const cat = byId.get(entry.id);
    out.push(cat ? { ...entry, ...cat } : entry);
  }
  for (const gem of catalog) {
    if (seen.has(gem.id)) continue;
    seen.add(gem.id);
    out.push(gem);
  }
  return out;
}

export function deletedCatalogGemIds(
  previousCatalog: GemMetadata[],
  nextCatalog: GemMetadata[],
): Set<string> {
  const nextIds = new Set(nextCatalog.map((gem) => gem.id));
  return new Set(previousCatalog.filter((gem) => !nextIds.has(gem.id)).map((gem) => gem.id));
}

export function canPruneCatalogDeletes(
  previousAccountSegment: string | undefined,
  nextAccountSegment: string,
): boolean {
  return previousAccountSegment === undefined || previousAccountSegment === nextAccountSegment;
}

/**
 * Catalog items usable for the given account segment. The cache is shared
 * across every window of the profile (chrome.storage.local), so a window
 * signed into account B must not render account A's custom gems — clicking
 * one would 404. A mismatched segment yields an empty catalog; the next
 * /gems/view visit in this window re-scrapes and repopulates it. Legacy
 * envelopes written before `accountSegment` existed (undefined/null) are
 * treated as matching so an upgrade never blanks anyone's sidebar. Pure.
 */
export function catalogForAccount(
  cache: Pick<GemCacheEnvelope, 'items' | 'accountSegment'>,
  accountSegment: string,
): GemMetadata[] {
  if (cache.accountSegment == null || cache.accountSegment === accountSegment) {
    return cache.items;
  }
  return [];
}

/**
 * Final visible list for the sidebar: pinned gems first, in pinned order, then
 * recently-used gems filling the remaining slots up to `count` total. Pinned
 * gems are never trimmed by `count` — naming a gem outranks the size limit —
 * so when more gems are pinned than `count`, all pinned gems still show (and
 * nothing else). Pinned ids with no resolvable metadata (e.g. synced from a
 * device whose cache we don't have yet) are skipped. An empty pin list
 * degrades to the existing recency order. Pure.
 */
export function selectVisibleGems(
  pinned: string[],
  mru: GemMruEntry[],
  catalog: GemMetadata[],
  count: number,
): GemMetadata[] {
  const ranked = orderGemsByRecency(mru, catalog);
  const byId = new Map(ranked.map((g) => [g.id, g]));

  const pinnedGems: GemMetadata[] = [];
  const pinnedIds = new Set<string>();
  for (const id of pinned) {
    if (pinnedIds.has(id)) continue;
    const gem = byId.get(id);
    if (!gem) continue;
    pinnedIds.add(id);
    pinnedGems.push(gem);
  }

  const fill = ranked.filter((g) => !pinnedIds.has(g.id));
  const fillCount = Math.max(0, count - pinnedGems.length);
  return [...pinnedGems, ...fill.slice(0, fillCount)];
}

export const clampCount = normalizeGemsSidebarCount;

/** Narrow a raw storage value to the pinned-ids shape (string[]). */
export function sanitizePinnedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
