import type { CloudSyncUndoMarker } from './cloudSyncSnapshotTypes';
import { folderBackupKeysForMarkers } from './dataBackupUndo';

class CloudSyncBackupCleanup {
  private owner: (() => Promise<boolean>) | undefined;

  register(owner: () => Promise<boolean>): void {
    this.owner = owner;
  }

  request(markers: readonly CloudSyncUndoMarker[]): Promise<boolean> {
    if (!folderBackupKeysForMarkers(markers).length) return Promise.resolve(true);
    // A service worker does not receive its own runtime.sendMessage.
    if (this.owner) return this.owner();
    // Loading data owners must not eagerly load browser transport, whose provider may import them.
    return import('@/features/storage/budgetCopyMessage')
      .then(({ requestUndoneBackupCleanup }) => requestUndoneBackupCleanup())
      .catch(() => false);
  }
}

const backupCleanup = new CloudSyncBackupCleanup();

/** Install the background's existing durable owner, whose queue also admits copy writes. */
export function registerCloudSyncBackupCleanupOwner(owner: () => Promise<boolean>): void {
  backupCleanup.register(owner);
}

/** Retained hashes keep recovery safe even when the background cannot clean up yet. */
export function retryCloudSyncBackupCleanup(
  markers: readonly CloudSyncUndoMarker[],
): Promise<boolean> {
  return backupCleanup.request(markers);
}
