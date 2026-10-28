import type { FolderData } from '@/core/types/folder';

import { FolderImportExportService } from '../services/FolderImportExportService';
import type { ImportResult } from '../types/import-export';
import {
  cloneFolderData,
  cutFolderCycles,
  findInheritedFolderKey,
  findRepeatedFolderId,
  ownBucket,
  setBucket,
} from './folderData';

export type AIStudioImportFile =
  | { ok: true; data: FolderData }
  | { ok: false; messageKey: 'folder_import_wrong_site' | 'folder_import_invalid_format' };

/**
 * Read the folders from a parsed AI Studio folder file (`{ data }` or the bare
 * data). A file another site marked as its own, as ChatGPT marks its exports,
 * holds conversations AI Studio cannot open, so it is refused whatever its shape.
 */
export function readAIStudioImportFile(json: unknown): AIStudioImportFile {
  if (FolderImportExportService.exportedPlatform(json) !== null) {
    return { ok: false, messageKey: 'folder_import_wrong_site' };
  }
  const file = json && typeof json === 'object' ? (json as { data?: unknown }) : null;
  const next = (file && (file.data || file)) as FolderData | null;
  if (
    !next ||
    !Array.isArray(next.folders) ||
    typeof next.folderContents !== 'object' ||
    (next.folderContents && findInheritedFolderKey(next.folders, next.folderContents) !== null) ||
    findRepeatedFolderId(next.folders) !== null
  ) {
    return { ok: false, messageKey: 'folder_import_invalid_format' };
  }
  return { ok: true, data: { ...next, folders: cutFolderCycles(next.folders) } };
}

/**
 * Merge an imported AI Studio file into a copy of the current data: imported
 * folders are appended, and only their buckets are read, so the file's
 * Uncategorized and orphan buckets are ignored. A new folder's bucket replaces
 * any orphan bucket left under its id; an existing folder gains the prompts it
 * lacks. The stats count what the merge added.
 */
export function mergeAIStudioImport(
  current: FolderData,
  file: FolderData,
): { data: FolderData; stats: ImportResult } {
  const existing = cloneFolderData(current);
  const existingIds = new Set(existing.folders.map((folder) => folder.id));
  const imported: FolderData = { folders: file.folders, folderContents: {} };
  for (const folder of file.folders) {
    if (!existingIds.has(folder.id)) delete existing.folderContents[folder.id];
    setBucket(imported.folderContents, folder.id, ownBucket(file.folderContents, folder.id) ?? []);
  }
  const { merged, stats } = FolderImportExportService.mergeData(existing, imported);
  return { data: merged, stats };
}
