import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { LegacySettingSnapshot } from '../storage/legacySettingBindings';
import { isPluginWanted, legacyBoundSettings, openLegacySnapshotFeed } from './legacySnapshotFeed';
import { CLOSED_ADMISSION, type OfficialAdmission } from './officialAdmission';

const FORMULA_ID = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
const FORMULA_KEY = StorageKeys.FORMULA_COPY_ENABLED;
const SIZE_KEY = StorageKeys.CHAT_FONT_SIZE;
const OPEN: OfficialAdmission = { stateOf: () => 'admitted', subscribe: () => () => {} };

describe('isPluginWanted', () => {
  it('keeps a bound plugin off until its legacy key has been read', () => {
    expect(isPluginWanted({}, null, OPEN, FORMULA_ID)).toBe(false);
    expect(isPluginWanted({}, {}, OPEN, FORMULA_ID)).toBe(true);
  });

  it('keeps an unadmitted plugin off whatever its switch says', () => {
    expect(isPluginWanted({}, { [FORMULA_KEY]: true }, CLOSED_ADMISSION, FORMULA_ID)).toBe(false);
  });

  it('leaves unbound plugins to their plugin-state entry, snapshot or not', () => {
    const state = { 'local.me.tweak': { enabled: true, installedAt: 1 } };
    expect(isPluginWanted(state, null, CLOSED_ADMISSION, 'local.me.tweak')).toBe(true);
    expect(isPluginWanted({}, null, CLOSED_ADMISSION, 'local.me.tweak')).toBe(false);
  });
});

describe('openLegacySnapshotFeed', () => {
  function source(loaded: Promise<LegacySettingSnapshot>) {
    let listener: ((changed: LegacySettingSnapshot) => void) | null = null;
    const unsubscribe = vi.fn();
    return {
      unsubscribe,
      fire: (changed: LegacySettingSnapshot) => listener?.(changed),
      source: {
        load: () => loaded,
        subscribe: (callback: (changed: LegacySettingSnapshot) => void) => {
          listener = callback;
          return unsubscribe;
        },
      },
    };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('lays changes seen before the read landed over the read, and later ones over the snapshot', async () => {
    let resolve: (snapshot: LegacySettingSnapshot) => void = () => {};
    const s = source(new Promise((r) => (resolve = r)));
    const onChange = vi.fn();
    const feed = openLegacySnapshotFeed(s.source, onChange);

    s.fire({ [FORMULA_KEY]: false });
    expect(feed.current()).toBeNull();
    resolve({ [FORMULA_KEY]: true, other: 1 });
    await settle();
    expect(feed.current()).toEqual({ [FORMULA_KEY]: false, other: 1 });
    expect(onChange).toHaveBeenCalledTimes(2); // the change, then the landed read

    s.fire({ [FORMULA_KEY]: undefined });
    expect(feed.current()).toEqual({ [FORMULA_KEY]: undefined, other: 1 });
    expect(onChange).toHaveBeenCalledTimes(3);

    feed.stop();
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stays unread for good, without an unhandled rejection, when the extension context is gone', async () => {
    const s = source(Promise.reject(new Error('Extension context invalidated.')));
    const onChange = vi.fn();
    const feed = openLegacySnapshotFeed(s.source, onChange);
    expect(feed.phase()).toBe('loading');
    await settle();
    // The failure is announced once, so whoever waited for the read stops waiting.
    expect(feed.phase()).toBe('failed');
    expect(onChange).toHaveBeenCalledTimes(1);
    s.fire({ [FORMULA_KEY]: true });
    expect(feed.current()).toBeNull();
    expect(feed.phase()).toBe('failed');
  });

  it('reports the read as loaded once it lands', async () => {
    const feed = openLegacySnapshotFeed(source(Promise.resolve({})).source, () => {});
    expect(feed.phase()).toBe('loading');
    await settle();
    expect(feed.phase()).toBe('loaded');
  });

  it('ignores a read that lands after stop()', async () => {
    let resolve: (snapshot: LegacySettingSnapshot) => void = () => {};
    const s = source(new Promise((r) => (resolve = r)));
    const onChange = vi.fn();
    const feed = openLegacySnapshotFeed(s.source, onChange);
    feed.stop();
    resolve({ [FORMULA_KEY]: true });
    await settle();
    expect(feed.current()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the last numeric value when a legacy value key is removed or turns non-numeric while the page lives', async () => {
    const s = source(Promise.resolve({ [SIZE_KEY]: 120, [FORMULA_KEY]: true }));
    const onChange = vi.fn();
    const feed = openLegacySnapshotFeed(s.source, onChange);
    await settle();
    onChange.mockClear();

    s.fire({ [SIZE_KEY]: 130 });
    expect(feed.current()?.[SIZE_KEY]).toBe(130);
    for (const rejected of [undefined, null, '140', true]) {
      s.fire({ [SIZE_KEY]: rejected });
      expect(feed.current()?.[SIZE_KEY]).toBe(130);
    }
    // Only the accepted change woke the host.
    expect(onChange).toHaveBeenCalledTimes(1);

    // One change can carry a rejected value key beside an accepted switch.
    s.fire({ [SIZE_KEY]: undefined, [FORMULA_KEY]: false });
    expect(feed.current()).toEqual({ [SIZE_KEY]: 130, [FORMULA_KEY]: false });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps a rejected live value from replacing the stored one when the read lands later', async () => {
    let resolve: (snapshot: LegacySettingSnapshot) => void = () => {};
    const s = source(new Promise((r) => (resolve = r)));
    const feed = openLegacySnapshotFeed(s.source, () => {});
    s.fire({ [SIZE_KEY]: 'large' });
    resolve({ [SIZE_KEY]: 125 });
    await settle();
    expect(feed.current()).toEqual({ [SIZE_KEY]: 125 });
    expect(feed.wasChangedLive(SIZE_KEY)).toBe(false);
  });

  it('tells a key changed live on this page from one only read', async () => {
    let resolve: (snapshot: LegacySettingSnapshot) => void = () => {};
    const s = source(new Promise((r) => (resolve = r)));
    const feed = openLegacySnapshotFeed(s.source, () => {});
    s.fire({ [FORMULA_KEY]: undefined });
    resolve({ [FORMULA_KEY]: true, [StorageKeys.CHAT_WIDTH]: 80 });
    await settle();
    expect(feed.wasChangedLive(FORMULA_KEY)).toBe(true);
    expect(feed.wasChangedLive(StorageKeys.CHAT_WIDTH)).toBe(false);
    s.fire({ [StorageKeys.CHAT_WIDTH]: 90 });
    expect(feed.wasChangedLive(StorageKeys.CHAT_WIDTH)).toBe(true);
  });
});

describe('legacyBoundSettings', () => {
  it('gives a bound official plugin no settings beyond its legacy values, and an unbound one none of its own', () => {
    expect(legacyBoundSettings(OFFICIAL_PLUGIN_IDS.geminiFork, { [SIZE_KEY]: 120 })).toEqual({});
    expect(legacyBoundSettings('local.me.tweak', { [SIZE_KEY]: 120 })).toBeNull();
  });
});
