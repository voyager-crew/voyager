import { StorageKeys } from '@/core/types/common';
import { canonicalJson } from '@/core/utils/canonicalHash';

import { CloudSyncFailure } from './CloudSyncFailure';
import type { SnapshotStorage } from './CloudSyncSnapshotService';
import { assertCloudSyncUndoOwnerWritable } from './CloudSyncUndoOwners';
import { prepareHighlightSnapshotUndo, repairHighlightUndoIndexes } from './cloudSyncHighlightUndo';
import { mergeSnapshotContexts } from './cloudSyncSnapshotContext';
import { cloudSyncContent, hashCloudSyncContent } from './cloudSyncSnapshotHash';
import type {
  CloudSyncAppliedHash,
  CloudSyncKind,
  CloudSyncSnapshot,
  CloudSyncSnapshotSlot,
  CloudSyncUndoKept,
  CloudSyncUndoMarker,
  CloudSyncUndoProgressMarker,
  CloudSyncUndoResult,
  SnapshotEntry,
  StorageWriteKey,
} from './cloudSyncSnapshotTypes';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;

function identity(target: StorageWriteKey): string {
  return JSON.stringify([target.area, target.key]);
}

type KeyReceipts = [CloudSyncAppliedHash, ...CloudSyncAppliedHash[]];

function markerFor(receipts: KeyReceipts, replacedHash = receipts[0].hash): CloudSyncUndoMarker {
  const projections = new Map<string, Set<string>>();
  for (const receipt of receipts) {
    for (const { projection, hash } of receipt.projections ?? []) {
      const hashes = projections.get(projection) ?? new Set<string>();
      hashes.add(hash);
      projections.set(projection, hashes);
    }
  }
  const contexts = receipts
    .flatMap((receipt) => receipt.contexts ?? [])
    .reduce(
      (all, context) => mergeSnapshotContexts(all, context),
      [] as readonly import('./cloudSyncSnapshotTypes').SnapshotContext[],
    );
  return {
    ...(contexts.length ? { contexts } : {}),
    area: receipts[0].area,
    key: receipts[0].key,
    replacedHash,
    appliedHash: receipts[0].hash,
    appliedHashes: [...new Set(receipts.map(({ hash }) => hash))],
    projections: [...projections].map(([projection, hashes]) => ({
      projection,
      hashes: [...hashes],
    })),
  };
}

/** Recheck after hashing: a value changed during the digest must not be restored. */
async function currentHash(
  storage: SnapshotStorage,
  target: StorageWriteKey,
): Promise<string | null> {
  const read = async () => (await storage[target.area].get([target.key]))[target.key];
  const value = await read();
  const hash = await hashCloudSyncContent(value);
  const latest = await read();
  return canonicalJson(cloudSyncContent(value)) === canonicalJson(cloudSyncContent(latest))
    ? hash
    : null;
}

/** Only receipted values can be undone. A later edit belongs to its writer. */
export async function undoCapturedCloudSyncSnapshot(
  inputSnapshot: CloudSyncSnapshot,
  storage: SnapshotStorage,
  readSlot: () => Promise<CloudSyncSnapshotSlot | null>,
): Promise<CloudSyncUndoResult> {
  const { snapshot, blocked, repair } = await prepareHighlightSnapshotUndo(inputSnapshot, storage);
  const applied = new Map<string, KeyReceipts>();
  for (const receipt of snapshot.appliedHashes) {
    const receipts = applied.get(identity(receipt));
    if (receipts) receipts.push(receipt);
    else applied.set(identity(receipt), [receipt]);
  }
  const written = snapshot.entries.flatMap((entry) => {
    const receipts = applied.get(identity(entry));
    return receipts ? [{ entry, receipts }] : [];
  });
  const kept = new Map<CloudSyncKind, StorageWriteKey[]>();
  const keep = (entry: SnapshotEntry, receipts: KeyReceipts) => {
    for (const kind of new Set(receipts.map((receipt) => receipt.kind))) {
      const targets = kept.get(kind) ?? [];
      targets.push({
        area: entry.area,
        key: entry.key,
        ...(entry.contexts ? { contexts: entry.contexts } : {}),
      });
      kept.set(kind, targets);
    }
  };
  const candidates: Array<(typeof written)[number] & { priorHash: string }> = [];
  const completed: CloudSyncUndoMarker[] = [];
  const progress = new Map<string, CloudSyncUndoProgressMarker>();
  let restoredKeys = 0;
  for (const item of written) {
    if (item.entry.preserve || (item.entry.area === 'local' && blocked.has(item.entry.key))) {
      keep(item.entry, item.receipts);
      continue;
    }
    const priorHash = await hashCloudSyncContent(item.entry.existed ? item.entry.value : undefined);
    const hash = await currentHash(storage, item.entry);
    const marker = markerFor(item.receipts);
    // Even an unwritten receipt can leave a page mirror; suppress it without counting a restore.
    if (hash === priorHash) {
      const previous =
        snapshot.kind === 'undoing'
          ? snapshot.markers.find((entry) => identity(entry) === identity(item.entry))
          : undefined;
      const resumed = previous !== undefined && !previous.suppressionOnly;
      if (resumed) restoredKeys += 1;
      completed.push(marker);
      progress.set(identity(item.entry), resumed ? marker : { ...marker, suppressionOnly: true });
    } else if (item.receipts.some((receipt) => receipt.hash === hash)) {
      candidates.push({ ...item, priorHash });
      progress.set(identity(item.entry), marker);
    } else keep(item.entry, item.receipts);
  }
  const assertCurrent = async () => {
    const current = await readSlot();
    if (!current || current.kind === 'undone' || current.id !== snapshot.id)
      throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
  };
  const persistProgress = async () => {
    await assertCurrent();
    // Publish markers before canonical removal can wake recovery.
    await storage.local.set({
      [SLOT]: {
        ...snapshot,
        kind: 'undoing',
        entries: written.map(({ entry }) => entry),
        markers: [...progress.values()],
      },
    });
  };
  await persistProgress();
  for (const { entry, receipts, priorHash } of candidates) {
    await assertCurrent();
    // Slot persistence and earlier key writes can both be outlived by ordinary user edits.
    const hash = await currentHash(storage, entry);
    if (hash === null || hash === priorHash || !receipts.some((receipt) => receipt.hash === hash)) {
      if (hash === priorHash) {
        const marker = markerFor(receipts);
        completed.push(marker);
        progress.set(identity(entry), { ...marker, suppressionOnly: true });
      } else {
        keep(entry, receipts);
        progress.delete(identity(entry));
      }
      // A subsequent failed restore must not count this unchanged key when undo resumes.
      await persistProgress();
      continue;
    }
    // Q8 accepts chrome.storage's cross-context check/write window; await nothing else here.
    assertCloudSyncUndoOwnerWritable(entry);
    if (entry.existed) await storage[entry.area].set({ [entry.key]: entry.value });
    else await storage[entry.area].remove([entry.key]);
    completed.push(markerFor(receipts, hash));
    restoredKeys += 1;
  }
  await repairHighlightUndoIndexes(snapshot, repair, storage, assertCurrent);
  await assertCurrent();
  await storage.local.set({ [SLOT]: { kind: 'undone', markers: completed } });
  const keptKinds: CloudSyncUndoKept[] = [...kept].map(([kind, keys]) => ({
    kind,
    keys,
    reason: 'changed-since-download',
  }));
  return {
    status: 'restored',
    snapshotId: snapshot.id,
    restoredKeys,
    kept: keptKinds,
  };
}
