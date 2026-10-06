/**
 * Which cloud file a star belongs in. Gemini stars live in the Gemini star files, one per
 * Gemini account when account isolation is on. A catalog site's stars (ChatGPT, Claude, …) live
 * in that site's own file, `gemini-voyager-stars.site-<site>.json`, with every account's stars
 * for the site and their `account` annotation; a Gemini account has no say over them.
 *
 * Older versions copied catalog stars into every Gemini account file, and they still read them
 * from there. So a Gemini account file keeps the catalog stars it already holds (their later edits
 * and deletions included), and only stops receiving new ones.
 */
import type { SyncAccountScope } from '@/core/types/sync';
import { SiteRegistry, resolvePluginPlatformId } from '@/features/plugins/sites/registry';
import { isCatalogSiteId } from '@/features/timeline/catalogHierarchySync';

import type { StarState } from './starSyncData';
import type { StarredMessage } from './starTypes';

const NAMESPACED_ID = /^([a-z0-9][a-z0-9-]{0,63}):conv:/;
const NATIVE_NAMESPACES = new Set(['gemini', 'aistudio']);

export function catalogStarsFileName(site: string): string {
  if (!isCatalogSiteId(site)) throw new Error(`Invalid catalog site id: ${site}`);
  return `gemini-voyager-stars.site-${site}.json`;
}

/**
 * The catalog site a star was made on, or null for a Gemini (or unknown) star. The
 * `<site>:conv:<id>` namespace decides; a star filed under a URL hash falls back to its URL.
 */
export function createStarSiteClassifier(): (conversationId: string, url: string) => string | null {
  const registry = SiteRegistry.createDefault();
  return (conversationId, url) => {
    const namespace = NAMESPACED_ID.exec(conversationId)?.[1];
    if (namespace) return NATIVE_NAMESPACES.has(namespace) ? null : namespace;
    const site = url ? resolvePluginPlatformId(url, registry) : null;
    return site && isCatalogSiteId(site) ? site : null;
  };
}

const identity = (conversationId: string, turnId: string) =>
  JSON.stringify([conversationId, turnId]);

function selectStars(
  state: StarState,
  keep: (record: { conversationId: string; turnId: string; conversationUrl: string }) => boolean,
): StarState {
  const messages: Record<string, StarredMessage[]> = Object.create(null);
  for (const [id, bucket] of Object.entries(state.data.messages)) {
    const kept = bucket.filter((item) =>
      keep({ conversationId: id, turnId: item.turnId, conversationUrl: item.conversationUrl }),
    );
    if (kept.length) messages[id] = kept;
  }
  return { data: { messages }, tombstones: state.tombstones.filter(keep) };
}

/** The catalog sites that have stars, or deletions to pass on, in a star state. */
export function catalogStarSites(state: StarState): Set<string> {
  const siteOf = createStarSiteClassifier();
  const sites = new Set<string>();
  selectStars(state, ({ conversationId, conversationUrl }) => {
    const site = siteOf(conversationId, conversationUrl);
    if (site) sites.add(site);
    return false;
  });
  return sites;
}

/** What a catalog site's own star file holds: that site's stars and deletions. */
export function selectCatalogSiteStars(state: StarState, site: string): StarState {
  const siteOf = createStarSiteClassifier();
  return selectStars(
    state,
    (record) => siteOf(record.conversationId, record.conversationUrl) === site,
  );
}

/**
 * What a Gemini star file holds. The shared file (no account scope) is one file, so it keeps
 * carrying catalog stars for the versions that read them there. An account file keeps only the
 * catalog stars `remote` (that file, as read) already holds, so it never gains new ones.
 */
export function selectGeminiFileStars(
  state: StarState,
  scope: SyncAccountScope | null,
  remote: StarState,
): StarState {
  if (!scope) return state;
  const siteOf = createStarSiteClassifier();
  const present = new Set([
    ...Object.entries(remote.data.messages).flatMap(([id, bucket]) =>
      bucket.map((item) => identity(id, item.turnId)),
    ),
    ...remote.tombstones.map((item) => identity(item.conversationId, item.turnId)),
  ]);
  return selectStars(
    state,
    (record) =>
      siteOf(record.conversationId, record.conversationUrl) === null ||
      present.has(identity(record.conversationId, record.turnId)),
  );
}
