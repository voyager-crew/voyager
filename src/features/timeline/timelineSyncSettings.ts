import { StorageKeys } from '@/core/types/common';

import type { TimelineSettingField } from './timelineSettings';
import type { ExtGlobal, SyncSettingsListener, TimelinePositionData } from './types';

/** Sync fields that are behaviour knobs; width and position belong to rail placement. */
export const TIMELINE_SETTING_KNOBS: readonly TimelineSettingField[] = [
  'ScrollMode',
  'Style',
  'HideContainer',
  'Draggable',
  'MarkerLevel',
  'PreviewPinned',
];

export interface TimelineSyncSettingsHandlers {
  readonly settingKey: (field: TimelineSettingField) => string;
  /** The changed knob values, keyed by their sync keys. */
  readonly onKnobs: (changed: Record<string, unknown>) => void;
  readonly onWidth: (value: unknown) => void;
  readonly onPosition: (value: TimelinePositionData | null) => void;
  readonly onLanguage: (value: string | null | undefined) => void;
}

/**
 * Listen for sync-storage changes from the popup and update settings live.
 * Returns the stop, or null without a storage API. The engine keeps the stop so
 * destroy() removes the listener: a new engine is created on every SPA
 * navigation, and leaked listeners would accumulate and retain detached DOM.
 */
export function watchTimelineSyncSettings(
  handlers: TimelineSyncSettingsHandlers,
): (() => void) | null {
  const g = globalThis as ExtGlobal;
  const onChanged = g.chrome?.storage?.onChanged || g.browser?.storage?.onChanged;
  if (!onChanged) return null;
  const key = handlers.settingKey;
  const listener: SyncSettingsListener = (changes, area) => {
    if (area !== 'sync') return;
    const knobs = TIMELINE_SETTING_KNOBS.filter((field) => changes?.[key(field)]);
    if (knobs.length > 0) {
      const changed: Record<string, unknown> = {};
      for (const field of knobs) changed[key(field)] = changes[key(field)].newValue;
      handlers.onKnobs(changed);
    }
    if (changes?.[key('BarWidth')]) handlers.onWidth(changes[key('BarWidth')].newValue);
    if (changes?.[key('Position')]) {
      handlers.onPosition(changes[key('Position')].newValue as TimelinePositionData | null);
    }
    if (changes?.[StorageKeys.LANGUAGE]) {
      handlers.onLanguage(changes[StorageKeys.LANGUAGE].newValue as string | null | undefined);
    }
  };
  onChanged.addListener(listener);
  return () => {
    try {
      g.chrome?.storage?.onChanged?.removeListener?.(listener);
      g.browser?.storage?.onChanged?.removeListener?.(listener);
    } catch {}
  };
}

/**
 * The site's timeline sync values with their defaults, from the extension's
 * sync storage, or the scroll mode from localStorage without one; null when
 * the read failed.
 */
export async function readTimelineSyncSettings(
  settingKey: (field: TimelineSettingField) => string,
): Promise<Record<string, unknown> | null> {
  const g = globalThis as ExtGlobal;
  const defaults = {
    [settingKey('ScrollMode')]: 'flow',
    [settingKey('Style')]: 'dots',
    [settingKey('HideContainer')]: false,
    [settingKey('BarWidth')]: null,
    [settingKey('Draggable')]: false,
    [settingKey('MarkerLevel')]: false,
    [settingKey('Position')]: null,
    [settingKey('PreviewPinned')]: false,
    [StorageKeys.LANGUAGE]: null,
  };

  let res: Record<string, unknown> | null = null;
  // prefer chrome.storage or browser.storage if available to sync with popup
  if (g.chrome?.storage?.sync || g.browser?.storage?.sync) {
    res = await new Promise((resolve) => {
      if (g.chrome?.storage?.sync?.get) {
        g.chrome.storage.sync.get(
          defaults as Record<string, unknown>,
          (items: Record<string, unknown>) => {
            if (g.chrome.runtime.lastError) {
              console.error(
                `[Timeline] chrome.storage.get failed: ${g.chrome.runtime.lastError.message}`,
              );
              resolve(null);
            } else {
              resolve(items);
            }
          },
        );
      } else {
        g.browser?.storage?.sync
          ?.get(defaults)
          .then(resolve)
          .catch((error: Error) => {
            console.error(`[Timeline] browser.storage.get failed: ${error.message}`);
            resolve(null);
          });
      }
    });
  } else {
    // No extension storage available, try to load critical fallback from localStorage
    const saved = localStorage.getItem(settingKey('ScrollMode'));
    if (saved === 'flow' || saved === 'jump') res = { [settingKey('ScrollMode')]: saved };
  }
  return res;
}
