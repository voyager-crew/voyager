import { canonicalJson } from '@/core/utils/canonicalHash';
import {
  FOLDER_PLATFORM_IDS,
  FOLDER_PLATFORMS,
  supportsAccountIsolation,
} from '@/features/folder/platforms';

import { folderSnapshotProjectionValues } from './cloudSyncFolderProjection';
import { cloudSyncContent, hashCloudSyncContent } from './cloudSyncSnapshotHash';
import type { CloudSyncUndoMarker, StorageWriteKey } from './cloudSyncSnapshotTypes';
import { dataBackupKey, parseDataBackupKey } from './dataBackupKeys';

const DATA_SLOTS = ['primary', 'emergency', 'beforeUnload'] as const;

/** Account suffixes must name the same physical bucket as the recovery namespace. */
function accountSuffix(value: string, base: string): string | null {
  if (value === base) return '';
  const suffix = value.slice(base.length);
  return value.startsWith(base) && /^:acct:[0-9a-z]{1,7}$/.test(suffix) ? suffix : null;
}

export function folderTargetForBackup(key: string): StorageWriteKey | null {
  const parsed = parseDataBackupKey(key);
  if (!parsed || parsed.slot === 'metadata') return null;
  for (const platform of FOLDER_PLATFORM_IDS) {
    const definition = FOLDER_PLATFORMS[platform];
    const suffix = accountSuffix(parsed.namespace, definition.backupNamespace);
    if (suffix !== null && (!suffix || supportsAccountIsolation(platform)))
      return { area: 'local', key: `${definition.folderStorageKey}${suffix}` };
  }
  return null;
}

export function folderBackupKeysForMarkers(markers: readonly CloudSyncUndoMarker[]): string[] {
  const keys = new Set<string>();
  for (const marker of markers) {
    if (marker.area !== 'local') continue;
    for (const platform of FOLDER_PLATFORM_IDS) {
      const definition = FOLDER_PLATFORMS[platform];
      const suffix = accountSuffix(marker.key, definition.folderStorageKey);
      if (suffix === null || (suffix && !supportsAccountIsolation(platform))) continue;
      for (const slot of DATA_SLOTS)
        keys.add(dataBackupKey(`${definition.backupNamespace}${suffix}`, slot));
    }
  }
  return [...keys];
}

/** Metadata and unknown envelopes are not folder content and are never deleted by Undo. */
export async function hashBackupData(serialized: string): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null || !('data' in value)) return null;
    return hashCloudSyncContent(value.data);
  } catch {
    return null;
  }
}

/** Current canonical data always remains backupable, even if older suppression named its hash. */
export function backupMatchesCanonical(
  serialized: string,
  canonical: unknown,
  target: StorageWriteKey,
): boolean {
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null || !('data' in value)) return false;
    const content = cloudSyncContent(canonical);
    const copy = canonicalJson(cloudSyncContent(value.data));
    return [
      content,
      ...folderSnapshotProjectionValues(target, content).map(({ value }) => value),
    ].some((candidate) => canonicalJson(candidate) === copy);
  } catch {
    return false;
  }
}
