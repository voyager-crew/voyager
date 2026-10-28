import { validateFolderData } from '@/features/folder/model/folderData';

import { createFolderWriter, type FolderWriter } from './storage/folderWriter';

/**
 * Import the legacy sync bucket at most once for this target. Valid local data
 * is authoritative: missing legacy items may be deletions. Keep the sync bytes
 * untouched for recovery, including when an existing local bucket skips import.
 */
export async function migrateAIStudioLegacySync(
  targetKey: string,
  write: FolderWriter = createFolderWriter(),
): Promise<void> {
  const markerKey = `${targetKey}:legacySyncImported`;
  const migrate = async () => {
    const local = await chrome.storage.local.get([targetKey, markerKey]);
    if (local[markerKey] === true) return;
    if (!validateFolderData(local[targetKey])) {
      const sync = await chrome.storage.sync.get(targetKey);
      if (!validateFolderData(sync[targetKey])) return;
      // A different tab may have saved or deleted items while sync was read.
      const latest = await chrome.storage.local.get([targetKey, markerKey]);
      if (latest[markerKey] === true) return;
      if (!validateFolderData(latest[targetKey])) {
        await write(targetKey, () => chrome.storage.local.set({ [targetKey]: sync[targetKey] }));
      }
    }
    // Separate from the data write: never mark a failed import as complete.
    await write(targetKey, () => chrome.storage.local.set({ [markerKey]: true }));
  };
  // ponytail: Web Locks serialize per origin; cross-origin writers need a background owner.
  if (navigator.locks?.request) await navigator.locks.request(markerKey, migrate);
  else await migrate();
}
