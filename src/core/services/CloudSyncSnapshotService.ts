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

import { runCloudSyncUndoOwners } from './CloudSyncUndoOwners';
import { hashSnapshotValue } from './cloudSyncSnapshotHash';
import {
  type CloudSyncAppliedValue,
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
    unique.set(keyIdentity(target), target);
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
    options: SnapshotExtensionOptions = {},
  ): Promise<CloudSyncSnapshot> {
    const snapshot = await this.readSlot();
    if (!snapshot || snapshot.kind !== 'snapshot' || snapshot.id !== snapshotId)
      throw new Error('Cloud snapshot is no longer current');
    const captured = new Set(snapshot.entries.map(keyIdentity));
    const additions = uniqueKeys(keys).filter((key) => !captured.has(keyIdentity(key)));
    if (options.applied && additions.length) throw new Error('Apply keys were not captured');
    if (additions.length === 0 && !options.applied?.length) return snapshot;
    const entries = [...snapshot.entries, ...(await this.captureEntries(additions))];
    const applied = new Map(snapshot.appliedHashes.map((entry) => [receiptIdentity(entry), entry]));
    for (const write of options.applied ?? []) {
      if (!captured.has(keyIdentity(write))) throw new Error('Apply keys were not captured');
      const receipt = {
        ...(await hashSnapshotValue({ area: write.area, key: write.key }, write.value)),
        kind: write.kind,
      };
      // A later prepared write may fail after an earlier value of this key committed.
      applied.set(receiptIdentity(receipt), receipt);
    }
    // A different context may have replaced the slot while storage was read.
    const current = await this.readSlot();
    if (!current || current.kind !== 'snapshot' || current.id !== snapshotId)
      throw new Error('Cloud snapshot is no longer current');
    const extended: CloudSyncSnapshot = {
      ...snapshot,
      entries,
      appliedHashes: [...applied.values()],
    };
    await this.storage().local.set({ [SLOT]: extended });
    return extended;
  }

  capture(input: CaptureCloudSyncSnapshotInput): Promise<CloudSyncSnapshot> {
    return this.serialize(async () => {
      if (input.snapshotId !== undefined) {
        const snapshot = await this.readSlot();
        if (
          !snapshot ||
          snapshot.kind !== 'snapshot' ||
          snapshot.context.source !== input.context.source ||
          snapshot.context.platform !== input.context.platform ||
          snapshot.context.accountScope?.accountKey !== input.context.accountScope?.accountKey
        ) {
          throw new Error('Cloud snapshot scope does not match this download');
        }
        return this.extendSlot(input.snapshotId, input.keys);
      }
      const snapshot: CloudSyncSnapshot = {
        kind: 'snapshot',
        appliedHashes: [],
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        context: input.context,
        entries: await this.captureEntries(uniqueKeys(input.keys)),
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
        [SLOT]: entries.length ? { ...slot, entries } : { kind: 'undone', markers: [] },
      });
    });
  }

  read(): Promise<CloudSyncSnapshot | null> {
    return this.serialize(async () => {
      const slot = await this.readSlot();
      return slot?.kind === 'undone' ? null : slot;
    });
  }

  async undo(): Promise<CloudSyncUndoResult> {
    try {
      const requested = await this.readSlot();
      if (!requested || requested.kind === 'undone') return { status: 'absent' };
      return await runCloudSyncUndoOwners(requested.entries, () =>
        this.serialize(async () => {
          const snapshot = await this.readSlot();
          if (!snapshot || snapshot.kind === 'undone') return { status: 'absent' };
          if (snapshot.id !== requested.id) throw new Error('Cloud snapshot is no longer current');
          return undoCapturedCloudSyncSnapshot(snapshot, this.storage(), () => this.readSlot());
        }),
      );
    } catch (error) {
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
  if (writes.length) await snapshotService.extend(snapshotId, writes, { applied: writes });
}

export function finishCloudSyncSnapshot(snapshotId: string): Promise<void> {
  return snapshotService.finish(snapshotId);
}

export function undoCloudSyncSnapshot(): Promise<CloudSyncUndoResult> {
  return snapshotService.undo();
}
