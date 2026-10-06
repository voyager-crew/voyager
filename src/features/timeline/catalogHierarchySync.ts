/**
 * Catalog-site timeline outlines in the cloud. Each catalog site (ChatGPT, Claude, …) gets one
 * Drive file holding every one of its `gvCatalogTimelineHierarchy:<site>[:acct:<hash>]` buckets
 * under its own storage key, so an account-scoped outline is restored to exactly the bucket it came
 * from. One file per site, not per key: Drive lookups are by exact name, and a fresh device cannot
 * know which account hashes to look for.
 *
 * A cleared outline leaves a deletion marker (`deleted[conversationId]`, the time it was cleared) in
 * its bucket, locally and in the file. Merges are per conversation: the newest of the two entries,
 * unless a marker is newer still, in which case the conversation stays deleted. Markers older than
 * `OUTLINE_DELETION_TTL_MS` are dropped; a device that kept such an outline uploads it back.
 */
import { StorageKeys } from '@/core/types/common';

import {
  type TimelineHierarchyConversationData,
  type TimelineHierarchyData,
  normalizeTimelineHierarchyData,
} from './hierarchyTypes';

export const CATALOG_TIMELINE_HIERARCHY_FORMAT = 'gemini-voyager.catalog-timeline-hierarchy.v1';

export const CATALOG_TIMELINE_PUSH_MESSAGE = 'gv.sync.catalogTimeline.push';
export const CATALOG_TIMELINE_PULL_MESSAGE = 'gv.sync.catalogTimeline.pull';

/** When each cleared conversation was cleared, in ms. */
export type OutlineDeletions = Record<string, number>;

/** One catalog bucket: its outlines and the deletion markers of outlines cleared from it. */
export interface CatalogTimelineBucket extends TimelineHierarchyData {
  deleted?: OutlineDeletions;
}

/** Catalog buckets keyed by their storage key. */
export type CatalogTimelineBuckets = Record<string, CatalogTimelineBucket>;

/** How long a deletion marker is kept: long enough for every device to sync once. */
export const OUTLINE_DELETION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface CatalogTimelineHierarchyExportPayload {
  format: typeof CATALOG_TIMELINE_HIERARCHY_FORMAT;
  exportedAt: string;
  version: string;
  site: string;
  data: CatalogTimelineBuckets;
}

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUCKET_KEY = new RegExp(
  `^${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}([a-z0-9][a-z0-9-]{0,63})(?::acct:[0-9a-z]+)?$`,
);

/** A site id that is safe to put in a Drive file name. */
export function isCatalogSiteId(value: unknown): value is string {
  return typeof value === 'string' && SITE_ID.test(value);
}

/** The site a catalog hierarchy storage key belongs to, or null for any other key. */
export function catalogHierarchySiteOf(key: string): string | null {
  return BUCKET_KEY.exec(key)?.[1] ?? null;
}

export function catalogTimelineFileName(site: string): string {
  if (!isCatalogSiteId(site)) throw new Error(`Invalid catalog site id: ${site}`);
  return `gemini-voyager-timeline-hierarchy.site-${site}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The well-formed deletion markers of a stored or downloaded bucket. */
export function readOutlineDeletions(bucket: unknown): OutlineDeletions {
  const deleted: OutlineDeletions = {};
  if (!isRecord(bucket) || !isRecord(bucket.deleted)) return deleted;
  for (const [id, at] of Object.entries(bucket.deleted)) {
    if (typeof at === 'number' && Number.isFinite(at) && at >= 0) deleted[id] = at;
  }
  return deleted;
}

/** A bucket's outlines and markers, normalized; a bucket without markers has no `deleted`. */
export function readCatalogBucket(value: unknown): CatalogTimelineBucket {
  const { conversations } = normalizeTimelineHierarchyData(value);
  const deleted = readOutlineDeletions(value);
  return Object.keys(deleted).length > 0 ? { conversations, deleted } : { conversations };
}

function isEmptyBucket(bucket: CatalogTimelineBucket): boolean {
  return (
    Object.keys(bucket.conversations).length === 0 && Object.keys(bucket.deleted ?? {}).length === 0
  );
}

/**
 * The markers a bucket keeps after one conversation's entry went from `previous` to `next`: a
 * cleared entry gets a marker later than the entry it clears, and a new entry drops its marker.
 */
export function outlineDeletionsAfterWrite(
  stored: unknown,
  conversationId: string,
  previous: TimelineHierarchyConversationData | null,
  next: TimelineHierarchyConversationData | null,
  now: number,
): OutlineDeletions {
  const deleted = readOutlineDeletions(stored);
  for (const [id, at] of Object.entries(deleted)) {
    if (now - at >= OUTLINE_DELETION_TTL_MS) delete deleted[id];
  }
  if (next) delete deleted[conversationId];
  // Later than the cleared entry even when another device's clock stamped it ahead of this one.
  else if (previous) deleted[conversationId] = Math.max(now, previous.updatedAt + 1);
  return deleted;
}

/**
 * One conversation across both sides: the newer entry (`first` on a tie) unless a deletion marker
 * is newer than it. An entry and a marker with the same time keep the entry.
 */
function mergeConversation(
  first: CatalogTimelineBucket,
  second: CatalogTimelineBucket,
  id: string,
): { entry?: TimelineHierarchyConversationData; deletedAt?: number } {
  const a = first.conversations[id];
  const b = second.conversations[id];
  const entry = a && b ? (a.updatedAt >= b.updatedAt ? a : b) : (a ?? b);
  const marks = [first.deleted?.[id], second.deleted?.[id]].filter(
    (at): at is number => at !== undefined,
  );
  const deletedAt = marks.length > 0 ? Math.max(...marks) : undefined;
  if (deletedAt !== undefined && (!entry || deletedAt > entry.updatedAt)) return { deletedAt };
  return { entry };
}

/** Both sides of one bucket merged per conversation; expired markers are dropped. */
export function mergeCatalogBucket(
  first: CatalogTimelineBucket,
  second: CatalogTimelineBucket,
  now: number = Date.now(),
): CatalogTimelineBucket {
  const ids = new Set(
    [first, second].flatMap((side) => [
      ...Object.keys(side.conversations),
      ...Object.keys(side.deleted ?? {}),
    ]),
  );
  const conversations: Record<string, TimelineHierarchyConversationData> = {};
  const deleted: OutlineDeletions = {};
  for (const id of ids) {
    const { entry, deletedAt } = mergeConversation(first, second, id);
    if (entry) conversations[id] = entry;
    else if (deletedAt !== undefined && now - deletedAt < OUTLINE_DELETION_TTL_MS) {
      deleted[id] = deletedAt;
    }
  }
  return Object.keys(deleted).length > 0 ? { conversations, deleted } : { conversations };
}

/**
 * The catalog hierarchy buckets with outlines or deletion markers in a storage snapshot, grouped by
 * site. `sites` limits the result; a key whose site id is not file-name safe is never collected.
 */
export function collectCatalogTimelineBuckets(
  values: Record<string, unknown>,
  sites?: ReadonlySet<string>,
): Record<string, CatalogTimelineBuckets> {
  const bySite: Record<string, CatalogTimelineBuckets> = {};
  for (const [key, value] of Object.entries(values)) {
    const site = catalogHierarchySiteOf(key);
    if (!site || (sites && !sites.has(site))) continue;
    const data = readCatalogBucket(value);
    if (isEmptyBucket(data)) continue;
    (bySite[site] ??= {})[key] = data;
  }
  return bySite;
}

/** Every bucket of both sides, merged per conversation (local on a tie). */
export function mergeCatalogTimelineBuckets(
  local: CatalogTimelineBuckets,
  remote: CatalogTimelineBuckets,
  now: number = Date.now(),
): CatalogTimelineBuckets {
  const merged: CatalogTimelineBuckets = { ...remote };
  for (const [key, data] of Object.entries(local)) {
    merged[key] = mergeCatalogBucket(data, remote[key] ?? { conversations: {} }, now);
  }
  return merged;
}

/**
 * The buckets of a downloaded site file, keeping only keys of that site. A file in any other
 * format or for another site is refused, so an upload never replaces what it cannot read.
 */
export function decodeCatalogTimelinePayload(value: unknown, site: string): CatalogTimelineBuckets {
  const payload = value as Partial<CatalogTimelineHierarchyExportPayload> | null;
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.format !== CATALOG_TIMELINE_HIERARCHY_FORMAT ||
    payload.site !== site ||
    !payload.data ||
    typeof payload.data !== 'object' ||
    Array.isArray(payload.data)
  ) {
    throw new Error(`Unrecognized timeline outline backup for ${site}`);
  }
  const buckets: CatalogTimelineBuckets = {};
  for (const [key, data] of Object.entries(payload.data)) {
    if (catalogHierarchySiteOf(key) !== site) continue;
    const bucket = readCatalogBucket(data);
    if (!isEmptyBucket(bucket)) buckets[key] = bucket;
  }
  return buckets;
}
