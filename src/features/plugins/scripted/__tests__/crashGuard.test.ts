import { describe, expect, it } from 'vitest';

import {
  CRASH_GRACE_MS,
  CRASH_SUSPECT_MS,
  crashGuardSessionEnded,
  crashGuardStep,
  crashGuardTransition,
  parseScriptedLoads,
} from '../crashGuard';
import type { LoadedScript, ScriptHash, ScriptedLoadRecord } from '../types';

const URL = 'https://gemini.google.com/app';
const A = 'local.me.counter';
const B = 'local.me.clicks';
const HASH_A = 'a'.repeat(64) as ScriptHash;
const PA: LoadedScript = { id: A, reviewHash: HASH_A };
const PB: LoadedScript = { id: B, reviewHash: 'b'.repeat(64) as ScriptHash };

const loading = (startedAt = 0, plugins: readonly LoadedScript[] = [PA]): ScriptedLoadRecord => ({
  status: 'loading',
  url: URL,
  plugins,
  startedAt,
});
const suspect = (startedAt = 0, plugins: readonly LoadedScript[] = [PA]): ScriptedLoadRecord => ({
  status: 'suspect',
  url: URL,
  plugins,
  startedAt,
});

describe('crashGuardTransition', () => {
  it('records a load that runs scripted plugins', () => {
    expect(
      crashGuardTransition(undefined, { type: 'load', url: URL, plugins: [PA], at: 5 }),
    ).toEqual({
      record: loading(5),
    });
  });

  it('records nothing for a load that runs none', () => {
    expect(
      crashGuardTransition(undefined, { type: 'load', url: URL, plugins: [], at: 5 }).record,
    ).toBeUndefined();
  });

  it('a page that confirms is alive, and its next load disables nothing', () => {
    const alive = crashGuardTransition(loading(0), { type: 'confirm', url: URL, at: 4_000 });
    expect(alive.record).toEqual({ status: 'confirmed', url: URL, at: 4_000 });

    const next = crashGuardTransition(alive.record, {
      type: 'load',
      url: URL,
      plugins: [PA],
      at: 60_000,
    });
    expect(next.crash).toBeUndefined();
    expect(next.record).toEqual(loading(60_000));
  });

  it('a late confirmation from a suspect page still clears it', () => {
    const late = crashGuardTransition(suspect(0), { type: 'confirm', url: URL, at: 40_000 });
    expect(late.record?.status).toBe('confirmed');
  });

  it('the next load of a page that never confirmed disables every plugin it ran', () => {
    const next = crashGuardTransition(loading(0, [PA, PB]), {
      type: 'load',
      url: URL,
      plugins: [PA, PB],
      at: CRASH_GRACE_MS,
    });
    expect(next.crash).toEqual({ at: CRASH_GRACE_MS, url: URL, plugins: [PA, PB] });
    expect(next.record).toBeUndefined();
  });

  it('the next load of a suspect tab disables its plugins and keeps watching the others', () => {
    const next = crashGuardTransition(suspect(0, [PA]), {
      type: 'load',
      url: URL,
      plugins: [PA, PB],
      at: CRASH_SUSPECT_MS + 1,
    });
    expect(next.crash?.plugins).toEqual([PA]);
    expect(next.record).toEqual(loading(CRASH_SUSPECT_MS + 1, [PB]));
  });

  it('a reload inside the grace period disables nothing', () => {
    const next = crashGuardTransition(loading(0), {
      type: 'load',
      url: URL,
      plugins: [PA],
      at: CRASH_GRACE_MS - 1,
    });
    expect(next.crash).toBeUndefined();
    expect(next.record?.status).toBe('loading');
  });

  it('quick reloads of a page that never confirms still add up to a crash', () => {
    let record: ScriptedLoadRecord | undefined = loading(0);
    for (const at of [4_000, 8_000]) {
      const step = crashGuardTransition(record, { type: 'load', url: URL, plugins: [PA], at });
      expect(step.crash).toBeUndefined();
      record = step.record;
    }
    expect(
      crashGuardTransition(record, { type: 'load', url: URL, plugins: [PA], at: 12_000 }).crash
        ?.plugins,
    ).toEqual([PA]);
  });

  it('navigating to a page no plugin matches clears the record', () => {
    const next = crashGuardTransition(loading(0), {
      type: 'load',
      url: 'https://example.com/',
      plugins: [],
      at: 2_000,
    });
    expect(next).toEqual({ record: undefined, crash: undefined });
  });

  it('the alarm marks an unconfirmed load suspect only once it is old enough', () => {
    expect(crashGuardTransition(loading(0), { type: 'alarm', at: CRASH_SUSPECT_MS - 1 })).toEqual({
      record: loading(0),
    });
    expect(crashGuardTransition(loading(0), { type: 'alarm', at: CRASH_SUSPECT_MS })).toEqual({
      record: suspect(0),
    });
    const confirmed: ScriptedLoadRecord = { status: 'confirmed', url: URL, at: 1 };
    expect(crashGuardTransition(confirmed, { type: 'alarm', at: CRASH_SUSPECT_MS }).record).toBe(
      confirmed,
    );
  });

  it('closing a suspect tab disables its plugins', () => {
    expect(crashGuardTransition(suspect(0), { type: 'close', at: CRASH_SUSPECT_MS + 5 })).toEqual({
      record: undefined,
      crash: { at: CRASH_SUSPECT_MS + 5, url: URL, plugins: [PA] },
    });
  });

  it('closing a tab quickly, or after it confirmed, disables nothing', () => {
    expect(crashGuardTransition(loading(0), { type: 'close', at: 1_000 }).crash).toBeUndefined();
    const confirmed: ScriptedLoadRecord = { status: 'confirmed', url: URL, at: 1 };
    expect(crashGuardTransition(confirmed, { type: 'close', at: 99_000 })).toEqual({
      record: undefined,
      crash: undefined,
    });
  });

  it('another tab loading a suspect tab’s plugin disables it; a merely loading tab is left alone', () => {
    expect(
      crashGuardTransition(suspect(0), { type: 'peer-load', plugins: [PA], at: 50_000 }),
    ).toEqual({
      record: undefined,
      crash: { at: 50_000, url: URL, plugins: [PA] },
    });
    expect(
      crashGuardTransition(suspect(0), { type: 'peer-load', plugins: [PB], at: 50_000 }).crash,
    ).toBeUndefined();
    expect(
      crashGuardTransition(loading(0), { type: 'peer-load', plugins: [PA], at: 5_000 }).crash,
    ).toBeUndefined();
  });

  it('another tab loading new code under the same id says nothing about the suspect code', () => {
    const replacement: LoadedScript = { id: A, reviewHash: 'c'.repeat(64) as ScriptHash };
    expect(
      crashGuardTransition(suspect(0), { type: 'peer-load', plugins: [replacement], at: 50_000 }),
    ).toEqual({ record: suspect(0) });
  });
});

describe('crashGuardStep', () => {
  it('a new tab loading a frozen tab’s plugin disables it before it runs there', () => {
    const step = crashGuardStep({ '1': suspect(0, [PA]) }, '2', {
      type: 'load',
      url: URL,
      plugins: [PA, PB],
      at: 60_000,
    });
    expect(step.crashes).toEqual([{ at: 60_000, url: URL, plugins: [PA] }]);
    expect(step.records).toEqual({ '2': loading(60_000, [PB]) });
  });

  it('leaves other tabs’ records alone on a confirmation', () => {
    const records = { '1': loading(0), '2': loading(0, [PB]) };
    const step = crashGuardStep(records, '2', { type: 'confirm', url: URL, at: 4_000 });
    expect(step.records['1']).toEqual(loading(0));
    expect(step.records['2']?.status).toBe('confirmed');
    expect(step.crashes).toEqual([]);
  });

  it('a browser restart disables what an unconfirmed load ran and clears every record', () => {
    const step = crashGuardSessionEnded(
      { '1': loading(0), '2': { status: 'confirmed', url: URL, at: 1 } },
      CRASH_GRACE_MS * 10,
    );
    expect(step.records).toEqual({});
    expect(step.crashes.map((crash) => crash.plugins)).toEqual([[PA]]);
  });
});

describe('parseScriptedLoads', () => {
  it('keeps well-formed records and drops the rest', () => {
    expect(
      parseScriptedLoads({
        '1': loading(3),
        '2': { status: 'confirmed', url: URL, at: 9 },
        '3': {
          status: 'loading',
          url: URL,
          plugins: [{ id: 'me.not-local', reviewHash: HASH_A }],
          startedAt: 1,
        },
        '4': { status: 'suspect', url: URL, plugins: [PA] },
        '5': { status: 'running', url: URL, plugins: [PA], startedAt: 1 },
        tab: loading(1),
        '6': null,
      }),
    ).toEqual({ '1': loading(3), '2': { status: 'confirmed', url: URL, at: 9 } });
  });

  it('reads anything else as no records', () => {
    for (const value of [undefined, null, 'x', [loading(0)]]) {
      expect(parseScriptedLoads(value)).toEqual({});
    }
  });
});
