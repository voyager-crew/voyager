/**
 * The prompts-only Drive merges, run through the prompt-library owner so a
 * template or prompt saved while Drive answers is merged with, not dropped.
 */
import { decodePromptDrivePayload } from '@/core/services/drivePromptPayload';
import { checkUploadGuard } from '@/core/services/uploadGuard';
import type { UploadGuardOptions, UploadGuardRefusal } from '@/core/types/syncUploadGuard';
import type { PromptItem } from '@/features/backup/types/backup';
import {
  type PromptLibraryOwner,
  applyPromptLibraryOp,
} from '@/features/prompt/library/promptLibraryOwner';

import { normalizeLocalPromptsForSync } from './localPromptSyncData';

export type PromptPullOutcome =
  | { ok: true; empty: true }
  | { ok: boolean; imported: number; duplicates: number; nameConflicts: number };

type PromptUploadMerge =
  | { kind: 'ready'; items: PromptItem[] }
  | { kind: 'failed' }
  | UploadGuardRefusal;

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
 * read and guarded in the same owner turn before any local write.
 */
export async function mergeCloudPromptsForUpload(
  owner: PromptLibraryOwner,
  cloudPayload: unknown,
  options: UploadGuardOptions = {},
): Promise<PromptUploadMerge> {
  const payload = cloudPayload === null ? null : decodePromptDrivePayload(cloudPayload);
  const cloudCount = cloudPayload === null ? 0 : (payload?.items.length ?? null);
  try {
    return await owner.transact<PromptUploadMerge>((stored) => {
      const local = normalizeLocalPromptsForSync(stored);
      const merged =
        payload && payload.items.length > 0
          ? applyPromptLibraryOp(local, { kind: 'import', items: payload.items }).items
          : null;
      const items = normalizeLocalPromptsForSync(merged ?? local);
      const guard = checkUploadGuard(
        [{ kind: 'prompts', localCount: items.length, cloudCount }],
        options.force === true,
      );
      // Refusal must leave even a mergeable cloud library out of local storage.
      if (guard.kind === 'refused') return { items: null, result: guard };
      return { items: merged ? items : null, result: { kind: 'ready', items } };
    });
  } catch {
    return { kind: 'failed' };
  }
}
