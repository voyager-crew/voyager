import { StorageKeys } from '@/core/types/common';

/**
 * Whether Gemini highlights go with cloud sync: on unless turned off. A failed
 * read answers off, so highlights the person may have kept out are never uploaded.
 */
export async function readHighlightCloudSyncEnabled(): Promise<boolean> {
  try {
    const stored: Record<string, unknown> = await chrome.storage.local.get({
      [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: true,
    });
    return stored[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] !== false;
  } catch {
    return false;
  }
}
