import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope, SyncProvider } from '@/core/types/sync';
import { hashValue } from '@/core/utils/canonicalHash';

import { isEmptySyncFileContent } from './cloudSyncEmptyContent';

export interface DriveFileMetadata {
  id: string;
  md5Checksum: string;
  modifiedTime: string;
}

export class DriveMetadataError extends Error {
  constructor() {
    super('invalid_drive_metadata');
  }
}

export interface SyncFileBaseline extends DriveFileMetadata {
  provider: SyncProvider;
  name: string;
  contentHash: string;
  /** Local projection can differ from the uploaded merge/legacy compatibility copy. */
  localContentHash?: string;
  syncedAt: number;
  /** A legacy source was applied to this exact email-named target. */
  legacyMergedInto?: string;
}

export interface SyncReadFile extends DriveFileMetadata {
  provider: SyncProvider;
  name: string;
  /** iCloud legacy receipts use md5Checksum = sha256:<hex> and an inert epoch modifiedTime. */
  legacyMergedInto?: string;
}

export interface SyncStatusFileRequest {
  row: string;
  name: string;
  accountScope?: SyncAccountScope | null;
  content: unknown;
}

export interface SyncFileStatus {
  row: string;
  name: string;
  status: 'synced' | 'newer_here' | 'newer_in_cloud' | 'not_uploaded' | 'to_merge';
  localChanged: boolean;
  cloudChanged: boolean;
  metadata: DriveFileMetadata | null;
  syncedAt: number | null;
}

export function parseDriveFileMetadata(value: unknown): DriveFileMetadata {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    !('md5Checksum' in value) ||
    typeof value.md5Checksum !== 'string' ||
    !value.md5Checksum ||
    !('modifiedTime' in value) ||
    typeof value.modifiedTime !== 'string' ||
    !Number.isFinite(Date.parse(value.modifiedTime))
  )
    throw new DriveMetadataError();
  return { id: value.id, md5Checksum: value.md5Checksum, modifiedTime: value.modifiedTime };
}

/** Export timestamps/version describe the envelope, not the user's content. */
export function hashSyncFileContent(value: unknown): Promise<string> {
  if (value && typeof value === 'object' && 'format' in value) {
    if (value.format === 'gemini-voyager.stars.v2' && 'items' in value && 'tombstones' in value)
      return hashValue({ items: value.items, tombstones: value.tombstones });
    if (
      value.format === 'gemini-voyager.annotations.v1' &&
      'items' in value &&
      Array.isArray(value.items)
    ) {
      const items = value.items.map((item: unknown) =>
        item && typeof item === 'object'
          ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'accountHash'))
          : item,
      );
      return hashValue({
        items,
        clearMarker: 'clearMarker' in value ? (value.clearMarker ?? null) : null,
      });
    }
    if ('items' in value) return hashValue(value.items);
    if ('data' in value) return hashValue(value.data);
  }
  return hashValue(value);
}

function baselineKey(file: Pick<SyncFileBaseline, 'provider' | 'name' | 'id'>): string {
  // Drive ids are global: changing the connected account must not replace its old baseline.
  return JSON.stringify([file.provider, file.id, file.name]);
}

export async function readSyncBookkeeping(): Promise<Record<string, SyncFileBaseline>> {
  const values = await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_BOOKKEEPING);
  const raw: unknown = values[StorageKeys.CLOUD_SYNC_BOOKKEEPING];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const parsed: Record<string, SyncFileBaseline> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      !value ||
      typeof value !== 'object' ||
      !('provider' in value) ||
      (value.provider !== 'googleDrive' && value.provider !== 'icloud') ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('contentHash' in value) ||
      typeof value.contentHash !== 'string' ||
      !('syncedAt' in value) ||
      typeof value.syncedAt !== 'number' ||
      !Number.isFinite(value.syncedAt)
    )
      continue;
    try {
      parsed[key] = {
        ...parseDriveFileMetadata(value),
        provider: value.provider,
        name: value.name,
        contentHash: value.contentHash,
        ...('localContentHash' in value && typeof value.localContentHash === 'string'
          ? { localContentHash: value.localContentHash }
          : {}),
        syncedAt: value.syncedAt,
        ...('legacyMergedInto' in value && typeof value.legacyMergedInto === 'string'
          ? { legacyMergedInto: value.legacyMergedInto }
          : {}),
      };
    } catch {
      /* A corrupt device-local baseline cannot establish that a file is synced. */
    }
  }
  return parsed;
}

/** The caller commits once, after the complete operation has succeeded. */
export async function commitSyncBookkeeping(files: readonly SyncFileBaseline[]): Promise<void> {
  if (!files.length) return;
  const current = await readSyncBookkeeping();
  for (const file of files) current[baselineKey(file)] = file;
  await chrome.storage.local.set({ [StorageKeys.CLOUD_SYNC_BOOKKEEPING]: current });
}

export function classifySyncFile(input: {
  request: SyncStatusFileRequest;
  name: string;
  provider: SyncProvider;
  contentHash: string;
  metadata: DriveFileMetadata | null;
  baselines: Record<string, SyncFileBaseline>;
}): SyncFileStatus {
  // No data on either side is a settled row, even before its first upload.
  const nothingPending =
    !input.metadata && isEmptySyncFileContent(input.request.name, input.request.content);
  const baseline = input.metadata
    ? input.baselines[
        baselineKey({ provider: input.provider, name: input.name, id: input.metadata.id })
      ]
    : undefined;
  const localChanged = baseline
    ? (baseline.localContentHash ?? baseline.contentHash) !== input.contentHash
    : !nothingPending;
  const cloudChanged =
    !!input.metadata &&
    (!baseline ||
      baseline.id !== input.metadata.id ||
      baseline.md5Checksum !== input.metadata.md5Checksum ||
      baseline.modifiedTime !== input.metadata.modifiedTime);
  return {
    row: input.request.row,
    name: input.name,
    metadata: input.metadata,
    status: !input.metadata
      ? nothingPending
        ? 'synced'
        : 'not_uploaded'
      : !baseline
        ? 'to_merge'
        : cloudChanged
          ? 'newer_in_cloud'
          : localChanged
            ? 'newer_here'
            : 'synced',
    localChanged,
    cloudChanged,
    syncedAt: baseline?.syncedAt ?? null,
  };
}
