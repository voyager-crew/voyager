import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  CRASH_GRACE_MS,
  CRASH_SUSPECT_MS,
  parseScriptedLoads,
} from '@/features/plugins/scripted/crashGuard';
import { loadScriptedState, recordScriptedCrash } from '@/features/plugins/scripted/state';
import type { ScriptHash } from '@/features/plugins/scripted/types';

import { installMemoryLocal } from '../../../../features/plugins/scripted/__tests__/memoryLocal';
import { type CrashGuardDeps, createCrashGuard } from '../guard';
import { fakeUserScripts } from './fakeUserScripts';

const storage = installMemoryLocal();
const LOADS = StorageKeys.PLUGIN_SCRIPTED_LOADS;
const COUNTER = 'local.me.counter';
const GEMINI = 'https://gemini.google.com/app';
const HASH = 'a'.repeat(64) as ScriptHash;

function setup() {
  const clock = { now: 0 };
  const fake = fakeUserScripts([
    { id: COUNTER, matches: ['https://gemini.google.com/*'], js: [{ code: 'count()' }] },
  ]);
  storage.memory[StorageKeys.PLUGIN_SCRIPTED_STATE] = {
    version: 1,
    stopped: false,
    enabled: { [COUNTER]: { reviewHash: HASH, enabledAt: 1 } },
    crashNotices: {},
  };
  const order: string[] = [];
  const alarms = new Map<string, number>();
  const deps: CrashGuardDeps = {
    now: () => clock.now,
    readLoads: async () => parseScriptedLoads(storage.memory[LOADS]),
    writeLoads: async (records) => {
      storage.memory[LOADS] = structuredClone(records);
    },
    runningIdsFor: async (url) =>
      url?.startsWith('https://gemini.google.com/') ? [...fake.scripts.keys()] : [],
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
  return { guard: createCrashGuard(deps), clock, fake, order, alarms };
}

describe('scripted crash guard', () => {
  it('a reload of a page that froze unregisters and disables the plugin, and names it', async () => {
    const { guard, clock, fake, order } = setup();
    await guard.load(7, GEMINI);
    clock.now = CRASH_GRACE_MS + 500;
    await guard.load(7, GEMINI);

    expect(order).toEqual(['unregister', 'disable']);
    expect(fake.scripts.has(COUNTER)).toBe(false);
    const state = await loadScriptedState();
    expect(state.enabled[COUNTER]).toBeUndefined();
    expect(state.crashNotices[COUNTER]).toEqual({
      at: CRASH_GRACE_MS + 500,
      url: GEMINI,
      withIds: [COUNTER],
    });
    expect(parseScriptedLoads(storage.memory[LOADS])).toEqual({});
  });

  it('a confirmed page stays on through its next reload', async () => {
    const { guard, clock, fake, order } = setup();
    await guard.load(7, GEMINI);
    clock.now = 4_000;
    await guard.confirm(7, GEMINI);
    clock.now = 60_000;
    await guard.load(7, GEMINI);

    expect(order).toEqual([]);
    expect(fake.scripts.has(COUNTER)).toBe(true);
    expect((await loadScriptedState()).enabled[COUNTER]).toBeDefined();
  });

  it('a reload inside the grace period keeps the plugin on', async () => {
    const { guard, clock, fake } = setup();
    await guard.load(7, GEMINI);
    clock.now = CRASH_GRACE_MS - 1;
    await guard.load(7, GEMINI);
    expect(fake.scripts.has(COUNTER)).toBe(true);
    expect((await loadScriptedState()).enabled[COUNTER]).toBeDefined();
  });

  it('closing a tab the alarm marked suspect disables what ran there', async () => {
    const { guard, clock, alarms } = setup();
    await guard.load(7, GEMINI);
    expect(alarms.get('7')).toBe(CRASH_SUSPECT_MS);
    clock.now = CRASH_SUSPECT_MS;
    await guard.alarm(7);
    expect(parseScriptedLoads(storage.memory[LOADS])['7']?.status).toBe('suspect');
    clock.now = CRASH_SUSPECT_MS + 5_000;
    await guard.close(7);
    expect((await loadScriptedState()).crashNotices[COUNTER]?.url).toBe(GEMINI);
  });

  it('writes nothing for page loads no scripted plugin runs on', async () => {
    const { guard } = setup();
    const before = storage.writes.length;
    await guard.load(3, 'https://example.com/');
    await guard.confirm(3, 'https://example.com/');
    await guard.close(3);
    expect(storage.memory[LOADS]).toBeUndefined();
    expect(storage.writes.length).toBe(before);
  });
});
