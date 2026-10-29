import { StorageKeys } from '@/core/types/common';
import type { SettingsExportPayload } from '@/core/types/sync';
import { EXTENSION_VERSION } from '@/core/utils/version';

import { BACKUPABLE_SYNC_SETTINGS_DEFAULTS } from './settingsBackupDefaults';
import { filterRestorableSyncSettings } from './settingsBackupValidation';

export { BACKUPABLE_SYNC_SETTINGS_DEFAULTS } from './settingsBackupDefaults';
export {
  NON_SETTINGS_BACKUP_POLICIES,
  type NonSettingsBackupDisposition,
  type NonSettingsBackupPolicy,
} from './settingsBackupPolicies';

export type BackupableSyncSettings = Record<string, unknown>;
export type SettingsRestoreMode = 'merge' | 'overwrite';

type StorageAreaLike = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

export const BACKUPABLE_SYNC_SETTINGS_KEYS = Object.keys(BACKUPABLE_SYNC_SETTINGS_DEFAULTS);

function getStorageArea(storageArea?: StorageAreaLike): StorageAreaLike {
  if (storageArea) {
    return storageArea;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    return chrome.storage.sync;
  }

  return {
    get: async (keys?: unknown) =>
      typeof keys === 'object' && keys !== null && !Array.isArray(keys)
        ? (keys as Record<string, unknown>)
        : {},
    set: async () => undefined,
  } as StorageAreaLike;
}

export function filterBackupableSyncSettings(value: unknown): BackupableSyncSettings {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const settings = BACKUPABLE_SYNC_SETTINGS_KEYS.reduce<BackupableSyncSettings>((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      acc[key] = record[key];
    }
    return acc;
  }, {});

  if (Object.prototype.hasOwnProperty.call(settings, StorageKeys.TAB_TITLE_UPDATE_ENABLED)) {
    settings[StorageKeys.TAB_TITLE_UPDATE_ENABLED] = false;
  }

  return settings;
}

export async function loadBackupableSyncSettings(
  storageArea?: StorageAreaLike,
): Promise<BackupableSyncSettings> {
  const area = getStorageArea(storageArea);
  const snapshot: unknown = await area.get(BACKUPABLE_SYNC_SETTINGS_KEYS);
  // Missing switches must stay missing so their resolvers still derive from the stored inputs.
  return filterBackupableSyncSettings(snapshot);
}

export async function exportBackupableSyncSettings(
  storageArea?: StorageAreaLike,
): Promise<SettingsExportPayload> {
  return {
    format: 'gemini-voyager.settings.v1',
    exportedAt: new Date().toISOString(),
    version: EXTENSION_VERSION,
    data: await loadBackupableSyncSettings(storageArea),
  };
}

export async function restoreBackupableSyncSettings(
  settings: unknown,
  storageArea?: StorageAreaLike,
  mode: SettingsRestoreMode = 'overwrite',
  beforeWrite?: (values: Readonly<BackupableSyncSettings>) => Promise<void>,
): Promise<BackupableSyncSettings> {
  // Validate before normalizing retired switches, which could otherwise turn invalid input into false.
  const filtered = filterBackupableSyncSettings(filterRestorableSyncSettings(settings));
  if (Object.keys(filtered).length === 0) {
    return filtered;
  }

  const area = getStorageArea(storageArea);
  if (mode === 'merge') {
    const current = await area.get({
      [StorageKeys.COACHMARKS_SEEN]: [],
      [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN]: false,
      [StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO]: false,
    });
    if (Object.prototype.hasOwnProperty.call(filtered, StorageKeys.COACHMARKS_SEEN)) {
      const cloudSeenRaw = filtered[StorageKeys.COACHMARKS_SEEN];
      const localSeenRaw = current[StorageKeys.COACHMARKS_SEEN];
      const cloudSeen = Array.isArray(cloudSeenRaw)
        ? cloudSeenRaw.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const localSeen = Array.isArray(localSeenRaw)
        ? localSeenRaw.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      filtered[StorageKeys.COACHMARKS_SEEN] = [...new Set([...localSeen, ...cloudSeen])];
    }
    if (
      Object.prototype.hasOwnProperty.call(filtered, StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN)
    ) {
      filtered[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN] =
        current[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN] === true ||
        filtered[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN] === true;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        filtered,
        StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO,
      )
    ) {
      filtered[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO] =
        current[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO] === true ||
        filtered[StorageKeys.FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO] === true;
    }
  }
  if (beforeWrite) await beforeWrite(filtered);
  await area.set(filtered);
  return filtered;
}
