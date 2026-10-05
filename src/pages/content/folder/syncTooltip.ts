/**
 * The cloud upload/sync button tooltips, shared by every folder site: each
 * reads its own platform's last-run time from the background's sync state.
 */
import browser from 'webextension-polyfill';

import { FOLDER_PLATFORMS, type FolderPlatform } from '@/features/folder/platforms';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

/** "5 minutes ago" and the like; older than yesterday shows the date. */
export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return `${minutes} ${t('minutesAgo')}`;
  if (hours < 24) return `${hours} ${t('hoursAgo')}`;
  if (days === 1) return t('yesterday');
  return new Date(timestamp).toLocaleDateString();
}

const TOOLTIPS = {
  upload: {
    field: 'lastUploadTimeField',
    base: 'folder_cloud_upload',
    last: 'lastUploaded',
    never: 'neverUploaded',
  },
  sync: {
    field: 'lastSyncTimeField',
    base: 'folder_cloud_sync',
    last: 'lastSynced',
    never: 'neverSynced',
  },
} as const;

export type SyncTooltipKind = keyof typeof TOOLTIPS;

/** The button's label, plus this platform's last run time when the background knows it. */
export async function readSyncTooltip(
  platform: FolderPlatform,
  kind: SyncTooltipKind,
): Promise<string> {
  const keys = TOOLTIPS[kind];
  const base = t(keys.base);
  try {
    const response = (await browser.runtime.sendMessage({ type: 'gv.sync.getState' })) as
      | { ok?: boolean; state?: Partial<Record<string, number | null>> }
      | undefined;
    if (response?.ok && response.state) {
      // Each platform keeps its own times; reading another's shows the wrong site's sync.
      const time = response.state[FOLDER_PLATFORMS[platform][keys.field]] ?? null;
      return time
        ? `${base}\n${t(keys.last).replace('{time}', formatRelativeTime(time))}`
        : `${base}\n${t(keys.never)}`;
    }
  } catch (error) {
    console.warn('[FolderSync] Failed to get sync state for tooltip:', error);
  }
  return base;
}
