import {
  HIGHLIGHT_BUCKET_KEY_PREFIX,
  HIGHLIGHT_INDEX_KEY_PREFIX,
  HIGHLIGHT_PLATFORMS,
  isHighlightPlatform,
  type HighlightConversationBucketV1,
} from '@/core/types/highlight';
import { canonicalJson } from '@/core/utils/canonicalHash';

import type { SnapshotStorage } from './CloudSyncSnapshotService';
import { hashCloudSyncContent } from './cloudSyncSnapshotHash';
import type { CloudSyncSnapshot, SnapshotEntry } from './cloudSyncSnapshotTypes';
import {
  isObject,
  parseBucket,
  parseIndex,
  updateIndexEntry,
  validateRecord,
  isClearedByMarker,
} from './highlightAnnotationData';

function bucket(value: unknown): HighlightConversationBucketV1 | null {
  if (
    !isObject(value) ||
    !isHighlightPlatform(value.platform) ||
    typeof value.accountHash !== 'string' ||
    typeof value.conversationId !== 'string'
  )
    return null;
  return parseBucket(
    value,
    { platform: value.platform, accountHash: value.accountHash },
    value.conversationId,
    0,
  );
}

/** Indexes and clear generations are dependencies of the buckets, not independent user values. */
export async function prepareHighlightSnapshotUndo(
  snapshot: CloudSyncSnapshot,
  storage: SnapshotStorage,
) {
  const entries = [...snapshot.entries];
  const blocked = new Set<string>();
  const repair = new Set<string>();
  const local = snapshot.entries.filter(
    (entry) =>
      entry.area === 'local' &&
      (entry.key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX) ||
        entry.key.startsWith(HIGHLIGHT_BUCKET_KEY_PREFIX)),
  );
  if (!local.length) return { snapshot, blocked, repair };
  const stored = await storage.local.get(local.map(({ key }) => key));
  for (const indexEntry of local.filter(({ key }) => key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX))) {
    const accountHash = indexEntry.key.slice(HIGHLIGHT_INDEX_KEY_PREFIX.length);
    const accountBuckets = local.filter(({ key }) =>
      key.startsWith(`${HIGHLIGHT_BUCKET_KEY_PREFIX}${accountHash}:`),
    );
    if (snapshot.run && (indexEntry.preserve || accountBuckets.some((entry) => entry.preserve))) {
      // A later row can receipt a user's clear marker or edited bucket. Keep their whole
      // dependency group: rebasing another bucket could resurrect a user-cleared highlight.
      blocked.add(indexEntry.key);
      for (const entry of accountBuckets) blocked.add(entry.key);
      continue;
    }
    const currentIndex = parseIndex(stored[indexEntry.key], accountHash, 0);
    const originalIndex = parseIndex(
      indexEntry.existed ? indexEntry.value : undefined,
      accountHash,
      0,
    );
    const indexReceipts = snapshot.appliedHashes.filter(
      ({ area, key }) => area === 'local' && key === indexEntry.key,
    );
    if (!indexReceipts.length) continue;
    const indexHash = await hashCloudSyncContent(stored[indexEntry.key]);
    const originalIndexHash = await hashCloudSyncContent(
      indexEntry.existed ? indexEntry.value : undefined,
    );
    const indexEdited =
      indexHash !== originalIndexHash && !indexReceipts.some(({ hash }) => hash === indexHash);
    for (const platform of HIGHLIGHT_PLATFORMS) {
      const targets = local.filter((entry) => {
        const value = bucket(entry.existed ? entry.value : stored[entry.key]);
        return value?.accountHash === accountHash && value.platform === platform;
      });
      if (!targets.length) continue;
      const marker = currentIndex.clearMarkers?.[platform];
      const markerHash = await hashCloudSyncContent(marker);
      const originalMarkerHash = await hashCloudSyncContent(originalIndex.clearMarkers?.[platform]);
      const importedMarker = indexReceipts.some((receipt) =>
        receipt.projections?.some(
          (projection) =>
            projection.projection === `highlight-clear:${platform}` &&
            projection.hash === markerHash,
        ),
      );
      // A later explicit clear belongs to the user; restoring its removed buckets would resurrect them.
      if (markerHash !== originalMarkerHash && !importedMarker) {
        for (const target of targets) blocked.add(target.key);
        blocked.add(indexEntry.key);
        continue;
      }
      let partial = indexEdited;
      for (const target of targets) {
        const currentHash = await hashCloudSyncContent(stored[target.key]);
        const priorHash = await hashCloudSyncContent(target.existed ? target.value : undefined);
        if (
          currentHash !== priorHash &&
          !snapshot.appliedHashes.some(
            (receipt) =>
              receipt.area === 'local' &&
              receipt.key === target.key &&
              receipt.hash === currentHash,
          )
        )
          partial = true;
      }
      if (!partial) continue;
      blocked.add(indexEntry.key);
      repair.add(indexEntry.key);
      if (!marker || markerHash === originalMarkerHash) continue;
      // Partial undo retains the current clear generation so later edited records stay byte-identical.
      // Only restored records adopt it; quote/note stay intact. Legacy markers require newer
      // ordering metadata (timestamp/revision) instead of the generation used by current records.
      for (const target of targets) {
        if (!target.existed) continue;
        const original = bucket(target.value);
        if (!original) continue;
        const records = Object.fromEntries(
          Object.entries(original.records).map(([id, record]) => [
            id,
            {
              ...record,
              ...(marker.generation
                ? { clearGeneration: marker.generation.id }
                : {
                    updatedAt: Math.max(record.updatedAt, marker.clearedAt + 1),
                    revision:
                      record.revision.deviceId === marker.revision.deviceId
                        ? {
                            ...record.revision,
                            counter: Math.max(record.revision.counter, marker.revision.counter + 1),
                          }
                        : record.revision,
                  }),
            },
          ]),
        );
        for (const record of Object.values(records)) {
          validateRecord(record);
          if (isClearedByMarker(record, marker))
            throw new Error('Highlight clear marker cannot preserve the restored record');
        }
        const replacement: SnapshotEntry = {
          ...target,
          existed: true,
          value: { ...original, records },
        };
        entries[entries.indexOf(target)] = replacement;
      }
    }
  }
  return { snapshot: { ...snapshot, entries }, blocked, repair };
}

/** Rebuild only affected index entries from the buckets that undo actually left in storage. */
export async function repairHighlightUndoIndexes(
  snapshot: CloudSyncSnapshot,
  keys: ReadonlySet<string>,
  storage: SnapshotStorage,
  assertCurrent: () => Promise<void>,
): Promise<void> {
  for (const key of keys) {
    const accountHash = key.slice(HIGHLIGHT_INDEX_KEY_PREFIX.length);
    const targets = snapshot.entries.filter(
      (entry) =>
        entry.area === 'local' &&
        entry.key.startsWith(`${HIGHLIGHT_BUCKET_KEY_PREFIX}${accountHash}:`),
    );
    const stored = await storage.local.get([key, ...targets.map((entry) => entry.key)]);
    let index = parseIndex(stored[key], accountHash, 0);
    for (const target of targets) {
      const value = bucket(stored[target.key]);
      if (value) index = updateIndexEntry(index, target.key, value, value.updatedAt);
      else
        index = {
          ...index,
          conversations: Object.fromEntries(
            Object.entries(index.conversations).filter(
              ([, entry]) => entry.bucketKey !== target.key,
            ),
          ),
        };
    }
    await assertCurrent();
    const latest = await storage.local.get([key, ...targets.map((entry) => entry.key)]);
    if (canonicalJson(latest) !== canonicalJson(stored))
      throw new Error('Highlights changed during undo');
    await storage.local.set({ [key]: index });
  }
}
