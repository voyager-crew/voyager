/**
 * Catalog-site timeline outlines in the cloud. Each catalog site (ChatGPT, Claude, …) gets one
 * Drive file holding every one of its `gvCatalogTimelineHierarchy:<site>[:acct:<hash>]` buckets
 * under its own storage key, so an account-scoped outline is restored to exactly the bucket it came
 * from. One file per site, not per key: Drive lookups are by exact name, and a fresh device cannot
 * know which account hashes to look for.
 */
import { StorageKeys } from '@/core/types/common';
import { mergeTimelineHierarchy } from '@/utils/merge';

import { type TimelineHierarchyData, normalizeTimelineHierarchyData } from './hierarchyTypes';

export const CATALOG_TIMELINE_HIERARCHY_FORMAT = 'gemini-voyager.catalog-timeline-hierarchy.v1';

export const CATALOG_TIMELINE_PUSH_MESSAGE = 'gv.sync.catalogTimeline.push';
export const CATALOG_TIMELINE_PULL_MESSAGE = 'gv.sync.catalogTimeline.pull';

/** Hierarchy blobs keyed by their storage key. */
export type CatalogTimelineBuckets = Record<string, TimelineHierarchyData>;

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

function hasOutlines(data: TimelineHierarchyData): boolean {
  return Object.keys(data.conversations).length > 0;
}

/**
 * The non-empty catalog hierarchy buckets in a storage snapshot, grouped by site. `sites` limits
 * the result; a key whose site id is not file-name safe is never collected.
 */
export function collectCatalogTimelineBuckets(
  values: Record<string, unknown>,
  sites?: ReadonlySet<string>,
): Record<string, CatalogTimelineBuckets> {
  const bySite: Record<string, CatalogTimelineBuckets> = {};
  for (const [key, value] of Object.entries(values)) {
    const site = catalogHierarchySiteOf(key);
    if (!site || (sites && !sites.has(site))) continue;
    const data = normalizeTimelineHierarchyData(value);
    if (!hasOutlines(data)) continue;
    (bySite[site] ??= {})[key] = data;
  }
  return bySite;
}

/** Every bucket of both sides; a conversation in both keeps the newer entry (local on a tie). */
export function mergeCatalogTimelineBuckets(
  local: CatalogTimelineBuckets,
  remote: CatalogTimelineBuckets,
): CatalogTimelineBuckets {
  const merged: CatalogTimelineBuckets = { ...remote };
  for (const [key, data] of Object.entries(local)) {
    merged[key] = remote[key] ? mergeTimelineHierarchy(data, remote[key]) : data;
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
    const normalized = normalizeTimelineHierarchyData(data);
    if (hasOutlines(normalized)) buckets[key] = normalized;
  }
  return buckets;
}
