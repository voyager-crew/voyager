/**
 * The storage steps of the single catalog outline writer. The background runs each one inside its
 * site's serial queue (`pages/background/catalogOutlineMessages.ts`), so every step reads the bucket
 * afresh and no page edit or cloud restore can overwrite another. Gemini outlines never come here.
 */
import {
  type OutlineDeletions,
  mergeCatalogBucket,
  outlineDeletionsAfterWrite,
  readCatalogBucket,
} from './catalogHierarchySync';
import { type OutlineEdit, applyOutlineEdit } from './outlineEdits';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameDeletions(a: OutlineDeletions, b: OutlineDeletions): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

async function readStored(key: string): Promise<unknown> {
  return ((await chrome.storage.local.get(key)) as Record<string, unknown>)[key];
}

/**
 * Applies one page edit to the conversation's stored entry. The edit is dated later than the entry
 * or deletion marker it replaces, even one another device's clock dated ahead of this one, so the
 * next cloud merge keeps it. False when storage could not be read or written.
 */
export async function writeCatalogOutlineEdit(
  key: string,
  conversationId: string,
  edit: OutlineEdit,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const stored = await readStored(key);
    const bucket = readCatalogBucket(stored);
    const previous = bucket.conversations[conversationId] ?? null;
    const marker = bucket.deleted?.[conversationId];
    const updatedAt = Math.max(now, (previous?.updatedAt ?? 0) + 1, (marker ?? 0) + 1);
    const next = applyOutlineEdit(edit, previous, updatedAt);
    const conversations = { ...bucket.conversations };
    if (next) conversations[conversationId] = next;
    else delete conversations[conversationId];
    // A catalog bucket remembers a cleared outline, or a cloud merge would bring it back.
    const deleted = outlineDeletionsAfterWrite(stored, conversationId, previous, next, now);
    await chrome.storage.local.set({
      [key]: Object.keys(deleted).length > 0 ? { conversations, deleted } : { conversations },
    });
    return true;
  } catch (error) {
    console.warn('[Timeline] Failed to save a timeline outline:', error);
    return false;
  }
}

/**
 * The stored bucket with the cloud bucket merged in per conversation (see `mergeCatalogBucket`), or
 * null when nothing changes. Entries the merge does not change are kept exactly as stored.
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
 * local entry clears it. True when the bucket holds the cloud state afterwards, false when storage
 * failed or the stored value is not a bucket.
 */
export async function restoreCatalogOutlineBucket(key: string, cloud: unknown): Promise<boolean> {
  try {
    const stored = await readStored(key);
    // Never replace a stored value this restore cannot read as a bucket.
    if (stored != null && !(isRecord(stored) && isRecord(stored.conversations))) return false;
    const next = mergedBucket(stored ?? undefined, cloud);
    if (next) await chrome.storage.local.set({ [key]: next });
    return true;
  } catch (error) {
    console.warn('[Timeline] Failed to restore timeline outlines:', error);
    return false;
  }
}
