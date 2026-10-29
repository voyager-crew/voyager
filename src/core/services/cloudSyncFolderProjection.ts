import type { FolderData } from '@/core/types/folder';
import { hashValue } from '@/core/utils/canonicalHash';
import { validateFolderData } from '@/features/folder/model/folderData';
import { FOLDER_SITE_TABLE } from '@/features/folder/sites/folderSiteTable';

import type { StorageWriteKey } from './cloudSyncSnapshotTypes';

/** Exact outputs of the folder owner's deterministic load/save normalization, never fuzzy equality. */
export async function folderSnapshotProjections(target: StorageWriteKey, value: unknown) {
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
  const projections = [{ projection: 'folder-normalized', hash: await hashValue(normalized) }];
  if (row.config.pruneOrphanBuckets) {
    const kept = new Set([...normalized.folders.map(({ id }) => id), row.config.rootBucketId]);
    const loaded = {
      ...normalized,
      folderContents: Object.fromEntries(
        Object.entries(normalized.folderContents).filter(([key]) => kept.has(key)),
      ),
    };
    projections.push({ projection: 'folder-loaded', hash: await hashValue(loaded) });
  }
  return projections;
}
