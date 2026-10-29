import { StorageKeys } from '@/core/types/common';
import { canonicalJson } from '@/core/utils/canonicalHash';

import { CloudSyncFailure } from './CloudSyncFailure';
import type { SnapshotStorage } from './CloudSyncSnapshotService';
import { cloudSyncUndoMarkers } from './CloudSyncUndoMarkers';
import { assertCloudSyncUndoOwnerWritable } from './CloudSyncUndoOwners';
import { retryCloudSyncBackupCleanup } from './cloudSyncBackupCleanup';
import { prepareHighlightSnapshotUndo, repairHighlightUndoIndexes } from './cloudSyncHighlightUndo';
import { mergeSnapshotContexts } from './cloudSyncSnapshotContext';
import { cloudSyncContent, hashCloudSyncContent, hashSnapshotValue } from './cloudSyncSnapshotHash';
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
  SnapshotValueHash,
  StorageWriteKey,
} from './cloudSyncSnapshotTypes';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;

function identity(target: StorageWriteKey): string {
  return JSON.stringify([target.area, target.key]);
}

type KeyReceipts = [CloudSyncAppliedHash, ...CloudSyncAppliedHash[]];

function priorContentHashes(prior: SnapshotValueHash): ReadonlySet<string> {
  return new Set([
    prior.hash,
    ...(prior.projections ?? []).flatMap(({ projection, hash }) =>
      projection === 'folder-normalized' || projection === 'folder-loaded' ? [hash] : [],
    ),
  ]);
}

function markerFor(
  receipts: KeyReceipts,
  prior: SnapshotValueHash,
  priorHashes: ReadonlySet<string>,
): CloudSyncUndoMarker | null {
  // Raw and deterministic owner forms of the baseline remain valid recovery data.
  const changed = receipts.filter((receipt) => !priorHashes.has(receipt.hash));
  const first = changed[0];
  if (!first) return null;
  const projections = new Map<string, Set<string>>();
  const priorProjections = new Map(
    prior.projections?.map(({ projection, hash }) => [projection, hash]),
  );
  for (const receipt of changed) {
    for (const { projection, hash } of receipt.projections ?? []) {
      if (priorHashes.has(hash) || priorProjections.get(projection) === hash) continue;
      const hashes = projections.get(projection) ?? new Set<string>();
      hashes.add(hash);
      projections.set(projection, hashes);
    }
  }
  const contexts = changed
    .flatMap((receipt) => receipt.contexts ?? [])
    .reduce(
      (all, context) => mergeSnapshotContexts(all, context),
      [] as readonly import('./cloudSyncSnapshotTypes').SnapshotContext[],
    );
  return {
    ...(contexts.length ? { contexts } : {}),
    area: first.area,
    key: first.key,
    replacedHash: first.hash,
    appliedHash: first.hash,
    appliedHashes: [...new Set(changed.map(({ hash }) => hash))],
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
  const candidates: Array<
    (typeof written)[number] & {
      priorHash: string;
      priorHashes: ReadonlySet<string>;
      marker: CloudSyncUndoMarker | null;
    }
  > = [];
  const completed: CloudSyncUndoMarker[] = [];
  const progress = new Map<string, CloudSyncUndoProgressMarker>();
  const restoreKeys = new Map<string, StorageWriteKey>();
  const restoreIntent = (entry: StorageWriteKey) =>
    restoreKeys.set(identity(entry), { area: entry.area, key: entry.key });
  let restoredKeys = 0;
  for (const item of written) {
    if (item.entry.preserve || (item.entry.area === 'local' && blocked.has(item.entry.key))) {
      keep(item.entry, item.receipts);
      continue;
    }
    const prior = await hashSnapshotValue(
      item.entry,
      item.entry.existed ? item.entry.value : undefined,
    );
    const priorHash = prior.hash;
    const priorHashes = priorContentHashes(prior);
    const hash = await currentHash(storage, item.entry);
    const marker = markerFor(item.receipts, prior, priorHashes);
    // Even an unwritten receipt can leave a page mirror; suppress it without counting a restore.
    if (hash === priorHash) {
      const previous =
        snapshot.kind === 'undoing'
          ? snapshot.markers.find((entry) => identity(entry) === identity(item.entry))
          : undefined;
      const resumed =
        snapshot.kind === 'undoing' &&
        (snapshot.restoreKeys === undefined
          ? previous !== undefined && !previous.suppressionOnly
          : snapshot.restoreKeys.some((entry) => identity(entry) === identity(item.entry)));
      if (resumed) {
        restoredKeys += 1;
        restoreIntent(item.entry);
      }
      if (marker) {
        completed.push(marker);
        progress.set(identity(item.entry), resumed ? marker : { ...marker, suppressionOnly: true });
      }
    } else if (item.receipts.some((receipt) => receipt.hash === hash)) {
      candidates.push({ ...item, priorHash, priorHashes, marker });
      restoreIntent(item.entry);
      if (marker) progress.set(identity(item.entry), marker);
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
        restoreKeys: [...restoreKeys.values()],
      },
    });
  };
  await persistProgress();
  for (const { entry, receipts, priorHash, priorHashes, marker } of candidates) {
    await assertCurrent();
    // Slot persistence and earlier key writes can both be outlived by ordinary user edits.
    const hash = await currentHash(storage, entry);
    if (hash === null || hash === priorHash || !receipts.some((receipt) => receipt.hash === hash)) {
      if (hash === priorHash) {
        if (marker) {
          completed.push(marker);
          progress.set(identity(entry), { ...marker, suppressionOnly: true });
        }
      } else {
        keep(entry, receipts);
        progress.delete(identity(entry));
      }
      restoreKeys.delete(identity(entry));
      // A subsequent failed restore must not count this unchanged key when undo resumes.
      await persistProgress();
      continue;
    }
    // Q8 accepts chrome.storage's cross-context check/write window; await nothing else here.
    assertCloudSyncUndoOwnerWritable(entry);
    if (entry.existed) await storage[entry.area].set({ [entry.key]: entry.value });
    else await storage[entry.area].remove([entry.key]);
    if (marker)
      completed.push({
        ...marker,
        replacedHash: priorHashes.has(hash) ? marker.replacedHash : hash,
      });
    restoredKeys += 1;
  }
  await repairHighlightUndoIndexes(snapshot, repair, storage, assertCurrent);
  await assertCurrent();
  const undone: CloudSyncSnapshotSlot = {
    kind: 'undone',
    markers: completed,
    ...(snapshot.retainedMarkers ? { retainedMarkers: snapshot.retainedMarkers } : {}),
  };
  await storage.local.set({ [SLOT]: undone });
  void retryCloudSyncBackupCleanup(cloudSyncUndoMarkers(undone));
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
