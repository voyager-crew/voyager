/**
 * One durable pre-apply slot shared by popup and page downloads. Callers await
 * capture before their first write. A background highlight owner can capture
 * first and pass the id to the caller, which extends that same slot.
 *
 * Undo uses the original chrome.storage areas, including remove for missing
 * keys, so the normal storage listeners receive the restored state.
 */
import { StorageKeys } from '@/core/types/common';
import { createWriteQueue } from '@/features/storage/writeQueue';

import { CloudSyncFailure, cloudSyncFailureCode } from './CloudSyncFailure';
import { runCloudSyncUndoOwners } from './CloudSyncUndoOwners';
import {
  assertReadySnapshotRun,
  sameSnapshotContext,
  mergeSnapshotContexts,
} from './cloudSyncSnapshotContext';
import { hashSnapshotValue, hashCloudSyncContent } from './cloudSyncSnapshotHash';
import {
  type CloudSyncAppliedValue,
  type CloudSyncRun,
  type CloudSyncSnapshot,
  type CloudSyncSnapshotSlot,
  type CloudSyncUndoResult,
  type SnapshotContext,
  type SnapshotEntry,
  type StorageWriteKey,
  parseCloudSyncSnapshotSlot,
} from './cloudSyncSnapshotTypes';
import { undoCapturedCloudSyncSnapshot } from './cloudSyncSnapshotUndo';

export type {
  CloudSyncAppliedValue,
  CloudSyncKind,
  CloudSyncSnapshot,
  CloudSyncSnapshotSlot,
  CloudSyncUndoMarker,
  SnapshotValueHash,
  CloudSyncUndoResult,
  SnapshotContext,
  SnapshotEntry,
  StorageWriteKey,
} from './cloudSyncSnapshotTypes';

interface SnapshotStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface SnapshotStorage {
  readonly local: SnapshotStorageArea;
  readonly sync: SnapshotStorageArea;
}

export interface CaptureCloudSyncSnapshotInput {
  readonly context: SnapshotContext;
  readonly keys: readonly StorageWriteKey[];
  /** Extend an earlier capture by this download, including background-owned keys. */
  readonly snapshotId?: string;
  /** Background-only admission for one sequential row in an explicit run. */
  readonly run?: { readonly owner: string; readonly operationId: string };
}

export interface SnapshotExtensionOptions {
  /** Exact intended payloads, persisted before their owners write them. */
  readonly applied?: readonly CloudSyncAppliedValue[];
}

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;

function keyIdentity(target: StorageWriteKey): string {
  return JSON.stringify([target.area, target.key]);
}

function receiptIdentity(receipt: StorageWriteKey & { readonly hash: string }): string {
  return JSON.stringify([receipt.area, receipt.key, receipt.hash]);
}

function uniqueKeys(keys: readonly StorageWriteKey[]): StorageWriteKey[] {
  const unique = new Map<string, StorageWriteKey>();
  for (const target of keys) {
    if (!target.key || (target.area === 'local' && target.key === SLOT)) {
      throw new Error('Invalid cloud snapshot key');
    }
    unique.set(keyIdentity(target), { area: target.area, key: target.key });
  }
  return [...unique.values()];
}

/** A service owns ordering; no captured user data is cached outside storage. */
export class CloudSyncSnapshotService {
  private readonly serialize = createWriteQueue();

  constructor(private readonly storage: () => SnapshotStorage) {}

  private async readSlot(): Promise<CloudSyncSnapshotSlot | null> {
    const raw: unknown = (await this.storage().local.get([SLOT]))[SLOT];
    if (raw === undefined) return null;
    const snapshot = parseCloudSyncSnapshotSlot(raw);
    if (
      !snapshot ||
      (snapshot.kind === 'undone' ? snapshot.markers : snapshot.entries).some(
        (entry) => entry.area === 'local' && entry.key === SLOT,
      )
    ) {
      throw new Error('Invalid cloud snapshot');
    }
    return snapshot;
  }

  private async captureEntries(keys: readonly StorageWriteKey[]): Promise<SnapshotEntry[]> {
    const areas = this.storage();
    const entries: SnapshotEntry[] = [];
    for (const area of ['local', 'sync'] as const) {
      const targets = keys.filter((target) => target.area === area);
      if (targets.length === 0) continue;
      const stored = await areas[area].get(targets.map((target) => target.key));
      for (const target of targets) {
        entries.push(
          Object.prototype.hasOwnProperty.call(stored, target.key)
            ? { ...target, existed: true, value: stored[target.key] }
            : { ...target, existed: false },
        );
      }
    }
    return entries;
  }

  private async extendSlot(
    snapshotId: string,
    keys: readonly StorageWriteKey[],
    options: SnapshotExtensionOptions & { context?: SnapshotContext; run?: CloudSyncRun } = {},
  ): Promise<CloudSyncSnapshot> {
    const snapshot = await this.readSlot();
    if (!snapshot || snapshot.kind !== 'snapshot' || snapshot.id !== snapshotId)
      throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
    if (options.run) assertReadySnapshotRun(snapshot, snapshotId, options.run.owner);
    const captured = new Set(snapshot.entries.map(keyIdentity));
    const additions = uniqueKeys(keys).filter((key) => !captured.has(keyIdentity(key)));
    if (options.applied && additions.length) throw new Error('Apply keys were not captured');
    if (
      additions.length === 0 &&
      !options.applied?.length &&
      !options.run &&
      !(snapshot.run && options.context)
    )
      return snapshot;
    const run = options.run ?? snapshot.run;
    if (options.applied?.length && run && !run.active)
      throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
    // Owners receipt inside their write queue: preserve edits that settled after initial capture.
    // Once a key has a receipt its baseline belongs to this download and must never move again.
    const receipted = new Set(snapshot.appliedHashes.map(keyIdentity));
    const fresh = new Map(
      (
        await this.captureEntries(
          uniqueKeys(options.applied ?? []).filter((target) => !receipted.has(keyIdentity(target))),
        )
      ).map((entry) => [keyIdentity(entry), entry]),
    );
    const entries = [
      ...snapshot.entries.map((entry) => {
        const refreshed = fresh.get(keyIdentity(entry));
        return refreshed
          ? {
              ...refreshed,
              ...(entry.contexts ? { contexts: entry.contexts } : {}),
              ...(entry.preserve ? { preserve: true as const } : {}),
            }
          : entry;
      }),
      ...(await this.captureEntries(additions)),
    ];
    if (run?.active && options.context) {
      const requested = new Set(keys.map(keyIdentity));
      for (const [index, entry] of entries.entries()) {
        if (requested.has(keyIdentity(entry)))
          entries[index] = {
            ...entry,
            contexts: mergeSnapshotContexts(entry.contexts ?? [], run.active.context),
          };
      }
    }
    const applied = new Map(snapshot.appliedHashes.map((entry) => [receiptIdentity(entry), entry]));
    for (const write of options.applied ?? []) {
      if (!captured.has(keyIdentity(write))) throw new Error('Apply keys were not captured');
      const earlier = snapshot.appliedHashes.filter(
        (entry) => keyIdentity(entry) === keyIdentity(write),
      );
      const index = entries.findIndex((entry) => keyIdentity(entry) === keyIdentity(write));
      const original = entries[index];
      if (run && earlier.length && original && !original.preserve) {
        const [live] = await this.captureEntries([write]);
        const hash = await hashCloudSyncContent(live.existed ? live.value : undefined);
        const prior = await hashCloudSyncContent(original.existed ? original.value : undefined);
        // A later row can merge a new user edit into an already receipted shared bucket.
        // Keep that whole bucket on undo instead of reverting the edit to the run's old baseline.
        if (hash !== prior && !earlier.some((receipt) => receipt.hash === hash))
          entries[index] = { ...original, preserve: true };
      }
      const hashed = await hashSnapshotValue({ area: write.area, key: write.key }, write.value);
      const previous = applied.get(receiptIdentity(hashed));
      const receipt = {
        ...hashed,
        kind: write.kind,
        ...(run?.active
          ? {
              contexts: mergeSnapshotContexts(previous?.contexts ?? [], run.active.context),
              operationIds: [
                ...new Set([...(previous?.operationIds ?? []), run.active.operationId]),
              ],
            }
          : {}),
      };
      // A later prepared write may fail after an earlier value of this key committed.
      applied.set(receiptIdentity(receipt), receipt);
    }
    // A different context may have replaced the slot while storage was read.
    const current = await this.readSlot();
    if (
      !current ||
      current.kind !== 'snapshot' ||
      current.id !== snapshotId ||
      current.run?.active?.operationId !== snapshot.run?.active?.operationId
    )
      throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
    const extended: CloudSyncSnapshot = {
      ...snapshot,
      entries,
      appliedHashes: [...applied.values()],
      ...(run ? { run } : {}),
    };
    await this.storage().local.set({ [SLOT]: extended });
    return extended;
  }

  capture(input: CaptureCloudSyncSnapshotInput): Promise<CloudSyncSnapshot> {
    return this.serialize(async () => {
      if (input.context.source === 'sync-run')
        throw new CloudSyncFailure(
          'invalid_sync_request',
          'A run row requires its own source context',
        );
      if (input.snapshotId !== undefined) {
        const slot = await this.readSlot();
        const snapshot = slot?.kind === 'snapshot' ? slot : null;
        if (!snapshot || snapshot.id !== input.snapshotId)
          throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
        if (input.run) {
          assertReadySnapshotRun(snapshot, input.snapshotId, input.run.owner);
          return this.extendSlot(input.snapshotId, input.keys, {
            context: input.context,
            run: {
              ...snapshot.run,
              contexts: mergeSnapshotContexts(snapshot.run.contexts, input.context),
              active: { operationId: input.run.operationId, context: input.context },
            },
          });
        }
        const context = snapshot.run?.active?.context ?? snapshot.context;
        if (!sameSnapshotContext(context, input.context) || (snapshot.run && !snapshot.run.active))
          throw new CloudSyncFailure(
            'snapshot_superseded',
            'Cloud snapshot scope does not match this download',
          );
        return this.extendSlot(input.snapshotId, input.keys, { context: input.context });
      }
      const snapshot: CloudSyncSnapshot = {
        kind: 'snapshot',
        appliedHashes: [],
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        // A Round C reader rejects this source before touching user data: run undo has new protection rules.
        context: input.run ? { ...input.context, source: 'sync-run' } : input.context,
        ...(input.run
          ? {
              run: {
                owner: input.run.owner,
                contexts: [input.context],
                active: { operationId: input.run.operationId, context: input.context },
              },
            }
          : {}),
        entries: (await this.captureEntries(uniqueKeys(input.keys))).map((entry) =>
          input.run ? { ...entry, contexts: [input.context] } : entry,
        ),
      };
      // A failed persist propagates: the caller must perform zero apply writes.
      await this.storage().local.set({ [SLOT]: snapshot });
      return snapshot;
    });
  }

  extend(
    snapshotId: string,
    keys: readonly StorageWriteKey[],
    options?: SnapshotExtensionOptions,
  ): Promise<CloudSyncSnapshot> {
    // Freeze the owner's argument before awaiting another operation in this context's queue.
    const capturedOptions = options?.applied
      ? { applied: structuredClone(options.applied) }
      : undefined;
    return this.serialize(() => this.extendSlot(snapshotId, keys, capturedOptions));
  }

  /** Drop only unreceipted targets. A prepared write may have committed before reporting failure. */
  finish(snapshotId: string): Promise<void> {
    return this.serialize(async () => {
      const slot = await this.readSlot();
      if (!slot || slot.kind !== 'snapshot' || slot.id !== snapshotId) return;
      const receipted = new Set(slot.appliedHashes.map(keyIdentity));
      const entries = slot.entries.filter((entry) => receipted.has(keyIdentity(entry)));
      if (entries.length === slot.entries.length) return;
      await this.storage().local.set({
        [SLOT]: entries.length || slot.run ? { ...slot, entries } : { kind: 'undone', markers: [] },
      });
    });
  }

  assertRun(snapshotId: string, owner: string): Promise<void> {
    return this.serialize(async () => {
      const slot = await this.readSlot();
      assertReadySnapshotRun(slot?.kind === 'snapshot' ? slot : null, snapshotId, owner);
    });
  }

  finishRunRow(snapshotId: string, operationId: string): Promise<void> {
    return this.serialize(async () => {
      const slot = await this.readSlot();
      if (
        !slot ||
        slot.kind !== 'snapshot' ||
        slot.id !== snapshotId ||
        slot.run?.active?.operationId !== operationId
      )
        return;
      const { active: _active, ...run } = slot.run;
      await this.storage().local.set({ [SLOT]: { ...slot, run } });
    });
  }

  read(): Promise<CloudSyncSnapshot | null> {
    return this.serialize(async () => {
      const slot = await this.readSlot();
      return slot?.kind === 'undone' ? null : slot;
    });
  }

  async undo(expectedSnapshotId?: string): Promise<CloudSyncUndoResult> {
    let requestedId = expectedSnapshotId;
    try {
      const requested = await this.readSlot();
      if (!requested || requested.kind === 'undone') return { status: 'absent' };
      if (expectedSnapshotId !== undefined && requested.id !== expectedSnapshotId)
        return { status: 'superseded', snapshotId: expectedSnapshotId };
      requestedId = requested.id;
      return await runCloudSyncUndoOwners(requested.entries, () =>
        this.serialize(async () => {
          const snapshot = await this.readSlot();
          if (!snapshot || snapshot.kind === 'undone') return { status: 'absent' };
          if (snapshot.id !== requested.id)
            throw new CloudSyncFailure(
              'snapshot_superseded',
              'Cloud snapshot is no longer current',
            );
          return undoCapturedCloudSyncSnapshot(snapshot, this.storage(), () => this.readSlot());
        }),
      );
    } catch (error) {
      if (requestedId !== undefined && cloudSyncFailureCode(error) === 'snapshot_superseded')
        return { status: 'superseded', snapshotId: requestedId };
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

const snapshotService = new CloudSyncSnapshotService(() => chrome.storage);

export function captureCloudSyncSnapshot(
  input: CaptureCloudSyncSnapshotInput,
): Promise<CloudSyncSnapshot> {
  return snapshotService.capture(input);
}

export function extendCloudSyncSnapshot(
  snapshotId: string,
  keys: readonly StorageWriteKey[],
  options?: SnapshotExtensionOptions,
): Promise<CloudSyncSnapshot> {
  return snapshotService.extend(snapshotId, keys, options);
}

export function readCloudSyncSnapshot(): Promise<CloudSyncSnapshot | null> {
  return snapshotService.read();
}

/** Write-ahead intent: owners must await this before the physical write, including on retries. */
export async function recordCloudSyncWrites(
  snapshotId: string,
  writes: readonly CloudSyncAppliedValue[],
): Promise<void> {
  try {
    if (writes.length) await snapshotService.extend(snapshotId, writes, { applied: writes });
  } catch (cause) {
    if (cloudSyncFailureCode(cause) === 'snapshot_superseded') throw cause;
    throw new CloudSyncFailure(
      'snapshot_receipt_failed',
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  }
}

export function finishCloudSyncSnapshot(snapshotId: string): Promise<void> {
  return snapshotService.finish(snapshotId);
}

export function undoCloudSyncSnapshot(expectedSnapshotId?: string): Promise<CloudSyncUndoResult> {
  return snapshotService.undo(expectedSnapshotId);
}

export function assertCloudSyncSnapshotRun(snapshotId: string, owner: string): Promise<void> {
  return snapshotService.assertRun(snapshotId, owner);
}

export function finishCloudSyncRunRow(snapshotId: string, operationId: string): Promise<void> {
  return snapshotService.finishRunRow(snapshotId, operationId);
}
