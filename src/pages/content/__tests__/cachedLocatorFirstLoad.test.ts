// @vitest-environment-options {"url":"https://gemini.google.com/app/test"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import geminiSite from '@/features/plugins/catalog/sites/gemini/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';

import {
  createSidebarRuntimeHarness,
  mountSidebar,
} from '../folder/__tests__/sidebarRuntimeHarness';
import { findSidebarMount } from '../folder/sidebarMountDom';
import { enterInitialization } from '../initializationEntry';
import { startPageSelectors } from '../pageSelectorStartup';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const host = 'gemini.google.com';
const stops: Array<() => void> = [];

function cached() {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
  } as never);
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

it.each(['renamed', 'same DOM'])(
  'a cached remote locator is ignored on the first load: Gemini %s folder sidebar',
  async (markup) => {
    const { sidebar, recentsSection } = mountSidebar();
    sidebar.className = 'cached-overflow';
    const bundled = findSidebarMount('above-recents');
    if (markup === 'renamed') sidebar.removeAttribute('data-test-id');
    let finish: (value: ReturnType<typeof cached>) => void = () => {};
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof cached>>((resolve) => {
          finish = resolve;
        }) as never,
    );
    const startup = startPageSelectors({
      url: location.href,
      doc: document,
      lifetime: new AbortController().signal,
    });
    stops.push(startup.stop);
    const harness = createSidebarRuntimeHarness();
    stops.push(() => harness.runtime.stop());
    let firstRead: ReturnType<typeof findSidebarMount> | undefined;
    // Foreground entry is scheduled before the extension's local cache responds.
    const entering = enterInitialization(location, document, {
      settle: async (work) => work,
      readCoverage: async () => false,
      beforeMount: () => startup.ready,
      followCoverage: async () => {},
      mountEdgeNotice: async () => {},
      startEnterprisePanel: async () => {},
    }).then(() => {
      firstRead = findSidebarMount('above-recents');
      return harness.runtime.start('sidebar');
    });
    await vi.advanceTimersByTimeAsync(20);
    finish(cached());
    await vi.advanceTimersByTimeAsync(0);
    expect(firstRead?.sidebar).toBe(sidebar);
    expect(firstRead?.view.remoteKeys.has('sidebar.overflow')).toBe(true);
    expect(harness.runtime.sidebar).toBe(sidebar);
    expect(harness.runtime.panel?.nextElementSibling).toBe(recentsSection);
    await entering;
    if (markup === 'same DOM') {
      expect(harness.runtime.sidebar).toBe(bundled?.sidebar);
      expect(harness.runtime.panel?.nextElementSibling).toBe(bundled?.anchor);
    }
  },
);
