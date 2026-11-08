import { logger } from '@/core/services/LoggerService';

/** Auto sync is deprecated: switch a legacy "auto" sync mode to "manual". */
export async function migrateLegacySyncMode(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('gvSyncMode');
    if (result.gvSyncMode === 'auto') {
      logger.info('[FolderManager] Migrating legacy "auto" sync mode to "manual"');
      await chrome.storage.local.set({ gvSyncMode: 'manual' });
    }
  } catch (error) {
    console.error('[FolderManager] Migration failed:', error);
  }
}
