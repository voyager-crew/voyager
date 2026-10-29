import { StorageKeys } from '@/core/types/common';
import { canonicalJson } from '@/core/utils/canonicalHash';

import { CloudSyncFailure } from './CloudSyncFailure';
import type { SnapshotStorage } from './CloudSyncSnapshotService';
import {
  cloudSyncUndoMarkers,
  matchesCloudSyncUndoHash,
  mergeCloudSyncUndoMarkers,
} from './CloudSyncUndoMarkers';
import { isFolderBackupMarker } from './cloudSyncBackupAcknowledgment';
import { cloudSyncContent, hashCloudSyncContent } from './cloudSyncSnapshotHash';
import { parseCloudSyncSnapshotSlot, type CloudSyncSnapshotSlot } from './cloudSyncSnapshotTypes';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const QUARANTINE = StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE;

export function parseStoredCloudSyncSnapshotSlot(raw: unknown): CloudSyncSnapshotSlot | null {
  const slot = parseCloudSyncSnapshotSlot(raw);
  return slot &&
    !(slot.kind === 'undone' ? slot.markers : slot.entries).some(
      (entry) => entry.area === 'local' && (entry.key === SLOT || entry.key === QUARANTINE),
    )
    ? slot
    : null;
}

/** Carry interrupted Undo only for values no longer canonical; live downloads stay recoverable. */
export async function readCloudSyncCaptureState(storage: SnapshotStorage['local']) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw: unknown = (await storage.get([SLOT]))[SLOT];
    const previous = parseStoredCloudSyncSnapshotSlot(raw);
    const completed =
      previous?.kind === 'undone'
        ? cloudSyncUndoMarkers(previous)
        : (previous?.retainedMarkers ?? []);
    const pending =
      previous?.kind === 'undoing' ? previous.markers.filter(isFolderBackupMarker) : [];
    const retained = [...completed];
    if (pending.length) {
      // Folder backup markers name local keys. Read them together again after every digest settles.
      const keys = pending.map(({ key }) => key);
      const observed = await storage.get(keys);
      const hashes = await Promise.all(
        pending.map(({ key }) => hashCloudSyncContent(observed[key])),
      );
      const latest = await storage.get([SLOT, ...keys]);
      if (
        canonicalJson(latest[SLOT]) !== canonicalJson(raw) ||
        keys.some(
          (key) =>
            canonicalJson(cloudSyncContent(latest[key])) !==
            canonicalJson(cloudSyncContent(observed[key])),
        )
      )
        continue;
      for (const [index, marker] of pending.entries()) {
        if (!matchesCloudSyncUndoHash([marker], { ...marker, hash: hashes[index] }))
          retained.push(marker);
      }
    }
    return {
      raw,
      previous,
      retainedMarkers: mergeCloudSyncUndoMarkers(retained.filter(isFolderBackupMarker)),
    };
  }
  // Never replace suppression selected from a slot or canonical value that kept changing.
  throw new CloudSyncFailure('snapshot_failed', 'Cloud snapshot changed while preparing capture');
}
