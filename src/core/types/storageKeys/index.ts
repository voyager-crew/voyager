import { APP_STORAGE_KEYS } from './appKeys';
import { APPEARANCE_STORAGE_KEYS } from './appearanceKeys';
import { COMPOSER_STORAGE_KEYS } from './composerKeys';
import { CONVERSATION_STORAGE_KEYS } from './conversationKeys';
import { FOLDER_STORAGE_KEYS } from './folderKeys';
import { PLUGIN_STORAGE_KEYS } from './pluginKeys';
import { SYNC_STORAGE_KEYS } from './syncKeys';

/**
 * Storage keys - centralized for type safety
 *
 * Each domain group is an import-free `as const` object; a spread silently
 * overwrites a duplicate property, so `__tests__/storageKeys.test.ts` pins the
 * key count, unique values and the literal `StorageKey` union.
 */
export const StorageKeys = {
  ...FOLDER_STORAGE_KEYS,
  ...CONVERSATION_STORAGE_KEYS,
  ...APPEARANCE_STORAGE_KEYS,
  ...COMPOSER_STORAGE_KEYS,
  ...APP_STORAGE_KEYS,
  ...PLUGIN_STORAGE_KEYS,
  ...SYNC_STORAGE_KEYS,
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
