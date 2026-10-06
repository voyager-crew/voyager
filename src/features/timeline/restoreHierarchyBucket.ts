/**
 * Merges cloud outlines into hierarchy buckets through the page-wide `outlineSaveQueue`, so a
 * restore in a page with an open timeline is serialized with that page's own outline edits. An
 * open timeline then picks the merged bucket up from its storage event.
 *
 * The queue is per page: the popup and every other tab have their own, and `chrome.storage` has no
 * conditional write. So a restore reads back, from its own write's change event, the value that
 * write replaced. When another context saved in between, that value is merged in and written again;
 * each entry keeps its newest version, so the other context's edit is kept.
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

/** How long a restore waits for its own write's change event before trusting the write. */
const CHANGE_EVENT_TIMEOUT_MS = 1_000;
/** Writes a restore repeats when other contexts keep saving between its read and its write. */
const MAX_WRITES = 3;

/** JSON with sorted keys, so two reads of one stored value compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/**
 * The stored bucket with every source merged in per conversation (see `mergeCatalogBucket`), or
 * null when nothing changes. Entries the merge does not change are kept exactly as stored.
 */
function mergedBucket(
  stored: Record<string, unknown> | undefined,
  sources: readonly unknown[],
): Record<string, unknown> | null {
  const local = readCatalogBucket(stored);
  const merged = sources.reduce<ReturnType<typeof readCatalogBucket>>(
    (bucket, source) => mergeCatalogBucket(bucket, readCatalogBucket(source)),
    local,
  );
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
 * Writes `next` and resolves the value that write replaced, read from its own change event, or
 * `unknown` when this context gets no change events or none arrives in time.
 */
async function writeAndReadReplaced(
  key: string,
  next: Record<string, unknown>,
): Promise<{ replaced: unknown } | 'unknown'> {
  const events = chrome.storage.onChanged;
  if (!events?.addListener) {
    await chrome.storage.local.set({ [key]: next });
    return 'unknown';
  }
  const written = canonical(next);
  let listener: Parameters<typeof events.addListener>[0] = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const replaced = new Promise<{ replaced: unknown } | 'unknown'>((resolve) => {
    listener = (changes, area) => {
      const change = changes[key];
      if (area === 'local' && change && canonical(change.newValue) === written) {
        resolve({ replaced: change.oldValue });
      }
    };
    events.addListener(listener);
    timer = setTimeout(() => resolve('unknown'), CHANGE_EVENT_TIMEOUT_MS);
  });
  try {
    await chrome.storage.local.set({ [key]: next });
    return await replaced;
  } finally {
    clearTimeout(timer);
    events.removeListener(listener);
  }
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
      // Values other contexts saved between a read and the write that replaced them.
      const overwritten: unknown[] = [];
      for (let write = 0; write < MAX_WRITES; write += 1) {
        const stored: unknown = (await chrome.storage.local.get(key))[key];
        // Never replace a stored value this restore cannot read as a bucket.
        if (stored != null && !(isRecord(stored) && isRecord(stored.conversations))) return null;
        const next = mergedBucket(stored ?? undefined, [cloud, ...overwritten]);
        if (!next) break;
        const result = await writeAndReadReplaced(key, next);
        if (result === 'unknown' || canonical(result.replaced) === canonical(stored)) break;
        overwritten.push(result.replaced);
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
