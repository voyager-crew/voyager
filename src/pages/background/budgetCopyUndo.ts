import {
  cloudSyncUndoMarkers,
  matchesCloudSyncUndoHash,
} from '@/core/services/CloudSyncUndoMarkers';
import { hasFolderBackupReceipt } from '@/core/services/cloudSyncBackupAcknowledgment';
import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import {
  folderBackupKeysForMarkers,
  folderTargetForBackup,
  hashBackupData,
  backupMatchesCanonical,
} from '@/core/services/dataBackupUndo';
import { StorageKeys } from '@/core/types/common';
import { AUTHORITY_FENCE_KEY, authorityForSite } from '@/features/folder/owner/authorityFence';
import { siteOfFolderKey } from '@/features/folder/owner/folderOwnerPolicy';
import type { CleanUndoneCopiesReply } from '@/features/storage/budgetCopyMessage';
import type { StorageBudget } from '@/features/storage/storageBudget';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;

export interface BackupCopyStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
}

function readSlot(stored: Record<string, unknown>) {
  const raw = stored[SLOT];
  const slot = parseCloudSyncSnapshotSlot(raw);
  if (raw !== undefined && !slot) throw new Error('Invalid cloud snapshot');
  return slot;
}

function readMarkers(stored: Record<string, unknown>) {
  return cloudSyncUndoMarkers(readSlot(stored));
}

/** A delayed page copy cannot repopulate a slot after queued Undo cleanup passed it. */
export async function isSuppressedBudgetCopy(
  key: string,
  serialized: string,
  storage: BackupCopyStorage,
): Promise<boolean> {
  const target = folderTargetForBackup(key);
  if (!target) return false;
  const hash = await hashBackupData(serialized);
  if (hash === null) return false;
  const current = await storage.get([SLOT, target.key]);
  if (backupMatchesCanonical(serialized, current[target.key], target)) return false;
  return matchesCloudSyncUndoHash(readMarkers(current), { ...target, hash });
}

/**
 * Compare-delete in the durable writer's own queue. Hashing may outlive reads,
 * so re-read both the exact serialized copy and its suppression before removal.
 */
export async function cleanUndoneBudgetCopies(
  budget: StorageBudget,
  storage: BackupCopyStorage,
): Promise<CleanUndoneCopiesReply> {
  try {
    await budget.runChecked(async () => {
      const keys = folderBackupKeysForMarkers(readMarkers(await storage.get([SLOT])));
      const observed = await storage.get(keys);
      for (const key of keys) {
        const serialized = observed[key];
        if (typeof serialized !== 'string') continue;
        const target = folderTargetForBackup(key);
        const hash = await hashBackupData(serialized);
        if (!target || hash === null) continue;
        const current = await storage.get([SLOT, key, target.key, AUTHORITY_FENCE_KEY]);
        // This synchronous check shares the durable queue step with the final compare-delete.
        if (backupMatchesCanonical(serialized, current[target.key], target)) continue;
        // A new download may be reintroducing this exact content; completion verifies it before retirement.
        if (hasFolderBackupReceipt(readSlot(current), target, hash)) continue;
        if (
          current[key] === serialized &&
          matchesCloudSyncUndoHash(readMarkers(current), { ...target, hash })
        ) {
          if (
            authorityForSite(current[AUTHORITY_FENCE_KEY], siteOfFolderKey(target.key)) !== 'legacy'
          )
            throw new Error('Backup owner has changed');
          await storage.remove([key]);
        }
      }
    });
    return { status: 'cleared' };
  } catch {
    // The caller keeps suppression across captures and retries on the next Undo/capture.
    return { status: 'failed' };
  }
}
