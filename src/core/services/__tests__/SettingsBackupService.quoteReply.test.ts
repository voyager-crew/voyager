import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import {
  loadLegacySettingSnapshot,
  resolveEffectiveEnabled,
} from '@/features/plugins/storage/legacySettingBindings';
import { loadPluginState, restorePluginState } from '@/features/plugins/storage/pluginState';

import {
  exportBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '../SettingsBackupService';

const QUOTE = StorageKeys.QUOTE_REPLY_ENABLED;
const PLUGIN = OFFICIAL_PLUGIN_IDS.geminiQuoteReply;

function memoryArea(state: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string[] | Record<string, unknown>) => {
      const result: Record<string, unknown> = Array.isArray(keys) ? {} : { ...keys };
      for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) {
        if (Object.hasOwn(state, key)) result[key] = state[key];
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    }),
  };
}

function useDevice(sync: Record<string, unknown>) {
  vi.stubGlobal('chrome', {
    ...chrome,
    storage: { ...chrome.storage, sync: memoryArea(sync), local: memoryArea({}) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini quote reply settings backups', () => {
  it.each(['merge', 'overwrite'] as const)(
    'preserves missing and explicit quote choices through %s restores in either file order',
    async (mode) => {
      const cases = [
        { source: undefined, target: undefined, restored: undefined },
        { source: undefined, target: false, restored: false },
        { source: undefined, target: true, restored: true },
        { source: false, target: undefined, restored: false },
        { source: false, target: false, restored: false },
        { source: false, target: true, restored: false },
        { source: true, target: undefined, restored: true },
        { source: true, target: false, restored: true },
        { source: true, target: true, restored: true },
      ];
      for (const { source, target, restored } of cases) {
        const original = {
          [StorageKeys.CHAT_FONT_SIZE]: 120,
          ...(source === undefined ? {} : { [QUOTE]: source }),
        };
        useDevice(original);
        const payload = await exportBackupableSyncSettings();
        expect(payload.data).toEqual(original);
        const settings: unknown = JSON.parse(JSON.stringify(payload.data));

        for (const pluginsFirst of [false, true]) {
          const destination: Record<string, unknown> = {
            [StorageKeys.CHAT_FONT_SIZE]: 100,
            ...(target === undefined ? {} : { [QUOTE]: target }),
          };
          useDevice(destination);
          const plugins = { [PLUGIN]: { enabled: restored !== true, installedAt: 1 } };
          if (pluginsFirst) await restorePluginState(plugins, mode);
          await restoreBackupableSyncSettings(settings, undefined, mode);
          if (!pluginsFirst) await restorePluginState(plugins, mode);

          expect(destination).toEqual({
            [StorageKeys.CHAT_FONT_SIZE]: 120,
            ...(restored === undefined ? {} : { [QUOTE]: restored }),
          });
          const pluginState = await loadPluginState();
          expect(pluginState).toEqual(plugins);
          expect(
            resolveEffectiveEnabled(pluginState, await loadLegacySettingSnapshot(), PLUGIN),
            JSON.stringify({ mode, pluginsFirst, source, target }),
          ).toBe(restored === true);
        }
      }
    },
  );
});
