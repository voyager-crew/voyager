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

type SyncTimes = Partial<Record<string, number | null>>;

/** The background's sync state, or null when it cannot be read. */
async function readSyncTimes(): Promise<SyncTimes | null> {
  try {
    const response = (await browser.runtime.sendMessage({ type: 'gv.sync.getState' })) as
      | { ok?: boolean; state?: SyncTimes }
      | undefined;
    if (response?.ok && response.state) return response.state;
  } catch (error) {
    console.warn('[FolderSync] Failed to get sync state for tooltip:', error);
  }
  return null;
}

/** "Last synced: 5 minutes ago", or "Never synced", for this platform. */
function lastRunLine(state: SyncTimes, platform: FolderPlatform, kind: SyncTooltipKind): string {
  const keys = TOOLTIPS[kind];
  // Each platform keeps its own times; reading another's shows the wrong site's sync.
  const time = state[FOLDER_PLATFORMS[platform][keys.field]] ?? null;
  return time ? t(keys.last).replace('{time}', formatRelativeTime(time)) : t(keys.never);
}

/** The button's label, plus this platform's last run time when the background knows it. */
export async function readSyncTooltip(
  platform: FolderPlatform,
  kind: SyncTooltipKind,
): Promise<string> {
  const base = t(TOOLTIPS[kind].base);
  const state = await readSyncTimes();
  return state ? `${base}\n${lastRunLine(state, platform, kind)}` : base;
}

/** The merged cloud button's label, plus this platform's last upload and sync times. */
export async function readCloudTooltip(platform: FolderPlatform): Promise<string> {
  const base = t('folder_cloud');
  const state = await readSyncTimes();
  if (!state) return base;
  return [base, lastRunLine(state, platform, 'upload'), lastRunLine(state, platform, 'sync')].join(
    '\n',
  );
}
