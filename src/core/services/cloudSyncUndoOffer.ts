/**
 * Whether a sync result may offer Undo: only for the download that wrote the
 * current snapshot. Undo itself is `undoCloudSyncSnapshot(snapshotId)`, which
 * reports `superseded` instead of undoing a later download.
 */
import { readCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';

/** True while `snapshotId` is the slot an Undo would restore. */
export async function canUndoCloudSync(snapshotId: string | undefined): Promise<boolean> {
  if (!snapshotId) return false;
  try {
    return (await readCloudSyncSnapshot())?.id === snapshotId;
  } catch {
    return false;
  }
}
