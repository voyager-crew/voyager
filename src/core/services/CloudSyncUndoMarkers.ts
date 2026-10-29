import { StorageKeys } from '@/core/types/common';

import { hashCloudSyncContent } from './cloudSyncSnapshotHash';
import { type StorageWriteKey, parseCloudSyncSnapshotSlot } from './cloudSyncSnapshotTypes';

/** Read directly: storage listeners may need the markers while undo is still restoring keys. */
export async function isUndoneCloudSyncValue(
  input: StorageWriteKey & { value: unknown; projection?: string },
): Promise<boolean> {
  const stored: unknown = (
    await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)
  )[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT];
  const slot = parseCloudSyncSnapshotSlot(stored);
  if (stored !== undefined && !slot) throw new Error('Invalid cloud snapshot');
  if (!slot || slot.kind === 'snapshot') return false;
  const marker = slot.markers.find((entry) => entry.area === input.area && entry.key === input.key);
  if (!marker) return false;
  const hashes =
    input.projection === undefined
      ? contentHashes(marker)
      : (marker.projections.find((entry) => entry.projection === input.projection)?.hashes ?? []);
  if (!hashes.length) return false;
  const hash = await hashCloudSyncContent(input.value);
  if (!hashes.includes(hash)) return false;
  // A new capture retires the marker even if a digest was still in flight.
  const latest: unknown = (
    await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)
  )[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT];
  const current = parseCloudSyncSnapshotSlot(latest);
  if (latest !== undefined && !current) throw new Error('Invalid cloud snapshot');
  if (!current || current.kind === 'snapshot') return false;
  const active = current.markers.find(
    (entry) => entry.area === input.area && entry.key === input.key,
  );
  return (
    !!active &&
    (input.projection === undefined
      ? contentHashes(active)
      : (active.projections.find((entry) => entry.projection === input.projection)?.hashes ?? [])
    ).includes(hash)
  );
}

function contentHashes(marker: import('./cloudSyncSnapshotTypes').CloudSyncUndoMarker) {
  return [
    marker.replacedHash,
    marker.appliedHash,
    ...(marker.appliedHashes ?? []),
    ...marker.projections.flatMap(({ projection, hashes }) =>
      projection === 'folder-normalized' || projection === 'folder-loaded' ? hashes : [],
    ),
  ];
}
