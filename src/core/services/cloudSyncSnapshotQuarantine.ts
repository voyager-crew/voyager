import { StorageKeys } from '@/core/types/common';
import { canonicalJson } from '@/core/utils/canonicalHash';

import type { SnapshotStorage } from './CloudSyncSnapshotService';
import { logger } from './LoggerService';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const QUARANTINE = StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE;

/** Reclaim the old invalid slot only after its replacement finishes; never delete a newer one. */
export async function releaseCloudSyncSnapshotQuarantine(
  storage: SnapshotStorage['local'],
  settledSlot: unknown,
  quarantine: unknown,
): Promise<void> {
  if (quarantine === undefined) return;
  try {
    const current = await storage.get([SLOT, QUARANTINE]);
    if (
      canonicalJson(current[SLOT]) === canonicalJson(settledSlot) &&
      canonicalJson(current[QUARANTINE]) === canonicalJson(quarantine)
    )
      await storage.remove([QUARANTINE]);
  } catch (error) {
    // Cleanup is retryable; the successful apply and its durable Undo remain usable.
    logger.warn('[CloudSyncSnapshot] Quarantine cleanup deferred', { error });
  }
}
