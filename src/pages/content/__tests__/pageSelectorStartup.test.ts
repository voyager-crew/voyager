import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiBundledRevision } from '@/core/gemini/selectors/bundle';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { geminiSelectorCacheKey } from '@/features/geminiSelectorFixes/cache';

import { startPageGeminiSelectors } from '../pageSelectorStartup';

const stops: Array<() => void> = [];
const host = 'gemini.google.com';
const consentKey = StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES;

function stored(enabled: boolean): Record<string, unknown> {
  return {
    [consentKey]: enabled,
    [geminiSelectorCacheKey(host)]: {
      format: 1,
      host,
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 10,
      file: {
        format: 1,
        site: 'gemini',
        host,
        catalogRevision: getGeminiBundledRevision() + 1,
        selectors: { 'turn.user': ['.new-user'] },
      },
    },
  };
}

function start(
  lifetime = new AbortController().signal,
  url = 'https://gemini.google.com/app/test',
) {
  const startup = startPageGeminiSelectors({ url, doc: document, lifetime });
  stops.push(startup.stop);
  return startup;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.stubEnv('VOYAGER_GEMINI_SELECTOR_REMOTE', 'on');
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Gemini startup hydration', () => {
  it('finishes OFF without a timer wait, cache adoption or a due-check message', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.get).mockResolvedValue(stored(false) as never);
    await start().ready;
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts the due check after one cached snapshot without waiting for its response', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(stored(true) as never);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => new Promise(() => undefined));
    await start().ready;
    expect(getGeminiTurnView().profiles['turn.user']).toEqual(['.new-user']);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'gv.geminiSelectors.refresh',
      host,
      force: false,
    });
  });

  it('does not adopt an old ON read if consent changed while storage was pending', async () => {
    let finish: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const startup = start();
    await Promise.resolve();
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    listener?.({ [consentKey]: { oldValue: true, newValue: false } }, 'local');
    finish(stored(true));
    await startup.ready;
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send a late due check or install a snapshot after retirement', async () => {
    let finish: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const lifetime = new AbortController();
    const startup = start(lifetime.signal);
    await Promise.resolve();
    lifetime.abort();
    await startup.ready;
    finish(stored(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('explicit cleanup retires startup even when beforeunload leaves the page signal live', async () => {
    let finish: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const lifetime = new AbortController();
    const startup = start(lifetime.signal);
    await Promise.resolve();
    finish(stored(true));
    startup.stop();
    await startup.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lifetime.signal.aborted).toBe(false);
    expect(startup.isCurrent()).toBe(false);
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('a stalled local read cannot install or request after the 250ms startup fallback', async () => {
    vi.useFakeTimers();
    let finish: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const startup = start();
    await vi.advanceTimersByTimeAsync(250);
    await startup.ready;
    finish(stored(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(startup.isCurrent()).toBe(true);
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });

  it('does not read this channel for AI Studio, arbitrary hosts or build-off', async () => {
    for (const url of [
      'https://aistudio.google.com/',
      'https://chatgpt.com/',
      'http://gemini.google.com/',
    ]) {
      await start(undefined, url).ready;
    }
    vi.stubEnv('VOYAGER_GEMINI_SELECTOR_REMOTE', 'off');
    await start().ready;
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
