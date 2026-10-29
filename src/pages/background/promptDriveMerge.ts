import { CloudSyncFailure, cloudSyncFailureCode } from '@/core/services/CloudSyncFailure';
/**
 * The prompts-only Drive merges, run through the prompt-library owner so a
 * template or prompt saved while Drive answers is merged with, not dropped.
 */
import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  type SnapshotContext,
} from '@/core/services/CloudSyncSnapshotService';
import { decodePromptDrivePayload } from '@/core/services/drivePromptPayload';
import { checkUploadGuard } from '@/core/services/uploadGuard';
import type { UploadGuardOptions, UploadGuardRefusal } from '@/core/types/syncUploadGuard';
import { canonicalJson } from '@/core/utils/canonicalHash';
import type { PromptItem } from '@/features/backup/types/backup';
import {
  type PromptLibraryOwner,
  PROMPT_LIBRARY_KEY,
  applyPromptLibraryOp,
} from '@/features/prompt/library/promptLibraryOwner';

import { normalizeLocalPromptsForSync } from './localPromptSyncData';

export type PromptPullOutcome =
  | { ok: true; empty: true }
  | { ok: boolean; imported: number; duplicates: number; nameConflicts: number; error?: string };

export type PromptDownloadOutcome = PromptPullOutcome & {
  snapshotId?: string;
  warning?: 'sync_bookkeeping_failed';
};

type PromptUploadMerge =
  | { kind: 'ready'; items: PromptItem[] }
  | { kind: 'failed' }
  | UploadGuardRefusal;

/** Merge the cloud prompts into the library. A cloud file with no prompts changes nothing. */
export async function mergeCloudPrompts(
  owner: PromptLibraryOwner,
  cloudPayload: unknown,
  onApplied?: (items: PromptItem[]) => Promise<void>,
  beforeWrite?: (items: unknown[]) => Promise<void>,
): Promise<PromptPullOutcome> {
  if (cloudPayload === null) return { ok: true, empty: true };
  const payload = decodePromptDrivePayload(cloudPayload);
  if (!payload) return { ok: false, imported: 0, duplicates: 0, nameConflicts: 0 };
  if (payload.items.length === 0) return { ok: true, empty: true };
  try {
    const result = await owner.transact((stored) => {
      const original = canonicalJson(stored);
      const merged = applyPromptLibraryOp(stored, { kind: 'import', items: payload.items });
      return {
        ...merged,
        items: canonicalJson(merged.items) === original ? null : merged.items,
      };
    }, beforeWrite);
    await onApplied?.(normalizeLocalPromptsForSync(result.items));
    return {
      ok: true,
      imported: result.added,
      duplicates: result.skipped,
      nameConflicts: result.nameConflicts,
    };
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      duplicates: 0,
      nameConflicts: 0,
      error:
        cloudSyncFailureCode(error) ?? (error instanceof Error ? error.message : String(error)),
    };
  }
}

/** The prompts-only download owns its snapshot until its queued import and cleanup settle. */
export async function downloadCloudPrompts(
  owner: PromptLibraryOwner,
  cloudPayload: unknown,
  context: SnapshotContext,
  onApplied?: (items: PromptItem[]) => Promise<void>,
  options: { snapshotId?: string } = {},
): Promise<PromptDownloadOutcome> {
  let snapshotId = options.snapshotId;
  let applied: PromptItem[] | undefined;
  let outcome = await mergeCloudPrompts(
    owner,
    cloudPayload,
    async (items) => {
      applied = items;
    },
    async (items) => {
      const snapshot = await captureCloudSyncSnapshot({
        context,
        keys: [{ area: 'local', key: PROMPT_LIBRARY_KEY }],
        snapshotId,
      }).catch((cause: unknown) => {
        if (cloudSyncFailureCode(cause) === 'snapshot_superseded') throw cause;
        throw new CloudSyncFailure(
          'snapshot_failed',
          cause instanceof Error ? cause.message : String(cause),
          { cause },
        );
      });
      snapshotId = snapshot.id;
      await recordCloudSyncWrites(snapshot.id, [
        { area: 'local', key: PROMPT_LIBRARY_KEY, kind: 'prompts', value: items },
      ]);
    },
  );
  try {
    if (snapshotId) await finishCloudSyncSnapshot(snapshotId);
  } catch (error) {
    // A failed cleanup must not replace the owner's first failure or lose its snapshot id.
    if (outcome.ok)
      outcome = {
        ok: false,
        imported: 'imported' in outcome ? outcome.imported : 0,
        duplicates: 'duplicates' in outcome ? outcome.duplicates : 0,
        nameConflicts: 'nameConflicts' in outcome ? outcome.nameConflicts : 0,
        error:
          cloudSyncFailureCode(error) ?? (error instanceof Error ? error.message : String(error)),
      };
  }
  let warning: 'sync_bookkeeping_failed' | undefined;
  if (outcome.ok && applied) {
    try {
      await onApplied?.(applied);
    } catch {
      // Data already landed; keep its successful result and the snapshot offered for undo.
      warning = 'sync_bookkeeping_failed';
    }
  }
  return { ...outcome, ...(snapshotId ? { snapshotId } : {}), ...(warning ? { warning } : {}) };
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
      const decision = checkUploadGuard(
        [{ kind: 'prompts', localCount: items.length, cloudCount }],
        options.authorizeRefusal ? false : options.force === true,
      );
      const guard =
        decision.kind === 'refused' && options.authorizeRefusal
          ? options.authorizeRefusal(decision)
          : decision;
      // Refusal must leave even a mergeable cloud library out of local storage.
      if (guard.kind === 'refused') return { items: null, result: guard };
      return { items: merged ? items : null, result: { kind: 'ready', items } };
    });
  } catch {
    return { kind: 'failed' };
  }
}
