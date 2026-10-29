import { StorageKeys } from '@/core/types/common';

import { BACKUPABLE_SYNC_SETTINGS_DEFAULTS } from './settingsBackupDefaults';

type SettingsDefaults = typeof BACKUPABLE_SYNC_SETTINGS_DEFAULTS;
type NullDefaultKey = {
  [Key in keyof SettingsDefaults]: SettingsDefaults[Key] extends null ? Key : never;
}[keyof SettingsDefaults];
type ValueCheck = (value: unknown) => boolean;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Null means "no saved choice", not an object type. Keep every nullable key explicit.
const NULL_DEFAULT_VALUE_CHECKS = {
  [StorageKeys.TIMELINE_BAR_WIDTH]: (value) => typeof value === 'number',
  [StorageKeys.TIMELINE_POSITION]: isObject,
  [StorageKeys.PROMPT_THEME]: (value) => typeof value === 'string',
  [StorageKeys.LANGUAGE]: (value) => typeof value === 'string',
  [StorageKeys.WATERMARK_REMOVER_ENABLED]: (value) => typeof value === 'boolean',
  [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: (value) => typeof value === 'boolean',
  [StorageKeys.WATERMARK_PREVIEW_ENABLED]: (value) => typeof value === 'boolean',
  // Both the legacy model name and the newer { id, name, pill? } format remain supported.
  [StorageKeys.DEFAULT_MODEL]: (value) => typeof value === 'string' || isObject(value),
  [StorageKeys.DEFAULT_THINKING_LEVEL]: isObject,
  [StorageKeys.GV_POPUP_SECTION_ORDER]: Array.isArray,
} satisfies Record<NullDefaultKey, ValueCheck>;

export function filterRestorableSyncSettings(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};

  const nullableChecks: Readonly<Record<string, ValueCheck>> = NULL_DEFAULT_VALUE_CHECKS;
  const settings: Record<string, unknown> = {};
  for (const [key, defaultValue] of Object.entries(BACKUPABLE_SYNC_SETTINGS_DEFAULTS)) {
    if (!Object.hasOwn(value, key)) continue;
    const stored = value[key];
    if (stored === null || stored === undefined) continue;
    const matches =
      defaultValue === null
        ? nullableChecks[key](stored)
        : Array.isArray(defaultValue)
          ? Array.isArray(stored)
          : typeof defaultValue === 'object'
            ? isObject(stored)
            : typeof stored === typeof defaultValue;
    if (matches) settings[key] = stored;
  }
  return settings;
}
