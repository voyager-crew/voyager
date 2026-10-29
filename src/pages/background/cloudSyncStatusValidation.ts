import { CloudSyncFailure } from '@/core/services/CloudSyncFailure';
import { readLocalSyncStars } from '@/core/services/GoogleDriveLocalStars';
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { decodeStarredSnapshot } from '@/features/savedLibrary/starData';
import { normalizeStarTombstones } from '@/features/savedLibrary/starSyncData';
import { catalogHierarchySiteOf } from '@/features/timeline/catalogHierarchySync';
import { normalizeTimelineHierarchyConversationData } from '@/features/timeline/hierarchyTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unreadable(): never {
  throw new CloudSyncFailure('local_read_failed', 'Local sync data is unavailable or invalid');
}

/** Status must not turn an unreadable star store into the known-empty state. */
export async function readStarsForSyncStatus(
  scope: SyncAccountScope | null,
  captured?: Record<string, unknown>,
) {
  const keys = [
    StorageKeys.SAVED_LIBRARY_STARS,
    StorageKeys.TIMELINE_STARRED_MESSAGES,
    StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
  ];
  const values = captured ?? (await chrome.storage.local.get<Record<string, unknown>>(keys));
  for (const key of [StorageKeys.SAVED_LIBRARY_STARS, StorageKeys.TIMELINE_STARRED_MESSAGES]) {
    if (values[key] !== undefined && !decodeStarredSnapshot(values[key])) unreadable();
  }
  const deleted = values[StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES];
  if (
    deleted !== undefined &&
    (!Array.isArray(deleted) ||
      !deleted.every((entry) => normalizeStarTombstones([entry]).length > 0))
  )
    unreadable();
  return readLocalSyncStars(scope, values);
}

function knownConversation(value: unknown): boolean {
  if (normalizeTimelineHierarchyConversationData(value)) return true;
  return (
    isRecord(value) &&
    isRecord(value.levels) &&
    Object.keys(value.levels).length === 0 &&
    Array.isArray(value.collapsed) &&
    value.collapsed.length === 0
  );
}

/** Validate before the catalog collector drops empty buckets and invalid records. */
export function assertCatalogSyncStatusReadable(
  values: Record<string, unknown>,
  site: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (catalogHierarchySiteOf(key) !== site || value === undefined) continue;
    if (
      !isRecord(value) ||
      !isRecord(value.conversations) ||
      !Object.values(value.conversations).every(knownConversation) ||
      (value.deleted !== undefined &&
        (!isRecord(value.deleted) ||
          !Object.values(value.deleted).every(
            (at) => typeof at === 'number' && Number.isFinite(at) && at >= 0,
          )))
    )
      unreadable();
  }
}
