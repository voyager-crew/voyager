/**
 * The prompts-only Drive merges, run through the prompt-library owner so a
 * template or prompt saved while Drive answers is merged with, not dropped.
 */
import { decodePromptDrivePayload } from '@/core/services/drivePromptPayload';
import type { PromptItem } from '@/features/backup/types/backup';
import {
  type PromptLibraryOwner,
  applyPromptLibraryOp,
} from '@/features/prompt/library/promptLibraryOwner';

import { normalizeLocalPromptsForSync } from './localPromptSyncData';

export type PromptPullOutcome =
  | { ok: true; empty: true }
  | { ok: boolean; imported: number; duplicates: number; nameConflicts: number };

/** Merge the cloud prompts into the library. A cloud file with no prompts changes nothing. */
export async function mergeCloudPrompts(
  owner: PromptLibraryOwner,
  cloudPayload: unknown,
): Promise<PromptPullOutcome> {
  if (cloudPayload === null) return { ok: true, empty: true };
  const payload = decodePromptDrivePayload(cloudPayload);
  if (!payload) return { ok: false, imported: 0, duplicates: 0, nameConflicts: 0 };
  if (payload.items.length === 0) return { ok: true, empty: true };
  try {
    const result = await owner.apply({ kind: 'import', items: payload.items });
    return {
      ok: true,
      imported: result.added,
      duplicates: result.skipped,
      nameConflicts: result.nameConflicts,
    };
  } catch {
    return { ok: false, imported: 0, duplicates: 0, nameConflicts: 0 };
  }
}

/**
 * Merge the cloud prompts into the library and return the library to upload,
 * read in the same turn of the queue, or null when it could not be merged.
 */
export async function mergeCloudPromptsForUpload(
  owner: PromptLibraryOwner,
  cloudPayload: unknown,
): Promise<PromptItem[] | null> {
  const payload = cloudPayload === null ? null : decodePromptDrivePayload(cloudPayload);
  // An unreadable cloud file must never be replaced by this device's library alone.
  if (cloudPayload !== null && !payload) return null;
  try {
    return await owner.transact((stored) => {
      const local = normalizeLocalPromptsForSync(stored);
      if (!payload || payload.items.length === 0) return { items: null, result: local };
      const merged = applyPromptLibraryOp(local, {
        kind: 'import',
        items: payload.items,
      });
      const items = normalizeLocalPromptsForSync(merged.items ?? local);
      return { items, result: items };
    });
  } catch {
    return null;
  }
}
