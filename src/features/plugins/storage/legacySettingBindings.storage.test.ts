import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import {
  legacyBindingKeys,
  loadLegacySettingSnapshot,
  resolveEffectiveEnabled,
  subscribeLegacySettings,
} from './legacySettingBindings';

const FORMULA_G = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
const VIM = OFFICIAL_PLUGIN_IDS.geminiVimInput;

const syncGet = () => chrome.storage.sync.get as unknown as Mock;
const addListener = () => chrome.storage.onChanged.addListener as unknown as Mock;
const removeListener = () => chrome.storage.onChanged.removeListener as unknown as Mock;

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

beforeEach(() => {
  localStorage.clear();
  syncGet().mockReset();
  addListener().mockReset();
  removeListener().mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadLegacySettingSnapshot', () => {
  it('uses the local width only for failed or invalid sync reads, then the 360px fallback', async () => {
    const key = StorageKeys.AISTUDIO_SIDEBAR_WIDTH;
    localStorage.setItem(key, '425');
    syncGet().mockResolvedValue({});
    expect((await loadLegacySettingSnapshot())[key]).toBe(280);
    syncGet().mockResolvedValue({ [key]: 399 });
    expect((await loadLegacySettingSnapshot())[key]).toBe(399);
    for (const invalid of [100, 601, '400', null, NaN]) {
      syncGet().mockResolvedValue({ [key]: invalid });
      expect((await loadLegacySettingSnapshot())[key]).toBe(425);
    }
    syncGet().mockRejectedValue(new Error('sync unavailable'));
    expect((await loadLegacySettingSnapshot())[key]).toBe(425);
    localStorage.setItem(key, '700');
    expect((await loadLegacySettingSnapshot())[key]).toBe(360);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect((await loadLegacySettingSnapshot())[key]).toBe(360);
  });
  it('reads binding keys and preserves missing switches while resolving AI Studio width fallback', async () => {
    syncGet().mockResolvedValue({
      [StorageKeys.INPUT_VIM_MODE]: true,
      [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: 'pink',
    });
    const snapshot = await loadLegacySettingSnapshot();
    expect(snapshot).toEqual({
      [StorageKeys.INPUT_VIM_MODE]: true,
      [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: 280,
    });
    expect(Object.prototype.hasOwnProperty.call(snapshot, StorageKeys.FORMULA_COPY_ENABLED)).toBe(
      false,
    );
    expect([...syncGet().mock.calls[0][0]].sort()).toEqual([...legacyBindingKeys()].sort());
  });

  it('rejects when the extension context is gone instead of guessing defaults', async () => {
    syncGet().mockRejectedValue(new Error('Extension context invalidated.'));
    await expect(loadLegacySettingSnapshot()).rejects.toThrow(/context invalidated/i);
  });

  it('falls back to the native defaults on any other read failure', async () => {
    syncGet().mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
    const snapshot = await loadLegacySettingSnapshot();
    expect(snapshot).toEqual({ [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: 360 });
    expect(resolveEffectiveEnabled({}, snapshot, FORMULA_G)).toBe(true);
    expect(resolveEffectiveEnabled({}, snapshot, VIM)).toBe(false);
  });
});

describe('subscribeLegacySettings', () => {
  function subscribe(): { callback: Mock; listener: Listener; stop: () => void } {
    const callback = vi.fn();
    const stop = subscribeLegacySettings(callback);
    const [[listener]] = addListener().mock.calls as [[Listener]];
    return { callback, listener, stop };
  }

  it('reports binding-key changes in the sync area only', () => {
    const { callback, listener } = subscribe();
    listener({ [StorageKeys.INPUT_VIM_MODE]: { newValue: true } }, 'local');
    listener({ [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: { newValue: 'pink' } }, 'sync');
    expect(callback).not.toHaveBeenCalled();

    listener(
      {
        [StorageKeys.INPUT_VIM_MODE]: { newValue: true, oldValue: false },
        [StorageKeys.HIGHLIGHT_DEFAULT_COLOR]: { newValue: 'pink' },
      },
      'sync',
    );
    expect(callback).toHaveBeenCalledWith({ [StorageKeys.INPUT_VIM_MODE]: true });
  });

  it('reports a removed key so merging it restores the default', () => {
    const { callback, listener } = subscribe();
    listener({ [StorageKeys.FORMULA_COPY_ENABLED]: { oldValue: false } }, 'sync');
    const [[changed]] = callback.mock.calls;
    expect(Object.prototype.hasOwnProperty.call(changed, StorageKeys.FORMULA_COPY_ENABLED)).toBe(
      true,
    );
    const merged = { [StorageKeys.FORMULA_COPY_ENABLED]: false, ...changed };
    expect(resolveEffectiveEnabled({}, merged, FORMULA_G)).toBe(true);
  });

  it('removes its listener on stop', () => {
    const { listener, stop } = subscribe();
    stop();
    expect(removeListener()).toHaveBeenCalledWith(listener);
  });
});
