import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { pageSemanticSelector } from '@/core/selectors';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import claudeSite from '@/features/plugins/catalog/sites/claude/site.json';
import deepseekSite from '@/features/plugins/catalog/sites/deepseek/site.json';
import kimiSite from '@/features/plugins/catalog/sites/kimi/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { isSemanticSelectorKey } from '@/features/plugins/sites/semanticKeys';

import { startPageSelectors } from '../pageSelectorStartup';

const stops: Array<() => void> = [];
const sites = [
  ['chatgpt', 'chatgpt.com', chatgptSite],
  ['claude', 'claude.ai', claudeSite],
  ['deepseek', 'chat.deepseek.com', deepseekSite],
  ['kimi', 'www.kimi.com', kimiSite],
] as const;

beforeEach(() => {
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
  } as never);
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

it.each(sites)(
  'OFF retains every cached %s semantic contract target through real startup',
  async (siteId, host, bundle) => {
    const keys = getSiteSelectorContract(siteId)!.keys.filter(isSemanticSelectorKey);
    expect(keys.length).toBeGreaterThan(0);
    const overrides = Object.fromEntries(keys.map((key) => [key, `[data-cached="${key}"]`]));
    document.body.innerHTML = keys
      .map((key) => `<section data-cached="${key}">Cached ${key}</section>`)
      .join('');
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [hostCatalogStorageKey(host)]: {
        host,
        status: 'ok',
        manifests: [],
        extensionVersion: EXTENSION_VERSION,
        fetchedAt: 1,
        lastAttemptAt: 1,
        failureCount: 0,
        site: {
          ...bundle,
          catalogRevision: Number.MAX_SAFE_INTEGER,
          selectors: { ...bundle.selectors, ...overrides },
        },
      },
    } as never);
    const startup = startPageSelectors({
      url: `https://${host}/`,
      doc: document,
      lifetime: new AbortController().signal,
    });
    stops.push(startup.stop);
    const adapter = await startup.initialAdapter;
    if (!adapter) throw new Error('Expected the cached adapter');
    for (const key of keys) {
      const selector = pageSemanticSelector(adapter, key)!;
      expect(document.querySelector(selector)?.textContent).toBe(`Cached ${key}`);
    }
  },
);

it('OFF keeps a cached composer usable when the native mount precedes the cache response', async () => {
  let finish: (value: object) => void = () => {};
  vi.mocked(chrome.storage.local.get).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const startup = startPageSelectors({
    url: 'https://claude.ai/',
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  await startup.legacySettings!.load();
  await startup.ready;
  const bundle = claudeSite;
  finish({
    [hostCatalogStorageKey('claude.ai')]: {
      host: 'claude.ai',
      status: 'ok',
      manifests: [],
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      site: {
        ...bundle,
        catalogRevision: Number.MAX_SAFE_INTEGER,
        selectors: { ...bundle.selectors, composer: '#cached-input' },
      },
    },
  });
  const adapter = await startup.initialAdapter;
  if (!adapter) throw new Error('Expected the cached adapter');
  document.body.innerHTML = '<textarea id="cached-input">Saved draft</textarea>';
  expect(document.querySelector(pageSemanticSelector(adapter, 'composer')!)?.textContent).toBe(
    'Saved draft',
  );
});
