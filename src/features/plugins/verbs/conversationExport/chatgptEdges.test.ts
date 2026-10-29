// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/abc" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportFormat } from '@/features/export/types/export';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { HostCatalogRefresher } from '@/features/plugins/remote/hostCatalogRefresh';
import { siteAdapterToData } from '@/features/plugins/sites/siteAdapterData';
import { toastDriver } from '@/tests/toastDriver';

import {
  type AcceptancePage,
  FIXED_TIME,
  beginExport,
  button,
  confirmAll,
  fileText,
  openAcceptancePage,
  until,
} from './__tests__/chatgptAcceptanceHarness';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

let page: AcceptancePage | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  history.replaceState(null, '', '/c/abc');
  document.body.replaceChildren();
});

afterEach(async () => {
  await page?.close();
  page = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectFullExport(): Promise<void> {
  await beginExport(ExportFormat.JSON);
  await confirmAll();
  await until(() => page!.files.length === 1);
  await expect(await fileText(page!.files[0].blob)).toMatchFileSnapshot(
    './goldens/chatgpt-thread.json.golden',
  );
}

function readingStarted(): boolean {
  return toastDriver.all().some((toast) => /Turns read: [1-9]/.test(toast.detail));
}

describe('ChatGPT export interruption and fallback through PluginHost', () => {
  it('cancels mid-crawl without a file, restores the reading position and can export again', async () => {
    page = await openAcceptancePage();
    const fromEnd = page.fixture.range() - page.fixture.offset();
    await beginExport(ExportFormat.JSON);
    await until(readingStarted);
    const progress = toastDriver.all().find((toast) => toast.detail.startsWith('Turns read:'));
    if (!progress) throw new Error('Missing cancellable crawl progress');
    toastDriver.press(progress, 'Cancel');
    await until(() => !toastDriver.all().some((toast) => toast.pending));
    expect(page.files).toEqual([]);
    expect(document.querySelector('.gv-export-select-bar')).toBeNull();
    expect(page.fixture.range() - page.fixture.offset()).toBe(fromEnd);
    await expectFullExport();
  });

  it.each([
    ['reading', '/c/another-conversation'],
    ['selecting', '/c/another-conversation'],
    ['reading', '/u/3/c/another-conversation'],
    ['selecting', '/u/3/c/another-conversation'],
  ])(
    'does not export another conversation while %s on %s, then returns safely',
    async (phase, route) => {
      page = await openAcceptancePage();
      await beginExport(ExportFormat.JSON);
      if (phase === 'reading') await until(readingStarted);
      else await until(() => !!document.querySelector('.gv-export-select-bar'));
      history.pushState(null, '', route);
      // The SPA replaces message bodies together with the route.
      page.fixture.replaceTurn('turn-03', { user: 'Another conversation', assistant: 'Unrelated' });
      await until(() => !toastDriver.all().some((toast) => toast.pending));
      await until(() => !document.querySelector('.gv-export-select-bar'));
      expect(page.files).toEqual([]);
      history.pushState(null, '', '/c/abc');
      page.fixture.replaceTurn('turn-03', { user: '谢谢', assistant: 'You are welcome.' });
      await expectFullExport();
    },
  );

  it('disables the plugin during a crawl without leaving controls or exporting a file', async () => {
    page = await openAcceptancePage();
    await beginExport(ExportFormat.JSON);
    await until(readingStarted);
    await page.memory.api.local.set({
      gvPluginsState: { 'voyager.chatgpt-export': { enabled: false, installedAt: 1 } },
    });
    await until(() => !document.querySelector('.gv-persistent-export-btn'));
    await until(() => !toastDriver.all().some((toast) => toast.pending));
    expect(page.files).toEqual([]);
    expect(document.querySelector('.gv-export-select-bar')).toBeNull();
    expect(document.querySelector('.gv-export-dialog')).toBeNull();
  });

  it.each(['network failure', 'rejected site data'])(
    'exports with bundled data after %s',
    async (failure) => {
      page = await openAcceptancePage(undefined, async () => {
        const site = siteAdapterToData(requireBundledSiteAdapter('chatgpt'));
        const refresher = new HostCatalogRefresher({
          enabled: true,
          fetchImpl: async () => {
            if (failure === 'network failure') throw new Error('Catalog offline');
            return new Response(
              JSON.stringify({
                format: 1,
                host: 'chatgpt.com',
                plugins: [],
                site: {
                  ...site,
                  id: 42,
                  catalogRevision: Number.MAX_SAFE_INTEGER,
                  selectors: { ...site.selectors, userTurn: '#foreign-conversation' },
                },
              }),
              { status: 200 },
            );
          },
        });
        await refresher.refresh('chatgpt.com', { force: true });
      });
      await expectFullExport();
      expect(button('.gv-persistent-export-btn').isConnected).toBe(true);
    },
  );
});
