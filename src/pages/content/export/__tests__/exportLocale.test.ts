// @vitest-environment node
// Firefox's content-script global is not the page window; only a node realm lets the two differ.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { readExportLanguage, watchExportLanguage } from '../exportLocale';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

function registeredListener(): Listener {
  const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
  return calls[calls.length - 1][0] as Listener;
}

describe('watchExportLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reports a language switched in sync storage and ignores other changes', async () => {
    const onChange = vi.fn();
    watchExportLanguage(onChange);
    const listener = registeredListener();

    listener({ [StorageKeys.LANGUAGE]: { newValue: 'zh_TW' } }, 'local');
    listener({ other: { newValue: 'fr' } }, 'sync');
    listener({ [StorageKeys.LANGUAGE]: { newValue: 'ja' } }, 'sync');

    await vi.waitFor(() => expect(onChange.mock.calls).toEqual([['ja']]));
  });

  it('stops listening once stopped', () => {
    const stop = watchExportLanguage(() => {});
    const listener = registeredListener();

    stop();

    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });
});

/**
 * Firefox runs content scripts in a global that inherits from the page window
 * but alone carries the extension APIs.
 */
function stubFirefoxPageWindow(): void {
  vi.stubGlobal('window', {});
}

describe('export language on Firefox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('relabels when the page window does not expose the extension API', async () => {
    stubFirefoxPageWindow();
    const onChange = vi.fn();

    watchExportLanguage(onChange);
    registeredListener()({ [StorageKeys.LANGUAGE]: { newValue: 'fr' } }, 'sync');

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('fr'));
  });

  it('reads the stored language when the page window does not expose the extension API', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      _keys: unknown,
      callback: (items: Record<string, unknown>) => void,
    ) => callback({ [StorageKeys.LANGUAGE]: 'ja' })) as unknown as typeof chrome.storage.sync.get);
    stubFirefoxPageWindow();

    await expect(readExportLanguage()).resolves.toBe('ja');
  });
});
