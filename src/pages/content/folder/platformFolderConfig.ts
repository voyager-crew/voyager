import type { AccountPlatform, AccountScope } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { AISTUDIO_ROOT_BUCKET_ID, ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import {
  cloneFolderData,
  normalizeFolderData,
  ownBucket,
  setBucket,
} from '@/features/folder/model/folderData';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import type { ConversationReference, FolderData } from './types';

/**
 * Everything `FolderRepository` needs to know about one platform's folder bucket.
 * Keys, backup namespaces and root bucket ids are serialized user data: freeze them.
 */
export interface PlatformFolderConfig {
  /**
   * The platform whose account isolation switch applies. `null` is a bucket with no
   * isolation switch (ChatGPT): isolation stays off and nothing falls back to the
   * legacy global switch, so the bucket never becomes account-scoped.
   */
  platform: AccountPlatform | null;
  /** `chrome.storage.local` base key; account isolation appends `:acct:<hash>`. */
  storageKey: string;
  /** DataBackupService namespace for the `gvBackup_<namespace>_*` recovery slots. */
  backupNamespace: string;
  /** Contents bucket kept for conversations outside any folder. Per-platform literal. */
  rootBucketId: string;
  /** `chrome.storage.sync` switches whose change re-reads the isolation setting. */
  isolationSettingKeys: readonly string[];
  /** Selects what an account inherits from the legacy global bucket on first scoped load. */
  migrateLegacyData: (legacy: FolderData, scope: AccountScope | null) => FolderData;
  /** Prefix of persistence log lines. */
  logPrefix: string;
  /** Page `localStorage` key that enables debug logs when set to `'1'`. */
  debugFlag: string;
  /**
   * Repairs data on load, recovery, migration and before each write. A platform
   * that never normalized passes `identity`: `normalizeFolderData` seeds missing
   * `sortIndex` values by name and dedupes refs, which users would see.
   */
  normalize: (data: FolderData) => FolderData;
  /** Drop `folderContents` buckets without a folder, except `rootBucketId`, on load. */
  pruneOrphanBuckets: boolean;
  /** Recover an absent bucket from backup, as for a corrupt one, instead of starting empty. */
  recoverMissingData: boolean;
  /** Write once more when the adapter reports a failed write. */
  retryFailedSave: boolean;
  /** Read the bucket before writing empty data, to log an overwrite of non-empty data. */
  checkEmptyOverwrite: boolean;
}

export function keepFolderData(data: FolderData): FolderData {
  return data;
}

function getUserIdFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/^\/u\/(\d+)\//);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Keeps conversations whose `/u/<N>/` matches the account, plus ones without a route user. */
export function filterLegacyFolderDataByCurrentAccount(
  data: FolderData,
  scope: AccountScope | null,
): FolderData {
  const routeUserId = scope?.routeUserId;
  if (!routeUserId) {
    return cloneFolderData(data);
  }

  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]));
  const visibleFolderIds = new Set<string>();
  const nextContents: Record<string, ConversationReference[]> = {};

  for (const [folderId, conversations] of Object.entries(data.folderContents || {})) {
    const filtered = conversations.filter((conversation) => {
      const conversationUserId = getUserIdFromUrl(conversation.url);
      return conversationUserId === null || conversationUserId === routeUserId;
    });
    if (filtered.length === 0) continue;

    setBucket(
      nextContents,
      folderId,
      filtered.map((conversation) => ({ ...conversation })),
    );
    if (folderId !== ROOT_CONVERSATIONS_ID) {
      visibleFolderIds.add(folderId);
    }
  }

  const stack = [...visibleFolderIds];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) continue;

    const folder = folderById.get(currentId);
    if (!folder?.parentId) continue;
    if (visibleFolderIds.has(folder.parentId)) continue;
    visibleFolderIds.add(folder.parentId);
    stack.push(folder.parentId);
  }

  const folders = data.folders
    .filter((folder) => visibleFolderIds.has(folder.id))
    .map((folder) => ({ ...folder }));

  for (const folder of folders) {
    if (!ownBucket(nextContents, folder.id)) setBucket(nextContents, folder.id, []);
  }

  if (!nextContents[ROOT_CONVERSATIONS_ID]) {
    nextContents[ROOT_CONVERSATIONS_ID] = [];
  }

  return {
    folders,
    folderContents: nextContents,
  };
}

export const GEMINI_FOLDER_CONFIG: PlatformFolderConfig = {
  platform: 'gemini',
  storageKey: FOLDER_PLATFORMS.gemini.folderStorageKey,
  backupNamespace: FOLDER_PLATFORMS.gemini.backupNamespace,
  rootBucketId: ROOT_CONVERSATIONS_ID,
  isolationSettingKeys: [
    StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED,
    FOLDER_PLATFORMS.gemini.accountIsolationStorageKey,
  ],
  migrateLegacyData: filterLegacyFolderDataByCurrentAccount,
  logPrefix: '[FolderStore]',
  debugFlag: 'gvFolderDebug',
  normalize: normalizeFolderData,
  pruneOrphanBuckets: true,
  recoverMissingData: false,
  retryFailedSave: true,
  checkEmptyOverwrite: true,
};

/** AI Studio copies the whole legacy bucket: its prompt URLs carry no `/u/<N>/` owner. */
function copyLegacyFolderData(data: FolderData): FolderData {
  return cloneFolderData(data);
}

/**
 * AI Studio never normalized, pruned or retried a write. `normalize` would seed
 * `sortIndex` by name and dedupe refs, and pruning would drop buckets the old code
 * kept. A missing bucket recovers from backup, as it always has.
 */
export const AISTUDIO_FOLDER_CONFIG: PlatformFolderConfig = {
  platform: 'aistudio',
  storageKey: FOLDER_PLATFORMS.aistudio.folderStorageKey,
  backupNamespace: FOLDER_PLATFORMS.aistudio.backupNamespace,
  rootBucketId: AISTUDIO_ROOT_BUCKET_ID,
  // AIStudioFolderManager's own sync listener handles these switches.
  isolationSettingKeys: [],
  migrateLegacyData: copyLegacyFolderData,
  logPrefix: '[AIStudioFolderManager]',
  debugFlag: 'gvAIStudioFolderDebug',
  normalize: keepFolderData,
  pruneOrphanBuckets: false,
  recoverMissingData: true,
  retryFailedSave: false,
  checkEmptyOverwrite: false,
};
