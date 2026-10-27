// @vitest-environment-options {"url":"https://gemini.google.com/app/test"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getSiteSelectorView } from '@/core/selectors';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import geminiSite from '@/features/plugins/catalog/sites/gemini/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';

import { mountSidebar } from '../folder/__tests__/sidebarRuntimeHarness';
import { findSidebarMount } from '../folder/sidebarMountDom';
import { enterInitialization } from '../initializationEntry';
import { startPageSelectors } from '../pageSelectorStartup';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const updatesKey = StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED;
const stops: Array<() => void> = [];
const host = 'gemini.google.com';

function deferred() {
  let resolve: (value: Record<string, unknown>) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<Record<string, unknown>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function cache() {
  return {
    [hostCatalogStorageKey(host)]: {
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
        locators: { 'sidebar.overflow': ['.cached-overflow'] },
      },
    },
  };
}

function queryTrace() {
  const probes = [
    vi.spyOn(document, 'querySelector'),
    vi.spyOn(document, 'querySelectorAll'),
    vi.spyOn(Element.prototype, 'querySelector'),
    vi.spyOn(Element.prototype, 'querySelectorAll'),
  ];
  return {
    clear: () => probes.forEach((probe) => probe.mockClear()),
    reads: () =>
      probes
        .flatMap((probe, kind) =>
          probe.mock.calls.map(([selector], index) => ({
            kind,
            selector,
            order: probe.mock.invocationCallOrder[index],
          })),
        )
        .sort((a, b) => a.order - b.order)
        .map(({ kind, selector }) => ({ kind, selector })),
  };
}

function schedule(onMount: () => void = () => {}) {
  const began = Date.now();
  const startup = startPageSelectors({
    url: location.href,
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  let first: { at: number; mount: ReturnType<typeof findSidebarMount> } | undefined;
  const entering = enterInitialization(location, document, {
    settle: async (work) => work,
    readCoverage: async () => false,
    beforeMount: () => startup.ready,
    followCoverage: async () => {},
    mountEdgeNotice: async () => {
      first = { at: Date.now() - began, mount: findSidebarMount('above-recents') };
      onMount();
    },
    startEnterprisePanel: async () => {},
  });
  return { startup, entering, first: () => first };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({ [updatesKey]: true } as never);
});

afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['OFF', 'build off', 'missing cache', 'unchanged cache', 'failed cache'])(
  'a cached remote locator is ignored on the first load: %s preserves bundled mount and query order',
  async (mode) => {
    const { sidebar, recentsSection } = mountSidebar();
    sidebar.className = 'cached-overflow';
    const trace = queryTrace();
    const baseline = findSidebarMount('above-recents');
    const baselineReads = trace.reads();
    expect(baseline?.sidebar).toBe(sidebar);
    const local = deferred();
    const settings = deferred();
    vi.mocked(chrome.storage.local.get).mockImplementation(() => local.promise as never);
    vi.mocked(chrome.storage.sync.get).mockImplementation(() => settings.promise as never);
    if (mode === 'build off') vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'off');
    trace.clear();
    let firstReads: ReturnType<typeof trace.reads> = [];
    const page = schedule(() => {
      firstReads = trace.reads();
    });
    await vi.advanceTimersByTimeAsync(mode === 'build off' ? 0 : 15);
    if (mode === 'OFF') settings.resolve({ [updatesKey]: false });
    if (mode === 'missing cache') local.resolve({});
    if (mode === 'unchanged cache') {
      const stored = cache();
      stored[hostCatalogStorageKey(host)].site.locators = {
        'sidebar.overflow': ['[data-test-id="overflow-container"]'],
      };
      local.resolve(stored);
    }
    if (mode === 'failed cache') local.reject(new Error('Storage unavailable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(page.first()?.at).toBe(mode === 'build off' ? 0 : 15);
    expect(page.first()?.mount?.sidebar).toBe(sidebar);
    expect(page.first()?.mount?.anchor).toBe(recentsSection);
    expect(firstReads).toEqual(baselineReads);
    await page.entering;
    trace.clear();
    local.resolve(cache());
    settings.resolve({ [updatesKey]: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
    expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
    expect(trace.reads()).toEqual(baselineReads);
    if (mode === 'OFF')
      expect((await page.startup.initialAdapter)?.locators?.['sidebar.overflow']).toEqual([
        '.cached-overflow',
      ]);
  },
);

it.each(['cache', 'settings'])(
  'a cached remote locator is ignored on the first load: a hung %s releases the bundled feature at 250 ms',
  async (hung) => {
    const { sidebar, recentsSection } = mountSidebar();
    const pending = deferred();
    if (hung === 'cache')
      vi.mocked(chrome.storage.local.get).mockImplementation(() => pending.promise as never);
    else {
      vi.mocked(chrome.storage.local.get).mockResolvedValue(cache() as never);
      vi.mocked(chrome.storage.sync.get).mockImplementation(() => pending.promise as never);
    }
    const page = schedule();
    await vi.advanceTimersByTimeAsync(249);
    expect(page.first()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(page.first()?.at).toBe(250);
    expect(page.first()?.mount?.sidebar).toBe(sidebar);
    expect(page.first()?.mount?.anchor).toBe(recentsSection);
    await page.entering;
    let pluginAdapter: Awaited<typeof page.startup.initialAdapter>;
    void page.startup.initialAdapter?.then((adapter) => {
      pluginAdapter = adapter;
    });
    await vi.advanceTimersByTimeAsync(0);
    if (hung === 'cache') expect(pluginAdapter).toBeUndefined();
    else expect(pluginAdapter?.id).toBe('gemini');
    pending.resolve(hung === 'cache' ? cache() : { [updatesKey]: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(pluginAdapter?.locators?.['sidebar.overflow']).toEqual(['.cached-overflow']);
    expect(getSiteSelectorView('gemini').remoteKeys.size).toBe(0);
    expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
  },
);

it('a cached remote locator is ignored on the first load: rejected settings release a pending cache', async () => {
  const { sidebar } = mountSidebar();
  const pending = deferred();
  vi.mocked(chrome.storage.local.get).mockImplementation(() => new Promise(() => {}) as never);
  vi.mocked(chrome.storage.sync.get).mockImplementation(() => pending.promise as never);
  const page = schedule();
  await vi.advanceTimersByTimeAsync(15);
  pending.reject(new Error('Extension context invalidated.'));
  await vi.advanceTimersByTimeAsync(0);
  expect(page.first()?.at).toBe(15);
  expect(page.first()?.mount?.sidebar).toBe(sidebar);
  await page.entering;
});

it('a cached remote locator is ignored on the first load: ordinary settings errors retain legacy defaults without a timeout wait', async () => {
  const { sidebar } = mountSidebar();
  sidebar.className = 'cached-overflow';
  const pending = deferred();
  vi.mocked(chrome.storage.local.get).mockResolvedValue(cache() as never);
  vi.mocked(chrome.storage.sync.get).mockImplementation(() => pending.promise as never);
  const page = schedule();
  await vi.advanceTimersByTimeAsync(15);
  pending.reject(new Error('Storage unavailable'));
  await vi.advanceTimersByTimeAsync(0);
  expect(page.first()?.at).toBe(15);
  expect(page.first()?.mount?.sidebar).toBe(sidebar);
  expect(page.first()?.mount?.view.remoteKeys.has('sidebar.overflow')).toBe(true);
  await page.entering;
});
