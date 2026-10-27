import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { type HostCatalogCacheEntry } from './hostCatalogCache';
import { HostCatalogRefresher, type HostCatalogRefresherOptions } from './hostCatalogRefresh';
import type { PluginCatalogSettings } from './hostCatalogSettings';

const HOST = 'gemini.google.com';
const ON: PluginCatalogSettings = { onlineUpdatesEnabled: true, checkInterval: '6h' };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function response(marker = 'new') {
  return new Response(JSON.stringify({ format: 1, host: HOST, plugins: [], generatedAt: marker }));
}

function harness(overrides: HostCatalogRefresherOptions = {}) {
  const saved: HostCatalogCacheEntry[] = [];
  const listeners = new Set<() => void>();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());
  const loadSettings = vi.fn(async () => ON);
  const loadEntry = vi.fn(async (): Promise<HostCatalogCacheEntry | null> => null);
  const isHostEligible = vi.fn(async () => true);
  const refresher = new HostCatalogRefresher({
    enabled: true,
    extensionVersion: '1.0.0',
    fetchImpl,
    loadSettings,
    loadEntry,
    isHostEligible,
    saveEntry: async (entry) => {
      saved.push(entry);
    },
    subscribeOff: (off) => {
      listeners.add(off);
      return () => {
        listeners.delete(off);
      };
    },
    ...overrides,
  });
  return {
    refresher,
    fetchImpl,
    loadSettings,
    loadEntry,
    isHostEligible,
    saved,
    listeners,
    off: () => {
      for (const off of listeners) off();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('catalog update cancellation', () => {
  it.each(['settings', 'cache', 'eligibility'] as const)(
    'turning updates off during %s preparation cannot start a late request',
    async (stage) => {
      const settings = deferred<PluginCatalogSettings>();
      const cache = deferred<HostCatalogCacheEntry | null>();
      const eligibility = deferred<boolean>();
      const loadSettings = vi.fn(async () => ON);
      const loadEntry = vi.fn(async (): Promise<HostCatalogCacheEntry | null> => null);
      const isHostEligible = vi.fn(async () => true);
      if (stage === 'settings') loadSettings.mockImplementationOnce(() => settings.promise);
      if (stage === 'cache') loadEntry.mockImplementationOnce(() => cache.promise);
      if (stage === 'eligibility') isHostEligible.mockImplementationOnce(() => eligibility.promise);
      const test = harness({ loadSettings, loadEntry, isHostEligible });
      const pending = test.refresher.refresh(HOST);
      const reached = { settings: loadSettings, cache: loadEntry, eligibility: isHostEligible }[
        stage
      ];
      await vi.waitFor(() => expect(reached).toHaveBeenCalledTimes(1));
      test.off();
      settings.resolve(ON);
      cache.resolve(null);
      eligibility.resolve(true);
      expect(await pending).toMatchObject({ status: 'skipped', reason: 'disabled' });
      expect(test.listeners.size).toBe(0);
      expect((await test.refresher.refresh(HOST)).status).toBe('updated');
      expect(test.fetchImpl).toHaveBeenCalledTimes(1);
      expect(test.saved.map((entry) => entry.generatedAt)).toEqual(['new']);
    },
  );

  it.each(['fetch', 'body'] as const)(
    'turning updates off during %s cannot overwrite the next successful catalog',
    async (stage) => {
      const download = deferred<Response>();
      const body = deferred<unknown>();
      const oldResponse = response('old');
      const readBody = vi.spyOn(oldResponse, 'json').mockReturnValue(body.promise);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response('new'));
      if (stage === 'fetch') fetchImpl.mockImplementationOnce(() => download.promise);
      else fetchImpl.mockResolvedValueOnce(oldResponse);
      const test = harness({ fetchImpl });
      const pending = test.refresher.refresh(HOST);
      await vi.waitFor(() =>
        expect(stage === 'fetch' ? fetchImpl : readBody).toHaveBeenCalledTimes(1),
      );
      const signal = fetchImpl.mock.calls[0][1]?.signal;
      test.off();
      expect(await pending).toMatchObject({ status: 'skipped', reason: 'disabled' });
      expect(signal?.aborted).toBe(true);
      expect((await test.refresher.refresh(HOST)).status).toBe('updated');
      download.resolve(oldResponse);
      body.resolve({ format: 1, host: HOST, plugins: [], generatedAt: 'old' });
      // Let the old fetch/json continuation finish before inspecting the final cache.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(test.listeners.size).toBe(0);
      expect(test.saved.map((entry) => entry.generatedAt)).toEqual(['new']);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it('a body that answers after timeout cannot replace a newer successful catalog', async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const oldResponse = response('old');
    vi.spyOn(oldResponse, 'json').mockReturnValue(body.promise);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(oldResponse)
      .mockResolvedValue(response('new'));
    const test = harness({ fetchImpl, timeoutMs: 100 });
    const pending = test.refresher.refresh(HOST);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ status: 'failed', reason: 'timeout after 100ms' });
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect((await test.refresher.refresh(HOST, { force: true })).status).toBe('updated');
    body.resolve({ format: 1, host: HOST, plugins: [], generatedAt: 'old' });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.saved.map((entry) => entry.generatedAt)).toEqual([undefined, 'new']);
    expect(test.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turning updates off waits for an already-started cache write before freeing the host', async () => {
    const commit = deferred<void>();
    const saveEntry = vi.fn(async () => {
      await commit.promise;
    });
    const test = harness({ saveEntry });
    const pending = test.refresher.refresh(HOST);
    await vi.waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(1));
    test.off();
    expect(test.refresher.refresh(HOST, { force: true })).toBe(pending);
    expect(test.fetchImpl).toHaveBeenCalledTimes(1);
    commit.resolve();
    expect((await pending).status).toBe('updated');
    test.loadSettings.mockResolvedValue({ ...ON, onlineUpdatesEnabled: false });
    expect((await test.refresher.refresh(HOST)).status).toBe('skipped');
    expect(test.fetchImpl).toHaveBeenCalledTimes(1);
    expect(test.listeners.size).toBe(0);
  });

  it('the actual sync OFF event defeats a stale settings read and removes its listener', async () => {
    const settings = deferred<PluginCatalogSettings>();
    const loadSettings = vi.fn(() => settings.promise);
    const test = harness({ loadSettings, subscribeOff: undefined });
    const pending = test.refresher.refresh(HOST);
    await vi.waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(1));
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)?.[0];
    if (!listener) throw new Error('Missing storage listener');
    listener(
      { [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: { oldValue: true, newValue: false } },
      'sync',
    );
    expect(await pending).toMatchObject({ status: 'skipped', reason: 'disabled' });
    settings.resolve(ON);
    await Promise.resolve();
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
    const enabled = harness();
    expect((await enabled.refresher.refresh(HOST)).status).toBe('updated');
    expect(enabled.saved[0].generatedAt).toBe('new');
  });
});
