import { StorageKeys } from '@/core/types/common';

import { hashCloudSyncContent } from './cloudSyncSnapshotHash';
import {
  type CloudSyncSnapshotSlot,
  type CloudSyncUndoMarker,
  type StorageWriteKey,
  parseCloudSyncSnapshotSlot,
} from './cloudSyncSnapshotTypes';

export function cloudSyncUndoMarkers(
  slot: CloudSyncSnapshotSlot | null,
): readonly CloudSyncUndoMarker[] {
  return slot
    ? [...(slot.retainedMarkers ?? []), ...(slot.kind === 'snapshot' ? [] : slot.markers)]
    : [];
}

/** Coalesce hashes by physical key; replacing the Undo slot cannot revive parked page copies. */
export function mergeCloudSyncUndoMarkers(
  markers: readonly CloudSyncUndoMarker[],
): CloudSyncUndoMarker[] {
  const result = new Map<string, CloudSyncUndoMarker>();
  for (const marker of markers) {
    const identity = JSON.stringify([marker.area, marker.key]);
    const previous = result.get(identity);
    const projections = new Map<string, Set<string>>();
    for (const { projection, hashes } of [
      ...(previous?.projections ?? []),
      ...marker.projections,
    ]) {
      const merged = projections.get(projection) ?? new Set<string>();
      for (const hash of hashes) merged.add(hash);
      projections.set(projection, merged);
    }
    result.set(identity, {
      area: marker.area,
      key: marker.key,
      replacedHash: previous?.replacedHash ?? marker.replacedHash,
      appliedHashes: [
        ...new Set([...(previous ? contentHashes(previous) : []), ...contentHashes(marker)]),
      ],
      projections: [...projections].map(([projection, hashes]) => ({
        projection,
        hashes: [...hashes],
      })),
    });
  }
  return [...result.values()];
}

export function matchesCloudSyncUndoHash(
  markers: readonly CloudSyncUndoMarker[],
  input: StorageWriteKey & { hash: string; projection?: string },
): boolean {
  return markers.some(
    (marker) =>
      marker.area === input.area &&
      marker.key === input.key &&
      (input.projection === undefined
        ? contentHashes(marker)
        : (marker.projections.find((entry) => entry.projection === input.projection)?.hashes ?? [])
      ).includes(input.hash),
  );
}

/** Read directly: storage listeners may need the markers while undo is still restoring keys. */
export async function isUndoneCloudSyncValue(
  input: StorageWriteKey & { value: unknown; projection?: string },
): Promise<boolean> {
  const stored: unknown = (
    await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)
  )[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT];
  const slot = parseCloudSyncSnapshotSlot(stored);
  if (stored !== undefined && !slot) throw new Error('Invalid cloud snapshot');
  const markers = cloudSyncUndoMarkers(slot);
  if (!markers.some((entry) => entry.area === input.area && entry.key === input.key)) return false;
  const hash = await hashCloudSyncContent(input.value);
  if (!matchesCloudSyncUndoHash(markers, { ...input, hash })) return false;
  // A digest can outlive a capture or undo; only current suppression can reject it.
  const latest: unknown = (
    await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)
  )[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT];
  const current = parseCloudSyncSnapshotSlot(latest);
  if (latest !== undefined && !current) throw new Error('Invalid cloud snapshot');
  return matchesCloudSyncUndoHash(cloudSyncUndoMarkers(current), { ...input, hash });
}

function contentHashes(marker: CloudSyncUndoMarker) {
  return [
    marker.replacedHash,
    ...(marker.appliedHash ? [marker.appliedHash] : []),
    ...(marker.appliedHashes ?? []),
    ...marker.projections.flatMap(({ projection, hashes }) =>
      projection === 'folder-normalized' || projection === 'folder-loaded' ? hashes : [],
    ),
  ];
}
