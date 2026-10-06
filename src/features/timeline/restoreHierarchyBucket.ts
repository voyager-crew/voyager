/**
 * Merges cloud outlines into hierarchy buckets through the page-wide `outlineSaveQueue`, so a
 * restore in a page with an open timeline is serialized with that page's own outline edits. An
 * open timeline then picks the merged bucket up from its storage event.
 */
import { catalogHierarchySiteOf } from './catalogHierarchySync';
import {
  type TimelineHierarchyConversationData,
  normalizeTimelineHierarchyData,
} from './hierarchyTypes';
import { outlineSaveQueue } from './outlineSaveQueue';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Adds each cloud conversation that is missing locally or newer than the local entry (local wins
 * a tie), and leaves every other stored entry as it is. Resolves true when the bucket holds the
 * cloud outlines afterwards, false when the write failed or the stored value is not a bucket.
 */
export async function restoreHierarchyBucket(key: string, cloud: unknown): Promise<boolean> {
  const incoming = normalizeTimelineHierarchyData(cloud).conversations;
  let restored = false;
  await outlineSaveQueue.enqueue(key, null, async () => {
    try {
      const stored = (await chrome.storage.local.get(key))[key];
      // Never replace a stored value this restore cannot read as a bucket.
      if (stored != null && !(isRecord(stored) && isRecord(stored.conversations))) return null;
      const current = stored?.conversations ?? {};
      const local = normalizeTimelineHierarchyData(stored).conversations;
      const additions: Record<string, TimelineHierarchyConversationData> = {};
      for (const [id, entry] of Object.entries(incoming)) {
        const mine = local[id];
        if (!mine || mine.updatedAt < entry.updatedAt) additions[id] = entry;
      }
      if (Object.keys(additions).length > 0) {
        await chrome.storage.local.set({
          [key]: { ...stored, conversations: { ...current, ...additions } },
        });
      }
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
