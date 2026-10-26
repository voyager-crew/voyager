// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/delayed-settings" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { HostCatalogSource } from '@/features/plugins/remote/HostCatalogSource';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import type { PluginManifest } from '@/features/plugins/types';

import { startPageSelectors } from '../pageSelectorStartup';

const host = 'chatgpt.com';
const cacheKey = hostCatalogStorageKey(host);
const updatesKey = StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED;
const stops: Array<() => void> = [];
type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
const listeners = new Set<StorageListener>();
const plugin: PluginManifest = {
  id: 'voyager.delayed-send',
  name: 'Delayed send',
  description: 'Fixture',
  author: 'Voyager',
  category: 'other',
  license: 'MIT',
  version: '1.0.0',
  engine: '>=1.9.0',
  tier: 'declarative',
  matches: ['https://chatgpt.com/*'],
  contributes: { domOps: [{ op: 'native', handler: 'sendShortcut', params: {} }] },
};

function cache(selectors: Record<string, string> = {}) {
  return {
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
      selectors: { ...chatgptSite.selectors, ...selectors },
    },
  };
}

let cached: ReturnType<typeof cache> | undefined;

function deferredSettings() {
  let resolve: (value: Record<string, unknown>) => void = () => {};
  const promise = new Promise<Record<string, unknown>>((finish) => {
    resolve = finish;
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(() => promise as never);
  return (enabled: boolean) => resolve({ [updatesKey]: enabled });
}

function changed(
  changes: Record<string, chrome.storage.StorageChange>,
  area: Parameters<StorageListener>[1],
): void {
  // Match an event dispatch: listeners added during delivery belong to the next event.
  const pending = [...listeners];
  for (const listener of pending) listener(changes, area);
}

async function start() {
  const startup = startPageSelectors({
    url: document.location.href,
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  // Both readiness and unbound plugin startup must finish while settings are unresolved.
  await startup.ready;
  const pluginHost = new PluginHost({
    url: document.location.href,
    doc: document,
    initialAdapter: startup.initialAdapter,
    legacySettings: startup.legacySettings,
    sources: [new HostCatalogSource()],
    formFactor: async () => 'desktop',
    requestCatalogRefresh: () => {},
  });
  stops.push(() => pluginHost.stop());
  await pluginHost.start();
  return { startup, pluginHost };
}

async function reloadWithUploadRoot(pluginHost: PluginHost): Promise<void> {
  const previous = cached;
  cached = cache({ composerRoot: '.catalog-root' });
  changed({ [cacheKey]: { oldValue: previous, newValue: cached } }, 'local');
  await vi.waitFor(() => {
    expect(pluginHost.activeAdapter?.selectors.composerRoot).toBe('.catalog-root');
    expect(pluginHost.getStatuses()).toEqual([
      expect.objectContaining({ id: plugin.id, kind: 'mounted' }),
    ]);
  });
}

function send(): void {
  document.getElementById('prompt-textarea')!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function clicks() {
  const observed = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('button')!.addEventListener('click', observed);
  return observed;
}

beforeEach(() => {
  vi.clearAllMocks();
  cached = undefined;
  listeners.clear();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
    ...(cached ? { [cacheKey]: cached } : {}),
    [StorageKeys.PLUGINS_STATE]: { [plugin.id]: { enabled: true, installedAt: 1 } },
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 300,
    height: 40,
  } as DOMRect);
  document.body.innerHTML =
    '<div class="catalog-root"><progress></progress><form><div id="prompt-textarea" contenteditable="true">Draft</div><button type="submit">Send</button></form></div>';
});

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { initial: 'missing', enabled: false },
  { initial: 'unchanged', enabled: false },
  { initial: 'missing', enabled: true },
  { initial: 'unchanged', enabled: true },
])(
  'a delayed updates=$enabled read after $initial cache keeps the correct upload owner on reload',
  async ({ initial, enabled }) => {
    if (initial === 'unchanged') cached = cache();
    const finishSettings = deferredSettings();
    const { startup, pluginHost } = await start();
    finishSettings(enabled);
    await startup.legacySettings!.load();
    await reloadWithUploadRoot(pluginHost);
    const observed = clicks();
    send();
    expect(observed).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(document.getElementById('prompt-textarea')?.textContent).toBe('Draft');
    document.querySelector('progress')!.remove();
    send();
    expect(observed).toHaveBeenCalledTimes(enabled ? 2 : 1);
  },
);

it('a stale OFF read cannot adopt a cached upload owner after updates changed to ON', async () => {
  const finishSettings = deferredSettings();
  const { startup, pluginHost } = await start();
  changed({ [updatesKey]: { oldValue: false, newValue: true } }, 'sync');
  finishSettings(false);
  await startup.legacySettings!.load();
  await reloadWithUploadRoot(pluginHost);
  const observed = clicks();
  send();
  expect(observed).toHaveBeenCalledTimes(1);
  document.querySelector('progress')!.remove();
  send();
  expect(observed).toHaveBeenCalledTimes(2);
});

it('a retired page’s late OFF read cannot change its replacement’s ON send owner', async () => {
  const finishOldSettings = deferredSettings();
  const old = await start();
  old.pluginHost.stop();
  old.startup.stop();
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({ [updatesKey]: true } as never);
  const current = await start();
  await current.startup.legacySettings!.load();
  finishOldSettings(false);
  await old.startup.legacySettings!.load();
  await reloadWithUploadRoot(current.pluginHost);
  const observed = clicks();
  send();
  expect(observed).toHaveBeenCalledTimes(1);
  document.querySelector('progress')!.remove();
  send();
  expect(observed).toHaveBeenCalledTimes(2);
});
