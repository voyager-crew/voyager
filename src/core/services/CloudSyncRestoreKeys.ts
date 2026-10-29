import { StorageKeys } from '@/core/types/common';
import {
  catalogHierarchySiteOf,
  mergeCatalogBucket,
  readCatalogBucket,
} from '@/features/timeline/catalogHierarchySync';
import type { PulledCatalogTimeline } from '@/features/timeline/catalogTimelineCloud';

import { isCloudRecord } from './CloudSyncApplyPlan';
import type { StorageWriteKey } from './CloudSyncSnapshotService';

/** The star owner always writes its canonical map, legacy projection and deletion records together. */
export const STAR_RESTORE_KEYS: readonly StorageWriteKey[] = [
  { area: 'local', key: StorageKeys.SAVED_LIBRARY_STARS },
  { area: 'local', key: StorageKeys.TIMELINE_STARRED_MESSAGES },
  { area: 'local', key: StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES },
];

/** Only an actual insertion writes the fork owner's single bucket. */
export async function planForkRestore(
  envelope: unknown,
): Promise<{ keys: StorageWriteKey[]; skip: boolean }> {
  if (
    !isCloudRecord(envelope) ||
    (envelope.format !== undefined && envelope.format !== 'gemini-voyager.forks.v1') ||
    !isCloudRecord(envelope.data) ||
    typeof envelope.data.groups !== 'object' ||
    envelope.data.groups === null
  )
    return { keys: [], skip: false };
  const cloudNodes = envelope.data.nodes;
  if (typeof cloudNodes !== 'object' || cloudNodes === null) return { keys: [], skip: false };
  const values = await chrome.storage.local.get(StorageKeys.FORK_NODES);
  const stored: unknown = values[StorageKeys.FORK_NODES];
  const localNodes =
    isCloudRecord(stored) &&
    typeof stored.nodes === 'object' &&
    stored.nodes !== null &&
    typeof stored.groups === 'object' &&
    stored.groups !== null
      ? stored.nodes
      : {};
  const buckets: unknown[] = Object.values(cloudNodes);
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const node of bucket) {
      if (
        !isCloudRecord(node) ||
        typeof node.turnId !== 'string' ||
        typeof node.conversationId !== 'string' ||
        typeof node.conversationUrl !== 'string' ||
        typeof node.forkGroupId !== 'string' ||
        typeof node.forkIndex !== 'number' ||
        typeof node.createdAt !== 'number'
      )
        continue;
      const local: unknown = Reflect.get(localNodes, node.conversationId);
      if (
        !Array.isArray(local) ||
        !local.some(
          (item: unknown) =>
            isCloudRecord(item) &&
            item.turnId === node.turnId &&
            item.forkGroupId === node.forkGroupId,
        )
      )
        return { keys: [{ area: 'local', key: StorageKeys.FORK_NODES }], skip: false };
    }
  }
  return { keys: [], skip: true };
}

/** Use the outline owner's merge rules to omit unchanged or unreadable buckets. */
export async function planCatalogRestore(pulled: PulledCatalogTimeline | null): Promise<{
  keys: StorageWriteKey[];
  pulled: PulledCatalogTimeline | null;
  hadOutlines: boolean;
  refused: number;
}> {
  if (!pulled) return { keys: [], pulled: null, hadOutlines: false, refused: 0 };
  const keys = Object.keys(pulled.outlines).filter((key) => catalogHierarchySiteOf(key));
  const values = keys.length ? await chrome.storage.local.get(keys) : {};
  const writes: StorageWriteKey[] = [];
  const outlines: PulledCatalogTimeline['outlines'] = {};
  let refused = 0;
  for (const key of keys) {
    const stored: unknown = values[key];
    if (stored != null && !(isCloudRecord(stored) && isCloudRecord(stored.conversations))) {
      // Freeze a refusal too: a concurrent repair cannot enable an undeclared write.
      refused += 1;
      continue;
    }
    const local = readCatalogBucket(stored);
    const merged = mergeCatalogBucket(local, readCatalogBucket(pulled.outlines[key]));
    const ids = new Set([
      ...Object.keys(local.conversations),
      ...Object.keys(merged.conversations),
    ]);
    const deleted = merged.deleted ?? {};
    const oldDeleted = local.deleted ?? {};
    if (
      [...ids].some((id) => local.conversations[id] !== merged.conversations[id]) ||
      Object.keys(deleted).length !== Object.keys(oldDeleted).length ||
      Object.keys(deleted).some((id) => deleted[id] !== oldDeleted[id])
    ) {
      writes.push({ area: 'local', key });
      outlines[key] = pulled.outlines[key];
    }
  }
  if (Object.keys(pulled.stars).length) writes.push(...STAR_RESTORE_KEYS);
  // Freeze the selected owners too: a planned no-op must not become an unsnapshotted late write.
  return {
    keys: writes,
    pulled: { outlines, stars: pulled.stars },
    hadOutlines: keys.length > 0,
    refused,
  };
}
