/**
 * No backup, Drive upload or restore carries or touches which scripted
 * plugins run on this device.
 */
import { describe, expect, it } from 'vitest';

import {
  exportBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '@/core/services/SettingsBackupService';
import { StorageKeys } from '@/core/types/common';
import { readPluginStateForSync } from '@/pages/background/cloudSyncLocalData';

import { saveLocalPluginRecord } from '../../local/localPluginStore';
import { restorePluginState } from '../../storage/pluginState';
import { enableScriptedIfUnchanged, readScriptedPlugin } from '../state';
import { SCRIPTED_ID, storedScripted } from './fixtures';
import { installMemoryLocal } from './memoryLocal';

const SCRIPTED = StorageKeys.PLUGIN_SCRIPTED_STATE;
const STATE = StorageKeys.PLUGINS_STATE;

const storage = installMemoryLocal();

async function enabledScriptedDevice(): Promise<unknown> {
  const manifest = storedScripted();
  await saveLocalPluginRecord(manifest, 1);
  const plugin = await readScriptedPlugin(manifest);
  if (!plugin || (await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash)) !== 'enabled') {
    throw new Error('fixture must enable');
  }
  storage.memory[STATE] = {
    ...(storage.memory[STATE] as Record<string, unknown>),
    'voyager.formula-copy': { enabled: true, installedAt: 1 },
  };
  return structuredClone(storage.memory[SCRIPTED]);
}

function memoryArea(memory: Record<string, unknown>) {
  return {
    get: async () => structuredClone(memory),
    set: async (items: Record<string, unknown>) => {
      Object.assign(memory, items);
    },
  };
}

describe('backups and the scripted enable state', () => {
  it('never puts it in the plugin-state Drive upload', async () => {
    await enabledScriptedDevice();
    const upload = await readPluginStateForSync(structuredClone(storage.memory));
    const text = JSON.stringify(upload);
    expect(text).not.toContain(SCRIPTED);
    expect(text).not.toContain('reviewHash');
    expect(upload[SCRIPTED_ID]?.enabled).toBe(false);
    expect(upload['voyager.formula-copy']?.enabled).toBe(true);
  });

  it('never puts it in the settings file, even from an area that holds it', async () => {
    const reviewed = await enabledScriptedDevice();
    const exported = await exportBackupableSyncSettings(memoryArea({ [SCRIPTED]: reviewed }));
    expect(exported.data).not.toHaveProperty(SCRIPTED);
  });

  it.each(['merge', 'overwrite'] as const)(
    'leaves it untouched on a %s restore that tries to switch a scripted plugin on',
    async (mode) => {
      const reviewed = await enabledScriptedDevice();
      const cloud = {
        [SCRIPTED_ID]: { enabled: true, installedAt: 1 },
        [SCRIPTED]: { enabled: true, installedAt: 1 },
      };

      await restorePluginState(cloud, mode);

      expect(storage.memory[SCRIPTED]).toEqual(reviewed);
      const state = storage.memory[STATE] as Record<string, { enabled: boolean }>;
      expect(state[SCRIPTED_ID].enabled).toBe(false);
      expect(storage.writes.at(-1)).not.toHaveProperty(SCRIPTED);
    },
  );

  it.each(['merge', 'overwrite'] as const)('ignores it in a %s settings restore', async (mode) => {
    const reviewed = await enabledScriptedDevice();
    const sync: Record<string, unknown> = {};
    const restored = await restoreBackupableSyncSettings(
      { [SCRIPTED]: { version: 1, stopped: true, enabled: {}, crashNotices: {} } },
      memoryArea(sync),
      mode,
    );
    expect(restored).not.toHaveProperty(SCRIPTED);
    expect(sync).not.toHaveProperty(SCRIPTED);
    expect(storage.memory[SCRIPTED]).toEqual(reviewed);
  });
});
