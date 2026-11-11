import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { LocalPluginSource } from '../../local/LocalPluginSource';
import {
  enableLocalPluginIfUnchanged,
  loadLocalPluginRecords,
  removeLocalPluginRecord,
  saveLocalPluginRecord,
} from '../../local/localPluginStore';
import { validateLocalManifest } from '../../local/validateLocalManifest';
import { EMPTY_SCRIPTED_STATE, parseScriptedState } from '../parseState';
import {
  disableScripted,
  enableScriptedIfUnchanged,
  loadScriptedState,
  readScriptedPlugin,
  scriptedRunState,
  setScriptedStopped,
} from '../state';
import type { ScriptHash, ScriptedPlugin, UserScriptsAvailability } from '../types';
import { SCRIPTED_ID, storedScripted } from './fixtures';
import { installMemoryLocal } from './memoryLocal';

const SCRIPTED = StorageKeys.PLUGIN_SCRIPTED_STATE;
const STATE = StorageKeys.PLUGINS_STATE;
const AVAILABLE: UserScriptsAvailability = { kind: 'available' };
const HASH = 'a'.repeat(64);

const storage = installMemoryLocal();

async function install(source?: string, extra?: Record<string, unknown>): Promise<ScriptedPlugin> {
  const manifest = storedScripted(source, extra);
  await saveLocalPluginRecord(manifest, 1);
  const plugin = await readScriptedPlugin(manifest);
  if (!plugin) throw new Error('fixture must pass the scripted gate');
  return plugin;
}

async function runState(): Promise<string> {
  const record = (await loadLocalPluginRecords())[SCRIPTED_ID];
  const plugin = record ? await readScriptedPlugin(record.manifest) : undefined;
  if (!plugin) return 'gone';
  const state = scriptedRunState(plugin, await loadScriptedState(), AVAILABLE);
  return state.kind === 'paused' ? `paused:${state.reason}` : state.kind;
}

describe('parseScriptedState', () => {
  it.each([undefined, null, 'on', 42, [], {}, { version: 2, stopped: true }, { version: '1' }])(
    'reads %j as the empty state, which runs nothing',
    (value) => {
      expect(parseScriptedState(value)).toEqual(EMPTY_SCRIPTED_STATE);
    },
  );

  it('keeps only well-formed entries of local plugins', () => {
    const parsed = parseScriptedState({
      version: 1,
      stopped: 'yes',
      enabled: {
        [SCRIPTED_ID]: { reviewHash: HASH, enabledAt: 5 },
        'local.bad-hash': { reviewHash: 'abc', enabledAt: 5 },
        'local.no-time': { reviewHash: HASH },
        'voyager.official': { reviewHash: HASH, enabledAt: 5 },
        ['__proto__']: { reviewHash: HASH, enabledAt: 5 },
      },
      crashNotices: {
        [SCRIPTED_ID]: { at: 9, url: 'https://chatgpt.com/', withIds: [SCRIPTED_ID, 7, 'x'] },
        'local.no-url': { at: 9 },
      },
    });
    expect(parsed).toEqual({
      version: 1,
      stopped: false,
      enabled: { [SCRIPTED_ID]: { reviewHash: HASH, enabledAt: 5 } },
      crashNotices: {
        [SCRIPTED_ID]: { at: 9, url: 'https://chatgpt.com/', withIds: [SCRIPTED_ID] },
      },
    });
  });

  it('loads the empty state when storage cannot be read', async () => {
    storage.memory[SCRIPTED] = { version: 1, stopped: true, enabled: {}, crashNotices: {} };
    storage.failGets = true;
    expect(await loadScriptedState()).toEqual(EMPTY_SCRIPTED_STATE);
  });
});

describe('enableScriptedIfUnchanged', () => {
  it('turns a plugin on when its stored content is what the user reviewed', async () => {
    const plugin = await install();
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash, 7)).toBe('enabled');
    expect(await runState()).toBe('running');
    expect((storage.memory[STATE] as Record<string, { enabled: boolean }>)[SCRIPTED_ID]).toEqual({
      enabled: false,
      installedAt: 1,
    });
  });

  it('refuses, writing nothing, when the stored source no longer hashes to the reviewed one', async () => {
    const reviewed = await install('count()');
    await install('countAndSendEverywhere()');
    const writes = storage.writes.length;
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, reviewed.reviewHash)).toBe('changed');
    expect(storage.writes.length).toBe(writes);
    expect(await runState()).toBe('off');
  });

  it('refuses when the plugin was removed or is declarative', async () => {
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, HASH as ScriptHash)).toBe('changed');
    const plain = validateLocalManifest({
      ...storedScripted(),
      tier: 'declarative',
      contributes: {},
    });
    if (!plain.success) throw new Error('fixture must pass');
    await saveLocalPluginRecord(plain.data.raw, 1);
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, HASH as ScriptHash)).toBe('changed');
    expect(storage.memory[SCRIPTED]).toBeUndefined();
  });

  it('refuses, writing nothing, over a state a newer Voyager wrote', async () => {
    const plugin = await install();
    const newer = { version: 2, enabled: {}, futureField: true };
    storage.memory[SCRIPTED] = newer;
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash)).toBe('write_failed');
    expect(await setScriptedStopped(true)).toBe(false);
    expect(storage.memory[SCRIPTED]).toEqual(newer);
  });
});

describe('re-importing an enabled scripted plugin', () => {
  it('lands off in the import write alone, an identical re-import too', async () => {
    const plugin = await install('count()');
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    const writes = storage.writes.length;

    await install('count()');

    expect(storage.writes.length).toBe(writes + 1);
    expect(storage.writes.at(-1)).toHaveProperty(SCRIPTED);
    expect(await runState()).toBe('off');
  });

  it('never brings back an earlier enable when the earlier version is imported again', async () => {
    const first = await install('count()');
    await enableScriptedIfUnchanged(SCRIPTED_ID, first.reviewHash);
    await install('countAndSendEverywhere()');
    expect(await runState()).toBe('off');
    await install('count()');
    expect(await runState()).toBe('off');
  });

  it('lands off when only the sites it runs on change', async () => {
    const plugin = await install('count()');
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    await install('count()', { matches: ['https://chatgpt.com/*', 'https://claude.ai/*'] });
    expect(await runState()).toBe('off');
  });

  it('keeps the crash notice of the version a freeze turned off', async () => {
    await install('count()');
    storage.memory[SCRIPTED] = {
      ...EMPTY_SCRIPTED_STATE,
      crashNotices: {
        [SCRIPTED_ID]: { at: 9, url: 'https://chatgpt.com/', withIds: [SCRIPTED_ID] },
      },
    };
    await install('fixedCount()');
    expect(await runState()).toBe('paused:crash-guard');
  });
});

describe('the declarative path', () => {
  it('never lists, enables or mounts a stored scripted plugin', async () => {
    const plugin = await install();
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    expect(await new LocalPluginSource().list()).toEqual([]);
    expect(await enableLocalPluginIfUnchanged(plugin.manifest)).toBe('changed');
    expect(
      (storage.memory[STATE] as Record<string, { enabled: boolean }>)[SCRIPTED_ID].enabled,
    ).toBe(false);
  });
});

describe('disable, stop and remove', () => {
  it('turns one plugin off', async () => {
    const plugin = await install();
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    expect(await disableScripted(SCRIPTED_ID)).toBe(true);
    expect(await runState()).toBe('off');
  });

  it('pauses every plugin while stopped and resumes them after', async () => {
    const plugin = await install();
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    expect(await setScriptedStopped(true)).toBe(true);
    expect(await runState()).toBe('paused:stopped-all');
    expect(await setScriptedStopped(false)).toBe(true);
    expect(await runState()).toBe('running');
  });

  it('forgets the review on removal, so the same script imported again stays off', async () => {
    const plugin = await install();
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    await removeLocalPluginRecord(SCRIPTED_ID);
    expect(storage.memory[SCRIPTED]).toEqual(EMPTY_SCRIPTED_STATE);
    await install();
    expect(await runState()).toBe('off');
  });

  it('leaves the scripted state alone when a declarative plugin is removed', async () => {
    const plugin = await install();
    await enableScriptedIfUnchanged(SCRIPTED_ID, plugin.reviewHash);
    const before = structuredClone(storage.memory[SCRIPTED]);
    const plain = validateLocalManifest({
      ...storedScripted(),
      id: 'local.me.plain',
      tier: 'declarative',
      contributes: {},
    });
    if (!plain.success) throw new Error('fixture must pass');
    await saveLocalPluginRecord(plain.data.raw, 1);
    await removeLocalPluginRecord('local.me.plain');
    expect(storage.writes.at(-1)).not.toHaveProperty(SCRIPTED);
    expect(storage.memory[SCRIPTED]).toEqual(before);
  });
});

describe('scriptedRunState', () => {
  const enabledState = (reviewHash: ScriptHash) => ({
    ...EMPTY_SCRIPTED_STATE,
    enabled: { [SCRIPTED_ID]: { reviewHash, enabledAt: 1 } },
  });

  it.each([
    [{ kind: 'toggle-off', needs: 'allow-user-scripts' }, 'user-scripts-off'],
    [{ kind: 'toggle-off', needs: 'developer-mode' }, 'user-scripts-off'],
    [{ kind: 'unsupported', browser: 'safari' }, 'unsupported'],
  ] as const)('pauses an enabled plugin when user scripts are %j', async (availability, reason) => {
    const plugin = await install();
    expect(scriptedRunState(plugin, enabledState(plugin.reviewHash), availability)).toEqual({
      kind: 'paused',
      reason,
    });
  });

  it('reports a plugin the crash guard turned off as paused, not off', async () => {
    const plugin = await install();
    const state = {
      ...EMPTY_SCRIPTED_STATE,
      crashNotices: {
        [SCRIPTED_ID]: { at: 1, url: 'https://chatgpt.com/', withIds: [SCRIPTED_ID] },
      },
    };
    expect(scriptedRunState(plugin, state, AVAILABLE)).toEqual({
      kind: 'paused',
      reason: 'crash-guard',
    });
  });
});
