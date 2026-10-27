// @vitest-environment-options {"url":"https://gemini.google.com/app/0000000000000001"}
import { afterEach, expect, it, vi } from 'vitest';

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
vi.mock('@/features/plugins/catalog/sites/gemini/selector-data/sidebar.json', async (original) => {
  const data = await original<{ default: Record<string, readonly string[]> }>();
  return { default: { ...data.default, 'sidebar.overflow': ['.broken-bundled-overflow'] } };
});

const stops: Array<() => void> = [];
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

it('a cached sidebar repair mounts folders on the first load when the whole Gemini app is inside main', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
  } as never);
  const { sidebar, recentsSection } = mountSidebar(24);
  expect(findSidebarMount('above-recents')).toBeNull();
  let finish: (data: Record<string, unknown>) => void = () => {};
  vi.mocked(chrome.storage.local.get).mockImplementationOnce(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
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
  finish({
    [hostCatalogStorageKey('gemini.google.com')]: {
      host: 'gemini.google.com',
      status: 'ok',
      manifests: [],
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      site: {
        ...geminiSite,
        catalogRevision: Number.MAX_SAFE_INTEGER,
        locators: { 'sidebar.overflow': ['[data-test-id="overflow-container"]'] },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);

  expect(firstRead?.sidebar).toBe(sidebar);
  expect(firstRead?.view.remoteKeys.has('sidebar.overflow')).toBe(true);
  expect(harness.runtime.sidebar).toBe(sidebar);
  expect(sidebar.contains(harness.runtime.panel)).toBe(true);
  expect(harness.runtime.panel?.nextElementSibling).toBe(recentsSection);
  await entering;
});
