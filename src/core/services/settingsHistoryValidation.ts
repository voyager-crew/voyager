import { StorageKeys } from '@/core/types/common';

import { BACKUPABLE_SYNC_SETTINGS_DEFAULTS } from './settingsBackupDefaults';
import { filterRestorableSyncSettings } from './settingsBackupValidation';

/** Old exporters included these device-local choices; restoring their raw file is safe. */
const legacyChecks: Readonly<Record<string, (value: unknown) => boolean>> = {
  [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: (value) => typeof value === 'boolean',
  [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: (value) =>
    value === null || typeof value === 'boolean',
  [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: (value) =>
    value === null || typeof value === 'boolean',
  [StorageKeys.PROMPT_PANEL_LOCKED]: (value) => typeof value === 'boolean',
  [StorageKeys.PROMPT_PANEL_POSITION]: isNullableObject,
  [StorageKeys.PROMPT_TRIGGER_POSITION]: isNullableObject,
};

function isNullableObject(value: unknown): boolean {
  return value === null || (typeof value === 'object' && !Array.isArray(value));
}

export function isRecognizedSettingsHistory(data: Record<string, unknown>): boolean {
  const restorable = filterRestorableSyncSettings(data);
  const defaults: Readonly<Record<string, unknown>> = BACKUPABLE_SYNC_SETTINGS_DEFAULTS;
  // Null defaults and retired fields are intentionally ignored during apply, not corrupt media.
  if (
    !Object.entries(data).every(
      ([key, value]) =>
        Object.hasOwn(restorable, key) ||
        (Object.hasOwn(defaults, key) && defaults[key] === null && value === null) ||
        (Object.hasOwn(legacyChecks, key) && legacyChecks[key](value)),
    )
  )
    return false;
  const seen = data[StorageKeys.COACHMARKS_SEEN];
  return (
    seen === undefined ||
    (Array.isArray(seen) &&
      seen.every((id) => typeof id === 'string') &&
      new Set(seen).size === seen.length)
  );
}
