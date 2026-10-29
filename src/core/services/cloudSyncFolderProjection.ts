import type { FolderData } from '@/core/types/folder';
import { validateFolderData } from '@/features/folder/model/folderData';
import { FOLDER_SITE_TABLE } from '@/features/folder/sites/folderSiteTable';

import type { StorageWriteKey } from './cloudSyncSnapshotTypes';

/** Exact outputs of the folder owner's deterministic load/save normalization, never fuzzy equality. */
export function folderSnapshotProjectionValues(target: StorageWriteKey, value: unknown) {
  if (target.area !== 'local') return [];
  const row = Object.values(FOLDER_SITE_TABLE).find(
    ({ config }) =>
      target.key === config.storageKey || target.key.startsWith(`${config.storageKey}:acct:`),
  );
  if (!row || !validateFolderData(value)) return [];
  let normalized: FolderData;
  try {
    normalized = row.config.normalize(structuredClone(value) as FolderData);
  } catch {
    // An owner cannot produce a normalized backup from a corrupt value.
    return [];
  }
  const projections = [{ projection: 'folder-normalized', value: normalized }];
  if (row.config.pruneOrphanBuckets) {
    const kept = new Set([...normalized.folders.map(({ id }) => id), row.config.rootBucketId]);
    const loaded = {
      ...normalized,
      folderContents: Object.fromEntries(
        Object.entries(normalized.folderContents).filter(([key]) => kept.has(key)),
      ),
    };
    projections.push({ projection: 'folder-loaded', value: loaded });
  }
  return projections;
}
