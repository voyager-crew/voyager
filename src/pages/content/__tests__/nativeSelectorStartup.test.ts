// @vitest-environment-options {"url":"https://gemini.google.com/app/test"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getSiteSelectorView } from '@/core/selectors';
import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { EXTENSION_VERSION } from '@/core/utils/version';
import geminiSite from '@/features/plugins/catalog/sites/gemini/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';

import { enterInitialization } from '../initializationEntry';
import { startPageSelectors } from '../pageSelectorStartup';
import { createPromptManagerEngine } from '../prompt/promptManagerEngine';
import { resolvePromptSiteAdapter } from '../prompt/resolvePromptSiteAdapter';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));

const host = 'gemini.google.com';
const url = `https://${host}/app/test`;
const cacheKey = hostCatalogStorageKey(host);
const prompt = { id: 'review', name: 'Review', text: 'Review this change' };
const stops: Array<() => void> = [];
let cleanup: CleanupManager;

function cache() {
  return {
    [cacheKey]: {
      host,
      status: 'ok',
      manifests: [],
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      site: {
        ...geminiSite,
        catalogRevision: Number.MAX_SAFE_INTEGER,
        locators: { 'sentChips.bubbles': ['.repaired-bubble'] },
      },
    },
  };
}

function start() {
  const startup = startPageSelectors({
    url,
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  const engine = createPromptManagerEngine(resolvePromptSiteAdapter(url), cleanup);
  return { startup, engine };
}

function localRead(catalog: Promise<Record<string, unknown>>): void {
  vi.mocked(chrome.storage.local.get).mockImplementation(((
    keys: unknown,
    callback?: (values: Record<string, unknown>) => void,
  ) => {
    if (keys && typeof keys === 'object' && cacheKey in keys) return catalog;
    const values = { [StorageKeys.PROMPT_ITEMS]: [prompt] };
    callback?.(values);
    return Promise.resolve(values);
  }) as typeof chrome.storage.local.get);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
  } as never);
  cleanup = new CleanupManager();
  document.body.innerHTML =
    '<user-query class="repaired-bubble"><span class="user-query-bubble-with-background"><div class="query-text"><p class="query-text-line">Review this change</p></div></span></user-query>';
});

afterEach(() => {
  cleanup.executeCleanups();
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it.each([true, false])(
  'native features mount without advancing the catalog deadline with updates %s',
  async (enabled) => {
    vi.useFakeTimers();
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({
      [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: enabled,
    } as never);
    let finish: (value: Record<string, unknown>) => void = () => {};
    localRead(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { startup, engine } = start();
    await engine.startComposerFeatures(startup.useAvailableSnapshot);
    expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
    expect(document.getElementById('gv-pm-slash-root')).not.toBeNull();
    expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
    finish(cache());
    await startup.initialAdapter;
    expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
    expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
  },
);

it('a cache available during the existing native setting read repairs the first mounted chips', async () => {
  let release: (value: Record<string, unknown>) => void = () => {};
  const nativeSetting = new Promise<Record<string, unknown>>((resolve) => {
    release = resolve;
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(((keys: unknown) =>
    keys && typeof keys === 'object' && StorageKeys.SLASH_PROMPT_ENABLED in keys
      ? nativeSetting
      : Promise.resolve({
          [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
        })) as typeof chrome.storage.sync.get);
  localRead(Promise.resolve(cache()));
  document
    .querySelector('.user-query-bubble-with-background')
    ?.classList.remove('user-query-bubble-with-background');
  const { startup, engine } = start();
  const mounting = engine.startComposerFeatures(startup.useAvailableSnapshot);
  await startup.ready;
  release({ [StorageKeys.SLASH_PROMPT_ENABLED]: true });
  await mounting;
  expect(getSiteSelectorView('gemini').remoteKeys.has('sentChips.bubbles')).toBe(true);
  expect(document.querySelector('.repaired-bubble .gv-pm-sent-chip')?.textContent).toBe('Review');
});

it('native entry gates proceed with the available snapshot while a catalog read is pending', async () => {
  vi.useFakeTimers();
  let finish: (value: Record<string, unknown>) => void = () => {};
  localRead(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { startup } = start();
  const notice = document.createElement('div');
  notice.textContent = 'Native notice';
  const entry = await enterInitialization(window.location, document, {
    settle: async (work) => work,
    readCoverage: async () => false,
    beforeMount: startup.useAvailableSnapshot,
    followCoverage: async () => {},
    mountEdgeNotice: async () => {
      document.body.append(notice);
    },
    startEnterprisePanel: async () => {},
  });
  expect(entry).toBe('start-points');
  expect(notice.isConnected).toBe(true);
  finish(cache());
  await startup.initialAdapter;
  expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
});

it('a live slash enable during its initial read freezes the snapshot before mounting', async () => {
  let releaseSetting: (value: Record<string, unknown>) => void = () => {};
  const setting = new Promise<Record<string, unknown>>((resolve) => {
    releaseSetting = resolve;
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(((keys: unknown) =>
    keys && typeof keys === 'object' && StorageKeys.SLASH_PROMPT_ENABLED in keys
      ? setting
      : Promise.resolve({
          [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
        })) as typeof chrome.storage.sync.get);
  let releaseCache: (value: Record<string, unknown>) => void = () => {};
  localRead(
    new Promise((resolve) => {
      releaseCache = resolve;
    }),
  );
  const { startup, engine } = start();
  const mounting = engine.startComposerFeatures(startup.useAvailableSnapshot);
  for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    listener({ [StorageKeys.SLASH_PROMPT_ENABLED]: { newValue: true } }, 'sync');
  }
  await vi.waitFor(() => expect(document.getElementById('gv-pm-slash-root')).not.toBeNull());
  releaseCache(cache());
  await startup.initialAdapter;
  releaseSetting({ [StorageKeys.SLASH_PROMPT_ENABLED]: false });
  await mounting;
  expect(document.getElementById('gv-pm-slash-root')).not.toBeNull();
  expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
  expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
});

it('disabled slash still freezes the page before sent-prompt chips mount', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
    [StorageKeys.SLASH_PROMPT_ENABLED]: false,
  } as never);
  let finish: (value: Record<string, unknown>) => void = () => {};
  localRead(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { startup, engine } = start();
  await engine.startComposerFeatures(startup.useAvailableSnapshot);
  expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
  finish(cache());
  await startup.initialAdapter;
  expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
  expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
});

it.each([true, false])(
  'an immediately resolved cache reaches the first foreground native mount with updates %s',
  async (enabled) => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({
      [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: enabled,
    } as never);
    localRead(Promise.resolve(cache()));
    if (enabled)
      document
        .querySelector('.user-query-bubble-with-background')
        ?.classList.remove('user-query-bubble-with-background');
    const { startup, engine } = start();
    // PluginHost opens the shared settings feed before foreground native initialization starts.
    void startup.legacySettings!.load();
    await engine.startComposerFeatures(startup.useAvailableSnapshot);
    expect(getSiteSelectorView('gemini').remoteKeys.has('sentChips.bubbles')).toBe(enabled);
    expect(document.querySelector('.repaired-bubble .gv-pm-sent-chip')?.textContent).toBe('Review');
  },
);

it('native startup never assumes an unresolved online switch is enabled', async () => {
  let release: (value: Record<string, unknown>) => void = () => {};
  const setting = new Promise<Record<string, unknown>>((resolve) => {
    release = resolve;
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(((keys: unknown) =>
    Array.isArray(keys) && keys.includes(StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED)
      ? setting
      : Promise.resolve({})) as typeof chrome.storage.sync.get);
  localRead(Promise.resolve(cache()));
  const { startup, engine } = start();
  void startup.legacySettings!.load();
  await engine.startComposerFeatures(startup.useAvailableSnapshot);
  expect(document.querySelector('.gv-pm-sent-chip')?.textContent).toBe('Review');
  expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
  release({ [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true });
  await startup.initialAdapter;
  expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
});
