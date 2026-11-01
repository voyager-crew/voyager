import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';

interface MigrationStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The 2.3.1 reset runs once per device, independently of backup/Drive restores. */
export async function migrateGeminiQuoteReplyDefault(
  storage: { sync: MigrationStorageArea; local: MigrationStorageArea } = chrome.storage,
): Promise<void> {
  try {
    const local = await storage.local.get(StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED);
    if (local[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED] === true) return;

    const sync = await storage.sync.get(StorageKeys.QUOTE_REPLY_ENABLED);
    const enabled = sync[StorageKeys.QUOTE_REPLY_ENABLED];
    // Old backups wrote default true even without a user choice; Gemini now has native quotes.
    // Missing already means off, so fresh installs need only the local completion receipt.
    if (enabled !== undefined && enabled !== false) {
      await storage.sync.set({ [StorageKeys.QUOTE_REPLY_ENABLED]: false });
    }

    // There is no transaction across sync/local. Mark only after closing succeeds:
    // a failed close cannot suppress a retry. A failed marker write (or worker exit
    // between writes) leaves the migration incomplete and retryable on next startup.
    await storage.local.set({ [StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]: true });
  } catch (error) {
    logger.warn('Failed to migrate the Gemini quote reply default', { error });
  }
}
