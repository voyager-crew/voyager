import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getSiteSelectorView } from '@/core/selectors';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { HostCatalogSource } from '@/features/plugins/remote/HostCatalogSource';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import type { PluginManifest } from '@/features/plugins/types';

import { startPageSelectors } from '../pageSelectorStartup';

const stops: Array<() => void> = [];
const host = 'chatgpt.com';
const cacheKey = hostCatalogStorageKey(host);
const plugin: PluginManifest = {
  id: 'voyager.startup-parity',
  name: 'Startup parity',
  description: 'Fixture',
  author: 'Voyager',
  category: 'other',
  license: 'MIT',
  version: '1.0.0',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://chatgpt.com/*'],
  contributes: { styles: [{ css: '.gv-startup-parity{color:red}' }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
  } as never);
});

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.unstubAllEnvs();
});

it('OFF keeps cached adapter data on first paint and does not remount it on a catalog reload', async () => {
  let cached = {
    host,
    status: 'ok',
    manifests: [plugin],
    extensionVersion: EXTENSION_VERSION,
    fetchedAt: 1,
    lastAttemptAt: 1,
    failureCount: 0,
    site: {
      ...chatgptSite,
      catalogRevision: Number.MAX_SAFE_INTEGER,
      selectors: { ...chatgptSite.selectors, userTurn: '.repaired-user' },
      projects: { ...chatgptSite.projects, createButton: '#repaired-project-button' },
    },
  };
  const arriving: PluginManifest = {
    ...plugin,
    id: 'voyager.reload-parity',
    contributes: {
      domOps: [
        {
          op: 'setAttribute',
          target: { kind: 'css', selector: 'body' },
          name: 'data-reload-parity',
          value: 'applied',
        },
      ],
    },
  };
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
    [cacheKey]: cached,
    [StorageKeys.PLUGINS_STATE]: {
      [plugin.id]: { enabled: true, installedAt: 1 },
      [arriving.id]: { enabled: true, installedAt: 1 },
    },
  }));
  const startup = startPageSelectors({
    url: 'https://chatgpt.com/c/test',
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  const adapter = await startup.initialAdapter;
  expect(adapter?.selectors.userTurn).toBe('.repaired-user');
  expect(adapter?.projects?.createButton).toBe('#repaired-project-button');
  expect(getSiteSelectorView('chatgpt').profiles.userTurn).toEqual([
    requireBundledSiteAdapter('chatgpt').selectors.userTurn,
  ]);
  const pluginHost = new PluginHost({
    url: 'https://chatgpt.com/c/test',
    doc: document,
    initialAdapter: startup.initialAdapter,
    legacySettings: startup.legacySettings,
    sources: [new HostCatalogSource()],
    formFactor: async () => 'desktop',
    requestCatalogRefresh: () => {},
  });
  stops.push(() => pluginHost.stop());
  await pluginHost.start();
  const style = Array.from(document.querySelectorAll('style')).find((node) =>
    node.textContent?.includes('.gv-startup-parity'),
  );
  expect(style?.isConnected).toBe(true);
  const previous = cached;
  cached = { ...cached, manifests: [plugin, arriving] };
  for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    listener({ [cacheKey]: { oldValue: previous, newValue: cached } }, 'local');
  }
  await vi.waitFor(() => expect(document.body.dataset.reloadParity).toBe('applied'));
  expect(pluginHost.activeAdapter?.projects?.createButton).toBe('#repaired-project-button');
  expect(style?.isConnected).toBe(true);
  expect(pluginHost.activeAdapter).toEqual(adapter);
});
