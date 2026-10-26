import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiBundledRevision } from '@/core/gemini/selectors/bundle';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import geminiSite from '@/features/plugins/catalog/sites/gemini/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';

import { startPageSelectors } from '../pageSelectorStartup';

const stops: Array<() => void> = [];
const host = 'gemini.google.com';
const updatesKey = StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED;

function userTexts(): Array<string | null> {
  return Array.from(
    document.querySelectorAll(getGeminiTurnView().profiles['turn.user'].join(',')),
    (node) => node.textContent,
  );
}

function stored(): Record<string, unknown> {
  return {
    [hostCatalogStorageKey(host)]: {
      host,
      status: 'ok',
      manifests: [],
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 10,
      lastAttemptAt: 10,
      failureCount: 0,
      site: {
        ...geminiSite,
        catalogRevision: getGeminiBundledRevision() + 1,
        locators: { 'turn.user': ['.new-user'] },
      },
    },
  };
}

function start(
  lifetime = new AbortController().signal,
  url = 'https://gemini.google.com/app/test',
) {
  const startup = startPageSelectors({ url, doc: document, lifetime });
  stops.push(startup.stop);
  return startup;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML =
    '<div class="user-query-container">Bundled turn</div><div class="new-user">Catalog turn</div>';
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({ [updatesKey]: true } as never);
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('Gemini startup hydration', () => {
  it('finishes OFF without a timer wait, cache adoption or a due-check message', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({ [updatesKey]: false } as never);
    vi.mocked(chrome.storage.local.get).mockResolvedValue(stored() as never);
    await start().ready;
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(userTexts()).toEqual(['Bundled turn']);
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a missing cache starts bundled features without waiting for the host settings read', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);
    vi.mocked(chrome.storage.sync.get).mockImplementation(() => new Promise(() => {}) as never);
    const startup = start();
    await startup.ready;
    expect((await startup.initialAdapter)?.id).toBe('gemini');
    expect(userTexts()).toEqual(['Bundled turn']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the host reuses the adapter and switch reads that installed its page snapshot', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(stored() as never);
    const startup = start();
    await startup.ready;
    const first = await startup.legacySettings!.load();
    expect(await startup.legacySettings!.load()).toBe(first);
    expect((await startup.initialAdapter)?.locators?.['turn.user']).toEqual(['.new-user']);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it('starts the due check after one cached snapshot without waiting for its response', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(stored() as never);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => new Promise(() => undefined));
    await start().ready;
    expect(userTexts()).toEqual(['Catalog turn']);
    expect(getGeminiTurnView().profiles['turn.user']).toEqual(['.new-user']);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'gv.pluginCatalog.refresh',
        payload: { host },
      },
      expect.any(Function),
    );
  });

  it('does not adopt an old ON read if online updates changed while storage was pending', async () => {
    let finish: (value: Record<string, unknown>) => void = () => undefined;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const startup = start();
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    listener?.({ [updatesKey]: { oldValue: true, newValue: false } }, 'sync');
    finish(stored());
    await startup.ready;
    expect(userTexts()).toEqual(['Bundled turn']);
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
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    lifetime.abort();
    await startup.ready;
    finish(stored());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(userTexts()).toEqual(['Bundled turn']);
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
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    finish(stored());
    startup.stop();
    await startup.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lifetime.signal.aborted).toBe(false);
    expect(startup.isCurrent()).toBe(false);
    expect(userTexts()).toEqual(['Bundled turn']);
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
    finish(stored());
    await vi.advanceTimersByTimeAsync(0);
    expect(startup.isCurrent()).toBe(true);
    expect(userTexts()).toEqual(['Bundled turn']);
    expect(getGeminiTurnView().remoteKeys.size).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });

  it('does not read this channel for unknown hosts, insecure pages or build-off', async () => {
    for (const url of ['https://unknown.example/', 'http://gemini.google.com/']) {
      await start(undefined, url).ready;
    }
    vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'off');
    await start().ready;
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
