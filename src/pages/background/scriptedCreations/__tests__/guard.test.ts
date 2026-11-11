import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  removeLocalPluginRecord,
  saveLocalPluginRecord,
} from '@/features/plugins/local/localPluginStore';
import {
  CRASH_GRACE_MS,
  CRASH_SUSPECT_MS,
  parseScriptedLoads,
} from '@/features/plugins/scripted/crashGuard';
import { loadedScriptsFor, reconcileUserScripts } from '@/features/plugins/scripted/registrar';
import {
  enableScriptedIfUnchanged,
  loadScriptedPlugins,
  loadScriptedState,
  readScriptedPlugin,
  recordScriptedCrash,
} from '@/features/plugins/scripted/state';

import {
  SCRIPTED_ID,
  storedScripted,
} from '../../../../features/plugins/scripted/__tests__/fixtures';
import { installMemoryLocal } from '../../../../features/plugins/scripted/__tests__/memoryLocal';
import { type CrashGuardDeps, createCrashGuard } from '../guard';
import { fakeUserScripts } from './fakeUserScripts';

const storage = installMemoryLocal();
const LOADS = StorageKeys.PLUGIN_SCRIPTED_LOADS;
const MANIFESTS = StorageKeys.PLUGIN_LOCAL_MANIFESTS;
const PAGE = 'https://chatgpt.com/c/abc';

function setup() {
  const clock = { now: 0 };
  const fake = fakeUserScripts();
  const order: string[] = [];
  const alarms = new Map<string, number>();
  const deps: CrashGuardDeps = {
    now: () => clock.now,
    readLoads: async () => parseScriptedLoads(storage.memory[LOADS]),
    writeLoads: async (records) => {
      storage.memory[LOADS] = structuredClone(records);
    },
    runningFor: async (url) =>
      url ? loadedScriptsFor(url, await fake.api.getScripts(), await loadScriptedPlugins()) : [],
    readState: loadScriptedState,
    unregister: async (ids) => {
      order.push('unregister');
      await fake.api.unregister({ ids: [...ids] });
    },
    recordCrash: async (crash) => {
      order.push('disable');
      return recordScriptedCrash(crash);
    },
    scheduleSuspectCheck: (tab, when) => alarms.set(tab, when),
  };
  const reconcile = () =>
    reconcileUserScripts({
      readAvailability: async () => ({ kind: 'available' }),
      readPlugins: loadScriptedPlugins,
      readState: loadScriptedState,
      userScripts: () => fake.api,
    });
  /** Import, review and turn on `source`, as the popup does, then let the registrar run. */
  const installAndTurnOn = async (source = 'count()') => {
    const manifest = storedScripted(source);
    await saveLocalPluginRecord(manifest, clock.now);
    const plugin = await readScriptedPlugin(manifest);
    expect(await enableScriptedIfUnchanged(SCRIPTED_ID, plugin!.reviewHash)).toBe('enabled');
    await reconcile();
  };
  return { guard: createCrashGuard(deps), clock, fake, order, alarms, installAndTurnOn, reconcile };
}

const registeredCode = (fake: ReturnType<typeof fakeUserScripts>) =>
  fake.scripts.get(SCRIPTED_ID)?.js?.[1]?.code;

describe('scripted crash guard', () => {
  it('a reload of a page that froze unregisters and disables the plugin, and names it', async () => {
    const { guard, clock, fake, order, installAndTurnOn } = setup();
    await installAndTurnOn();
    await guard.load(7, PAGE);
    clock.now = CRASH_GRACE_MS + 500;
    await guard.load(7, PAGE);

    expect(order).toEqual(['unregister', 'disable']);
    expect(fake.scripts.has(SCRIPTED_ID)).toBe(false);
    const state = await loadScriptedState();
    expect(state.enabled[SCRIPTED_ID]).toBeUndefined();
    expect(state.crashNotices[SCRIPTED_ID]).toEqual({
      at: CRASH_GRACE_MS + 500,
      url: PAGE,
      withIds: [SCRIPTED_ID],
    });
    expect(parseScriptedLoads(storage.memory[LOADS])).toEqual({});
  });

  it('a confirmed page stays on through its next reload', async () => {
    const { guard, clock, fake, order, installAndTurnOn } = setup();
    await installAndTurnOn();
    await guard.load(7, PAGE);
    clock.now = 4_000;
    await guard.confirm(7, PAGE);
    clock.now = 60_000;
    await guard.load(7, PAGE);

    expect(order).toEqual([]);
    expect(fake.scripts.has(SCRIPTED_ID)).toBe(true);
    expect((await loadScriptedState()).enabled[SCRIPTED_ID]).toBeDefined();
  });

  it('a reload inside the grace period keeps the plugin on', async () => {
    const { guard, clock, fake, installAndTurnOn } = setup();
    await installAndTurnOn();
    await guard.load(7, PAGE);
    clock.now = CRASH_GRACE_MS - 1;
    await guard.load(7, PAGE);
    expect(fake.scripts.has(SCRIPTED_ID)).toBe(true);
    expect((await loadScriptedState()).enabled[SCRIPTED_ID]).toBeDefined();
  });

  it('closing a tab the alarm marked suspect disables what ran there', async () => {
    const { guard, clock, alarms, installAndTurnOn } = setup();
    await installAndTurnOn();
    await guard.load(7, PAGE);
    expect(alarms.get('7')).toBe(CRASH_SUSPECT_MS);
    clock.now = CRASH_SUSPECT_MS;
    await guard.alarm(7);
    expect(parseScriptedLoads(storage.memory[LOADS])['7']?.status).toBe('suspect');
    clock.now = CRASH_SUSPECT_MS + 5_000;
    await guard.close(7);
    expect((await loadScriptedState()).crashNotices[SCRIPTED_ID]?.url).toBe(PAGE);
  });

  it('writes nothing for page loads no scripted plugin runs on', async () => {
    const { guard, installAndTurnOn } = setup();
    await installAndTurnOn();
    const before = storage.writes.length;
    await guard.load(3, 'https://example.com/');
    await guard.confirm(3, 'https://example.com/');
    await guard.close(3);
    expect(storage.memory[LOADS]).toBeUndefined();
    expect(storage.writes.length).toBe(before);
  });
});

describe('a crash verdict after the plugin changed', () => {
  it('a page that froze on the old code does not turn off the reviewed replacement', async () => {
    const { guard, clock, fake, installAndTurnOn } = setup();
    await installAndTurnOn('count()');
    await guard.load(7, PAGE);
    clock.now = 2_000;
    await installAndTurnOn('fixedCount()');
    expect(registeredCode(fake)).toBe('fixedCount()');

    clock.now = CRASH_SUSPECT_MS + 5_000;
    await guard.close(7);

    const state = await loadScriptedState();
    expect(state.enabled[SCRIPTED_ID]).toBeDefined();
    expect(state.crashNotices[SCRIPTED_ID]).toBeUndefined();
    expect(registeredCode(fake)).toBe('fixedCount()');
  });

  it('a re-import, identical too, takes the plugin out of every load that ran it', async () => {
    const { guard, clock, installAndTurnOn } = setup();
    await installAndTurnOn('count()');
    await guard.load(7, PAGE);
    const before = structuredClone(storage.memory[MANIFESTS]);
    clock.now = 2_000;
    await installAndTurnOn('count()');
    await guard.recordsChanged(before, storage.memory[MANIFESTS]);

    clock.now = CRASH_SUSPECT_MS + 5_000;
    await guard.close(7);

    const state = await loadScriptedState();
    expect(state.enabled[SCRIPTED_ID]).toBeDefined();
    expect(state.crashNotices[SCRIPTED_ID]).toBeUndefined();
  });

  it('a removal clears the plugin from the loads that ran it', async () => {
    const { guard, installAndTurnOn } = setup();
    await installAndTurnOn();
    await guard.load(7, PAGE);
    const before = structuredClone(storage.memory[MANIFESTS]);
    await removeLocalPluginRecord(SCRIPTED_ID);
    await guard.recordsChanged(before, storage.memory[MANIFESTS]);

    expect(parseScriptedLoads(storage.memory[LOADS])).toEqual({});
  });
});
