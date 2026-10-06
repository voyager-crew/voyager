/**
 * Merges cloud outlines into hierarchy buckets through the page-wide `outlineSaveQueue`, so a
 * restore in a page with an open timeline is serialized with that page's own outline edits. An
 * open timeline then picks the merged bucket up from its storage event.
 */
import {
  type OutlineDeletions,
  catalogHierarchySiteOf,
  mergeCatalogBucket,
  readCatalogBucket,
} from './catalogHierarchySync';
import { outlineSaveQueue } from './outlineSaveQueue';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameDeletions(a: OutlineDeletions, b: OutlineDeletions): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

/**
 * The stored bucket with the cloud bucket merged in per conversation (see `mergeCatalogBucket`),
 * or null when nothing changes. Entries this merge does not change are kept exactly as stored.
 */
function mergedBucket(
  stored: Record<string, unknown> | undefined,
  cloud: unknown,
): Record<string, unknown> | null {
  const local = readCatalogBucket(stored);
  const merged = mergeCatalogBucket(local, readCatalogBucket(cloud));
  const conversations = { ...(stored?.conversations as Record<string, unknown> | undefined) };
  let changed = false;
  const ids = new Set([...Object.keys(local.conversations), ...Object.keys(merged.conversations)]);
  for (const id of ids) {
    const after = merged.conversations[id];
    // The merge returns the stored entry itself when it is kept.
    if (local.conversations[id] === after) continue;
    changed = true;
    if (after) conversations[id] = after;
    else delete conversations[id];
  }
  const deleted = merged.deleted ?? {};
  if (!changed && sameDeletions(deleted, local.deleted ?? {})) return null;
  const { deleted: _previous, ...rest } = stored ?? {};
  return Object.keys(deleted).length > 0
    ? { ...rest, conversations, deleted }
    : { ...rest, conversations };
}

/**
 * Merges a cloud bucket into the stored one: a cloud conversation that is missing locally or newer
 * than the local entry is added (local wins a tie), and a cloud deletion marker newer than the
 * local entry clears it. Resolves true when the bucket holds the cloud state afterwards, false when
 * the write failed or the stored value is not a bucket.
 */
export async function restoreHierarchyBucket(key: string, cloud: unknown): Promise<boolean> {
  let restored = false;
  await outlineSaveQueue.enqueue(key, null, async () => {
    try {
      const stored: unknown = (await chrome.storage.local.get(key))[key];
      // Never replace a stored value this restore cannot read as a bucket.
      if (stored != null && !(isRecord(stored) && isRecord(stored.conversations))) return null;
      const next = mergedBucket(stored ?? undefined, cloud);
      if (next) await chrome.storage.local.set({ [key]: next });
      restored = true;
    } catch (error) {
      console.warn('[Timeline] Failed to restore timeline outlines:', error);
    }
    // A rejected write would stop every later outline save in this page, so this never throws.
    return null;
  });
  return restored;
}

/** Restores every catalog bucket in a pulled cloud copy; keys of any other kind are ignored. */
export async function restoreCatalogTimelineBuckets(
  buckets: unknown,
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  if (!isRecord(buckets)) return { restored, failed };
  for (const [key, data] of Object.entries(buckets)) {
    if (!catalogHierarchySiteOf(key)) continue;
    if (await restoreHierarchyBucket(key, data)) restored += 1;
    else failed += 1;
  }
  return { restored, failed };
}
