/**
 * ChatGPT's `FolderCommands`: the shared site commands over `ChatGptFolderStore`,
 * with ChatGPT's folder ids, its stored colour shape and its file import.
 */
import type { EditOutcome, FolderCommands } from '@/features/folder/commands/folderCommands';
import { failed } from '@/features/folder/commands/folderCommands';
import { cloneFolderData } from '@/features/folder/model/folderData';
import { rejected } from '@/features/folder/owner/folderOps';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';
import { createSiteFolderCommands } from '@/pages/content/folder/siteFolderCommands';

import type { ChatGptFolderStore } from './ChatGptFolderStore';
import { importChatGptFolders } from './transfer';

/** ChatGPT's folder ids, `folder_<ms>_<rand9>`. */
function newFolderId(now: number): string {
  return `folder_${now}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createLegacyChatGptCommands(store: ChatGptFolderStore): FolderCommands {
  async function importFile(payload: unknown): Promise<EditOutcome> {
    if (!store.ready) return failed('not_loaded');
    const outcome = await importChatGptFolders(payload, cloneFolderData(store.data));
    if (!outcome.ok) {
      if (outcome.reason === 'failed') return failed('storage_error', outcome.message ?? '');
      const messageKey =
        outcome.reason === 'wrong-site'
          ? 'folder_import_wrong_site'
          : 'folder_import_invalid_format';
      return { kind: 'rejected', reason: 'invalid_payload', messageKey };
    }
    if (!(await store.replaceData(outcome.data))) return failed('storage_error');
    return { kind: 'saved', stats: outcome.stats };
  }

  return createSiteFolderCommands({
    store,
    policy: FOLDER_SITE_POLICIES.chatgpt,
    newFolderId,
    overrides: (applyOp) => ({
      // ChatGPT has always stored a cleared colour as 'default'; keep its records in that shape.
      setFolderColor: ({ folderId, color }) =>
        applyOp({ kind: 'setFolderColor', folderId, color: color ?? 'default' }),
    }),
    // Merge only, as the panel's import does today; ChatGPT has no backups or Drive merge.
    runBulk: (body) =>
      body.kind === 'importFile' && body.strategy === 'merge'
        ? importFile(body.payload)
        : Promise.resolve(rejected('unsupported')),
  });
}
