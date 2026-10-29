import { canonicalJson } from '@/core/utils/canonicalHash';

import type { SnapshotStorage } from './CloudSyncSnapshotService';
import { cloudSyncContent, hashCloudSyncContent } from './cloudSyncSnapshotHash';
import type {
  CloudSyncAppliedHash,
  CloudSyncSnapshot,
  CloudSyncSnapshotSlot,
  CloudSyncUndoMarker,
  StorageWriteKey,
} from './cloudSyncSnapshotTypes';
import { folderBackupKeysForMarkers } from './dataBackupUndo';

/** A write-ahead receipt becomes an acknowledgment only when its canonical value is present. */
export function hasFolderBackupReceipt(
  slot: CloudSyncSnapshotSlot | null,
  target: StorageWriteKey,
  hash: string,
): boolean {
  return (
    slot?.kind === 'snapshot' &&
    slot.appliedHashes.some(
      (receipt) =>
        receipt.kind === 'folders' &&
        receipt.area === target.area &&
        receipt.key === target.key &&
        receipt.hash === hash,
    )
  );
}

function retireAcknowledgedHashes(
  markers: readonly CloudSyncUndoMarker[],
  receipt: CloudSyncAppliedHash,
): readonly CloudSyncUndoMarker[] {
  const acknowledged = new Set([
    receipt.hash,
    ...(receipt.projections ?? []).map(({ hash }) => hash),
  ]);
  let changed = false;
  const result = markers.flatMap((marker) => {
    if (marker.area !== receipt.area || marker.key !== receipt.key) return [marker];
    if (
      ![
        marker.replacedHash,
        marker.appliedHash,
        ...(marker.appliedHashes ?? []),
        ...marker.projections.flatMap(({ hashes }) => hashes),
      ].some((hash) => hash !== undefined && acknowledged.has(hash))
    )
      return [marker];
    changed = true;
    const hashes = [
      marker.replacedHash,
      ...(marker.appliedHash ? [marker.appliedHash] : []),
      ...(marker.appliedHashes ?? []),
    ].filter((hash) => !acknowledged.has(hash));
    const projections = marker.projections
      .map(({ projection, hashes }) => ({
        projection,
        hashes: hashes.filter((hash) => !acknowledged.has(hash)),
      }))
      .filter(({ hashes }) => hashes.length);
    const replacedHash = hashes[0] ?? projections[0]?.hashes[0];
    return replacedHash
      ? [
          {
            area: marker.area,
            key: marker.key,
            replacedHash,
            appliedHashes: hashes,
            projections,
            ...(marker.contexts ? { contexts: marker.contexts } : {}),
          },
        ]
      : [];
  });
  return changed ? result : markers;
}

/**
 * A later successful download can deliberately reintroduce the same content.
 * Verify it through canonical storage before retiring its older suppression;
 * a failed write with only a prepared receipt must keep the protection.
 */
export async function acknowledgeCloudSyncBackups(
  snapshot: CloudSyncSnapshot,
  storage: SnapshotStorage,
): Promise<readonly CloudSyncUndoMarker[]> {
  let retained = snapshot.retainedMarkers ?? [];
  for (const receipt of snapshot.appliedHashes) {
    if (
      receipt.kind !== 'folders' ||
      !retained.some((marker) => marker.area === receipt.area && marker.key === receipt.key)
    )
      continue;
    const read = async () => (await storage[receipt.area].get([receipt.key]))[receipt.key];
    const value = await read();
    if ((await hashCloudSyncContent(value)) !== receipt.hash) continue;
    if (canonicalJson(cloudSyncContent(value)) !== canonicalJson(cloudSyncContent(await read())))
      continue;
    retained = retireAcknowledgedHashes(retained, receipt);
  }
  return retained;
}

/** Only folder recovery owners participate in durable backup suppression. */
export function isFolderBackupMarker(marker: CloudSyncUndoMarker): boolean {
  return folderBackupKeysForMarkers([marker]).length > 0;
}
