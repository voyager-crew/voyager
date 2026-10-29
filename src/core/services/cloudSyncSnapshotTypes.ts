import type { SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import { ABSENT_HASH } from '@/core/utils/canonicalHash';
import { isFolderPlatform } from '@/features/folder/platforms';

export interface StorageWriteKey {
  readonly area: 'local' | 'sync';
  readonly key: string;
}

export type CloudSyncKind =
  | 'highlights'
  | 'plugins'
  | 'settings'
  | 'folders'
  | 'hierarchy'
  | 'prompts'
  | 'starred'
  | 'forks'
  | 'outlines';

/** A write-ahead receipt uses exactly what the owner intends to write, never a subsequent read. */
export interface CloudSyncAppliedValue extends StorageWriteKey {
  readonly kind: CloudSyncKind;
  readonly value: unknown;
}

export interface CloudSyncAppliedHash extends SnapshotValueHash {
  readonly kind: CloudSyncKind;
}

export interface CloudSyncUndoKept {
  readonly kind: CloudSyncKind;
  readonly keys: readonly StorageWriteKey[];
  readonly reason: 'changed-since-download';
}

export interface SnapshotContext {
  readonly source: 'popup-restore' | 'folder-panel-download';
  readonly platform: SyncPlatform;
  readonly accountScope: SyncAccountScope | null;
}

export type SnapshotEntry = StorageWriteKey &
  ({ readonly existed: false } | { readonly existed: true; readonly value: unknown });

export interface SnapshotValueHash extends StorageWriteKey {
  readonly hash: string;
  readonly projections?: readonly { projection: string; hash: string }[];
}

export interface CloudSyncUndoMarker extends StorageWriteKey {
  readonly replacedHash: string;
  readonly appliedHash?: string;
  readonly appliedHashes?: readonly string[];
  readonly projections: readonly { projection: string; hashes: readonly string[] }[];
}

/** Pending undo distinguishes unchanged originals from keys restored before an interruption. */
export interface CloudSyncUndoProgressMarker extends CloudSyncUndoMarker {
  readonly suppressionOnly?: true;
}

interface SnapshotData {
  readonly id: string;
  readonly timestamp: number;
  readonly context: SnapshotContext;
  readonly entries: readonly SnapshotEntry[];
  readonly appliedHashes: readonly CloudSyncAppliedHash[];
}

export type CloudSyncSnapshot = SnapshotData &
  (
    | { readonly kind: 'snapshot' }
    | { readonly kind: 'undoing'; readonly markers: readonly CloudSyncUndoProgressMarker[] }
  );

/** Contains only suppression hashes, never values that can be restored a second time. */
export interface CloudSyncUndoneRecord {
  readonly kind: 'undone';
  readonly markers: readonly CloudSyncUndoMarker[];
}

export type CloudSyncSnapshotSlot = CloudSyncSnapshot | CloudSyncUndoneRecord;

export type CloudSyncUndoResult =
  | { readonly status: 'absent' }
  | {
      readonly status: 'restored';
      readonly snapshotId: string;
      readonly restoredKeys: number;
      readonly kept: readonly CloudSyncUndoKept[];
    }
  | { readonly status: 'failed'; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAccountScope(value: unknown): SyncAccountScope | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.accountKey !== 'string' ||
    !Number.isSafeInteger(value.accountId) ||
    typeof value.accountId !== 'number' ||
    (value.routeUserId !== null && typeof value.routeUserId !== 'string')
  ) {
    return undefined;
  }
  return {
    accountKey: value.accountKey,
    accountId: value.accountId,
    routeUserId: value.routeUserId,
  };
}

function parseContext(value: unknown): SnapshotContext | null {
  if (
    !isRecord(value) ||
    (value.source !== 'popup-restore' && value.source !== 'folder-panel-download') ||
    !isFolderPlatform(value.platform)
  ) {
    return null;
  }
  const accountScope = parseAccountScope(value.accountScope);
  if (accountScope === undefined) return null;
  return { source: value.source, platform: value.platform, accountScope };
}

/** Storage is a boundary: reject an invalid slot without restoring or deleting it. */
export function parseCloudSyncSnapshot(value: unknown): CloudSyncSnapshot | null {
  if (
    !isRecord(value) ||
    (value.kind !== undefined && value.kind !== 'snapshot' && value.kind !== 'undoing') ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp) ||
    !Array.isArray(value.entries)
  ) {
    return null;
  }
  const context = parseContext(value.context);
  if (!context) return null;
  const entries: SnapshotEntry[] = [];
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      (entry.area !== 'local' && entry.area !== 'sync') ||
      typeof entry.key !== 'string' ||
      entry.key.length === 0 ||
      (entry.existed !== true && entry.existed !== false) ||
      (entry.existed && !Object.prototype.hasOwnProperty.call(entry, 'value'))
    ) {
      return null;
    }
    const identity = JSON.stringify([entry.area, entry.key]);
    if (seen.has(identity)) return null;
    seen.add(identity);
    const target: StorageWriteKey = { area: entry.area, key: entry.key };
    entries.push(
      entry.existed
        ? { ...target, existed: true, value: entry.value }
        : { ...target, existed: false },
    );
  }
  const appliedHashes = parseAppliedHashes(value.appliedHashes ?? []);
  if (!appliedHashes) return null;
  const data = { id: value.id, timestamp: value.timestamp, context, entries, appliedHashes };
  if (value.kind === 'undoing') {
    const markers = parseUndoMarkers(value.markers, true);
    return markers ? { ...data, kind: 'undoing', markers } : null;
  }
  return { ...data, kind: 'snapshot' };
}

function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && (value === ABSENT_HASH || /^[a-f0-9]{64}$/.test(value));
}

function parseTarget(value: Record<string, unknown>): StorageWriteKey | null {
  return (value.area === 'local' || value.area === 'sync') &&
    typeof value.key === 'string' &&
    !!value.key
    ? { area: value.area, key: value.key }
    : null;
}

function isCloudSyncKind(value: unknown): value is CloudSyncKind {
  return (
    value === 'highlights' ||
    value === 'plugins' ||
    value === 'settings' ||
    value === 'folders' ||
    value === 'hierarchy' ||
    value === 'prompts' ||
    value === 'starred' ||
    value === 'forks' ||
    value === 'outlines'
  );
}

function parseAppliedHashes(value: unknown): CloudSyncAppliedHash[] | null {
  if (!Array.isArray(value)) return null;
  const result: CloudSyncAppliedHash[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isContentHash(entry.hash)) return null;
    // Older slots hashed a later read and cannot prove which value the download wrote.
    if (entry.kind === undefined) continue;
    if (!isCloudSyncKind(entry.kind)) return null;
    const target = parseTarget(entry);
    if (!target) return null;
    const projections: Array<{ projection: string; hash: string }> = [];
    if (entry.projections !== undefined) {
      if (!Array.isArray(entry.projections)) return null;
      for (const item of entry.projections) {
        if (!isRecord(item) || typeof item.projection !== 'string' || !isContentHash(item.hash))
          return null;
        projections.push({ projection: item.projection, hash: item.hash });
      }
    }
    result.push({
      ...target,
      kind: entry.kind,
      hash: entry.hash,
      ...(projections.length ? { projections } : {}),
    });
  }
  return result;
}

function parseUndoMarkers(value: unknown, progress = false): CloudSyncUndoProgressMarker[] | null {
  if (!Array.isArray(value)) return null;
  const markers: CloudSyncUndoProgressMarker[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isContentHash(entry.replacedHash) ||
      (entry.appliedHash !== undefined && !isContentHash(entry.appliedHash)) ||
      (entry.appliedHashes !== undefined &&
        (!Array.isArray(entry.appliedHashes) || !entry.appliedHashes.every(isContentHash))) ||
      (entry.suppressionOnly !== undefined && entry.suppressionOnly !== true) ||
      !Array.isArray(entry.projections)
    )
      return null;
    const target = parseTarget(entry);
    if (!target) return null;
    const identity = JSON.stringify([target.area, target.key]);
    if (seen.has(identity)) return null;
    seen.add(identity);
    const projections: Array<{ projection: string; hashes: string[] }> = [];
    for (const item of entry.projections) {
      if (
        !isRecord(item) ||
        typeof item.projection !== 'string' ||
        !Array.isArray(item.hashes) ||
        !item.hashes.every(isContentHash)
      )
        return null;
      projections.push({ projection: item.projection, hashes: item.hashes });
    }
    markers.push({
      ...target,
      replacedHash: entry.replacedHash,
      ...(typeof entry.appliedHash === 'string' ? { appliedHash: entry.appliedHash } : {}),
      ...(Array.isArray(entry.appliedHashes) ? { appliedHashes: entry.appliedHashes } : {}),
      ...(progress && entry.suppressionOnly === true ? { suppressionOnly: true as const } : {}),
      projections,
    });
  }
  return markers;
}

export function parseCloudSyncSnapshotSlot(value: unknown): CloudSyncSnapshotSlot | null {
  if (isRecord(value) && value.kind === 'undone') {
    const markers = parseUndoMarkers(value.markers);
    return markers ? { kind: 'undone', markers } : null;
  }
  return parseCloudSyncSnapshot(value);
}
