import { StorageKeys } from '@/core/types/common';
import type { FolderExportPayload, ImportStrategy } from '@/features/folder/types/import-export';
import { readChatGptFolderExport } from '@/features/plugins/builtin/chatgptFolders/transfer';

/**
 * Sites that own a Voyager folder bucket. Every per-platform storage key, Drive file, sync
 * timestamp and host list is looked up here, so adding a platform does not compile until each
 * one is defined. Any other site (Claude, DeepSeek, custom websites) has no folder
 * bucket: helpers return `null` and callers must skip folder storage, backup and sync.
 */
export type FolderPlatform = 'gemini' | 'aistudio' | 'chatgpt';

export interface FolderPlatformDefinition {
  /** Page hosts whose content scripts own this bucket; the owner and sync trust only these. */
  hosts: readonly string[];
  /** `chrome.storage.local` base key; account isolation appends `:acct:<hash>`. */
  folderStorageKey: string;
  /** `chrome.storage.sync` per-platform account isolation switch. */
  accountIsolationStorageKey: string | null;
  /** Whether folder transfers also carry prompts, settings and plugins. */
  syncsSharedData: boolean;
  /** Tagged files use their site's reader; legacy files retain their unmarked envelope. */
  folderExport: {
    platform: 'chatgpt';
    read: (
      value: unknown,
      strategy?: ImportStrategy,
    ) =>
      | { ok: true; payload: FolderExportPayload }
      | { ok: false; reason: 'invalid' | 'wrong-site'; message?: string };
  } | null;
  driveFoldersFileName: string;
  lastUploadTimeField: 'lastUploadTime' | 'lastUploadTimeAIStudio' | 'lastUploadTimeChatGPT';
  lastSyncTimeField: 'lastSyncTime' | 'lastSyncTimeAIStudio' | 'lastSyncTimeChatGPT';
}

export const FOLDER_PLATFORMS = {
  gemini: {
    hosts: ['gemini.google.com', 'business.gemini.google'],
    folderStorageKey: StorageKeys.FOLDER_DATA,
    accountIsolationStorageKey: StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI,
    syncsSharedData: true,
    folderExport: null,
    driveFoldersFileName: 'gemini-voyager-folders.json',
    lastUploadTimeField: 'lastUploadTime',
    lastSyncTimeField: 'lastSyncTime',
  },
  aistudio: {
    hosts: ['aistudio.google.com', 'aistudio.google.cn'],
    folderStorageKey: StorageKeys.FOLDER_DATA_AISTUDIO,
    accountIsolationStorageKey: StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO,
    syncsSharedData: true,
    folderExport: null,
    driveFoldersFileName: 'gemini-voyager-aistudio-folders.json',
    lastUploadTimeField: 'lastUploadTimeAIStudio',
    lastSyncTimeField: 'lastSyncTimeAIStudio',
  },
  chatgpt: {
    // The canonical host only: `chat.openai.com` redirects here, is not in the optional
    // host permissions, and must not write or sync this bucket. Links read from it still open.
    hosts: ['chatgpt.com'],
    folderStorageKey: StorageKeys.FOLDER_DATA_CHATGPT,
    accountIsolationStorageKey: null,
    syncsSharedData: false,
    folderExport: { platform: 'chatgpt', read: readChatGptFolderExport },
    driveFoldersFileName: 'gemini-voyager-chatgpt-folders.json',
    lastUploadTimeField: 'lastUploadTimeChatGPT',
    lastSyncTimeField: 'lastSyncTimeChatGPT',
  },
} as const satisfies Readonly<Record<FolderPlatform, FolderPlatformDefinition>>;

export type AccountScopedFolderPlatform = {
  [P in FolderPlatform]: (typeof FOLDER_PLATFORMS)[P]['accountIsolationStorageKey'] extends null
    ? never
    : P;
}[FolderPlatform];

export function supportsAccountIsolation(
  platform: FolderPlatform,
): platform is AccountScopedFolderPlatform {
  return FOLDER_PLATFORMS[platform].accountIsolationStorageKey !== null;
}

export const FOLDER_PLATFORM_IDS = Object.keys(FOLDER_PLATFORMS) as FolderPlatform[];

export function isFolderPlatform(value: unknown): value is FolderPlatform {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FOLDER_PLATFORMS, value);
}

/** The folder platform that owns `hostname`, or `null` for every other site. */
export function getFolderPlatformForHost(
  hostname: string | null | undefined,
): FolderPlatform | null {
  if (!hostname) return null;
  const normalized = hostname.toLowerCase();
  return (
    FOLDER_PLATFORM_IDS.find((platform) =>
      FOLDER_PLATFORMS[platform].hosts.some((host) => host === normalized),
    ) ?? null
  );
}
