// @vitest-environment-options {"url":"https://chatgpt.com/c/test"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getSiteSelectorView } from '@/core/selectors';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';

import { startPageSelectors } from '../pageSelectorStartup';

const host = 'chatgpt.com';
const plugin: PluginManifest = {
  id: 'local.test.cached-sidebar',
  name: 'Cached sidebar',
  description: 'Show the first adapter used by a declarative plugin',
  author: 'Voyager',
  category: 'other',
  license: 'MIT',
  version: '1.0.0',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://chatgpt.com/*'],
  contributes: {
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'sidebar' },
        className: 'gv-cached-sidebar',
      },
    ],
  },
};
const stops: Array<() => void> = [];

function makeHost(initialAdapter: Promise<SiteAdapter | null> | undefined) {
  const instance = new PluginHost({
    url: location.href,
    initialAdapter,
    sources: [{ id: 'fixture', kind: 'local', list: async () => [plugin] }],
    formFactor: async () => 'desktop',
    requestCatalogRefresh: () => {},
  });
  stops.push(() => instance.stop());
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
});

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  { updates: false, markup: 'renamed' },
  { updates: true, markup: 'renamed' },
  { updates: false, markup: 'same DOM' },
  { updates: true, markup: 'same DOM' },
])(
  'a slow cache read makes plugins drop the cached site adapter: updates $updates, $markup',
  async ({ updates, markup }) => {
    document.body.innerHTML =
      markup === 'same DOM'
        ? '<nav aria-label="Chats" id="cached" class="cached-sidebar"></nav>'
        : '<nav aria-label="Chats"></nav><aside id="cached" class="cached-sidebar"></aside>';
    const state = {
      [StorageKeys.PLUGINS_STATE]: { [plugin.id]: { enabled: true, installedAt: 1 } },
    };
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({
      [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: updates,
    } as never);
    vi.mocked(chrome.storage.local.get).mockResolvedValue(state as never);
    const baseline = makeHost(Promise.resolve(requireBundledSiteAdapter('chatgpt')));
    await baseline.start();
    const baselineTarget = document.querySelector('.gv-cached-sidebar');
    expect(baselineTarget?.tagName).toBe('NAV');
    baseline.stop();

    let finish: (value: Record<string, unknown>) => void = () => {};
    const cacheRead = new Promise<Record<string, unknown>>((resolve) => {
      finish = resolve;
    });
    const cacheKey = hostCatalogStorageKey(host);
    vi.mocked(chrome.storage.local.get).mockImplementation((keys) =>
      typeof keys === 'object' && keys !== null && cacheKey in keys
        ? (cacheRead as never)
        : (Promise.resolve(state) as never),
    );
    const startup = startPageSelectors({
      url: location.href,
      doc: document,
      lifetime: new AbortController().signal,
    });
    stops.push(startup.stop);
    const instance = makeHost(startup.initialAdapter);
    const starting = instance.start();
    await vi.advanceTimersByTimeAsync(600);
    await startup.ready;
    expect(getSiteSelectorView('chatgpt').remoteKeys.size).toBe(0);
    expect(document.querySelector('.gv-cached-sidebar')).toBeNull();

    finish({
      [cacheKey]: {
        host,
        status: 'ok',
        manifests: [],
        extensionVersion: EXTENSION_VERSION,
        fetchedAt: 1,
        lastAttemptAt: 1,
        failureCount: 0,
        site: {
          ...chatgptSite,
          catalogRevision: Number.MAX_SAFE_INTEGER,
          selectors: { ...chatgptSite.selectors, sidebar: '.cached-sidebar' },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await starting;
    const cachedTarget = document.querySelector('#cached');
    expect(Array.from(document.querySelectorAll('.gv-cached-sidebar'))).toEqual([cachedTarget]);
    if (markup === 'same DOM') expect(cachedTarget).toBe(baselineTarget);
    expect(getSiteSelectorView('chatgpt').remoteKeys.size).toBe(0);
    expect(
      vi
        .mocked(chrome.storage.local.get)
        .mock.calls.filter(
          ([keys]) => typeof keys === 'object' && keys !== null && cacheKey in keys,
        ),
    ).toHaveLength(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  },
);
