// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/u/3/app/abc" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { ExportFormat } from '@/features/export/types/export';
import { toastDriver } from '@/tests/toastDriver';

import { GEMINI_ACCEPTANCE_ROUTE } from './__tests__/geminiAcceptanceFixture';
import {
  FIXED_TIME,
  type GeminiAcceptancePage,
  beginExport,
  button,
  confirmSelection,
  fileText,
  openGeminiPage,
  until,
} from './__tests__/geminiAcceptanceHarness';

const PENDING_RUN = 'gv_export_pending';
const ENTRY_CONTROLS =
  '.gv-persistent-export-btn, .gv-export-conversation-menu-btn, .gv-export-response-menu-btn, [data-test-id="gv-copy-image-button"]';
const OTHER_CONVERSATION = `
  <div class="conversation-container" id="r_cccccccc03">
    <user-query><div class="user-query-container"><div class="query-text-line">Another account's question</div></div></user-query>
    <model-response><div class="response-container"><message-content><div class="markdown"><p>Unrelated answer.</p></div></message-content></div></model-response>
  </div>`;

let page: GeminiAcceptancePage | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  history.replaceState(null, '', GEMINI_ACCEPTANCE_ROUTE);
  document.body.replaceChildren();
  sessionStorage.clear();
});

afterEach(async () => {
  await page?.close();
  page = null;
  document.body.replaceChildren();
  document.body.className = '';
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectOriginalExport(): Promise<void> {
  await beginExport(ExportFormat.JSON);
  await confirmSelection();
  await until(() => page!.files.length === 1);
  await expect(await fileText(page!.files[0].blob)).toMatchFileSnapshot(
    './goldens/gemini.json.golden',
  );
}

async function expectNoPendingExport(): Promise<void> {
  await until(() => !document.querySelector('.gv-export-select-bar'));
  await until(() => !toastDriver.all().some((toast) => toast.pending));
  expect(page!.files).toEqual([]);
}

async function publishGeminiLocators(locators: Record<string, readonly string[]>): Promise<void> {
  const [{ requireBundledSiteAdapter }, { HostCatalogRefresher }, { siteAdapterToData }] =
    await Promise.all([
      import('@/features/plugins/catalog/sites'),
      import('@/features/plugins/remote/hostCatalogRefresh'),
      import('@/features/plugins/sites/siteAdapterData'),
    ]);
  const site = siteAdapterToData(requireBundledSiteAdapter('gemini'));
  const refresher = new HostCatalogRefresher({
    enabled: true,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          format: 1,
          host: 'gemini.google.com',
          plugins: [],
          site: {
            ...site,
            catalogRevision: Number.MAX_SAFE_INTEGER,
            locators: { ...site.locators, ...locators },
          },
        }),
        { status: 200 },
      ),
  });
  await refresher.refresh('gemini.google.com', { force: true });
}

describe('Gemini export interruption and fallback through PluginHost', () => {
  it('cancels selection without a file and exports the same conversation on retry', async () => {
    page = await openGeminiPage();
    await beginExport(ExportFormat.JSON);
    await until(() => !!document.querySelector('.gv-export-select-bar'));
    button('[data-gv-export-action="selectAll"]').click();
    button('.gv-export-select-cancel-btn').click();
    await expectNoPendingExport();

    await expectOriginalExport();
  });

  it('turns off during history loading without leaving entries or restarting its stored run', async () => {
    page = await openGeminiPage();
    const menu = page.fixture.openConversationMenu();
    await until(() => !!menu.querySelector('.gv-export-conversation-menu-btn'));
    await beginExport(ExportFormat.JSON);
    await until(() => sessionStorage.getItem(PENDING_RUN) !== null);
    const pending = sessionStorage.getItem(PENDING_RUN);
    expect(document.querySelector('.gv-export-select-bar')).toBeNull();

    await page.memory.api.sync.set({ [StorageKeys.GEMINI_EXPORT_ENABLED]: false });
    await until(() => !document.querySelector(ENTRY_CONTROLS));
    await expectNoPendingExport();
    expect(document.querySelector('.gv-export-dialog')).toBeNull();
    expect(sessionStorage.getItem(PENDING_RUN)).toBe(pending);

    await page.memory.api.sync.set({ [StorageKeys.GEMINI_EXPORT_ENABLED]: true });
    await until(() => !!document.querySelector('.gv-persistent-export-btn'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('.gv-export-select-bar')).toBeNull();
    expect(page.files).toEqual([]);
    expect(sessionStorage.getItem(PENDING_RUN)).toBe(pending);
    await expectOriginalExport();
  });

  it.each(['/u/3/app/other', '/u/4/app/abc'])(
    'drops the selection on %s and exports the original conversation after returning',
    async (route) => {
      page = await openGeminiPage();
      await beginExport(ExportFormat.JSON);
      await until(() => !!document.querySelector('.gv-export-select-bar'));
      button('[data-gv-export-action="selectAll"]').click();
      history.pushState(null, '', route);
      page.fixture.replaceConversation(OTHER_CONVERSATION);
      await expectNoPendingExport();

      history.pushState(null, '', GEMINI_ACCEPTANCE_ROUTE);
      page.fixture.replaceConversation();
      await expectOriginalExport();
    },
  );

  it('rejects a build whose Library read returns after leaving the account', async () => {
    page = await openGeminiPage();
    await beginExport(ExportFormat.JSON);
    await until(() => !!document.querySelector('.gv-export-select-bar'));
    const delayed: { complete?: () => void } = {};
    const response = { ok: true, messages: [], data: { messages: {} } };
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((...args: unknown[]) => {
      const message = args[0];
      const callback = args.find((argument) => typeof argument === 'function');
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'gv.starred.getAll' &&
        typeof callback === 'function'
      ) {
        delayed.complete = () => callback(response);
      } else if (typeof callback === 'function') callback(response);
      return Promise.resolve(response);
    });
    await confirmSelection();
    await until(() => !!delayed.complete);
    history.pushState(null, '', '/u/4/app/abc');
    page.fixture.replaceConversation(OTHER_CONVERSATION);
    if (!delayed.complete) throw new Error('The Library read did not reach the browser boundary');
    delayed.complete();
    await until(() => toastDriver.all().some((toast) => toast.tone === 'error'));
    await expectNoPendingExport();

    // Subsequent reads settle normally, so the original account can export again.
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((...args: unknown[]) => {
      const callback = args.find((argument) => typeof argument === 'function');
      if (typeof callback === 'function') callback(response);
      return Promise.resolve(response);
    });
    history.pushState(null, '', GEMINI_ACCEPTANCE_ROUTE);
    page.fixture.replaceConversation();
    await expectOriginalExport();
  });

  it.each(['network failure', 'rejected site data'])(
    'exports the bundled conversation after %s',
    async (failure) => {
      page = await openGeminiPage({
        beforeStart: async () => {
          const [{ requireBundledSiteAdapter }, { HostCatalogRefresher }, { siteAdapterToData }] =
            await Promise.all([
              import('@/features/plugins/catalog/sites'),
              import('@/features/plugins/remote/hostCatalogRefresh'),
              import('@/features/plugins/sites/siteAdapterData'),
            ]);
          const site = siteAdapterToData(requireBundledSiteAdapter('gemini'));
          const refresher = new HostCatalogRefresher({
            enabled: true,
            fetchImpl: async () => {
              if (failure === 'network failure') throw new Error('Catalog offline');
              return new Response(
                JSON.stringify({
                  format: 1,
                  host: 'gemini.google.com',
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
          await refresher.refresh('gemini.google.com', { force: true });
        },
      });
      await expectOriginalExport();
      expect(button('.gv-persistent-export-btn').isConnected).toBe(true);
    },
  );

  it('exports every turn when accepted catalog locators cover only the first prompt', async () => {
    page = await openGeminiPage({
      beforeStart: () =>
        publishGeminiLocators({
          'turn.user': ['#r_aaaaaaaa01 .user-query-container'],
          'turn.userWithHosts': ['#r_aaaaaaaa01 user-query'],
          'content.answer': ['message-content > .markdown > p:first-of-type'],
        }),
    });
    await expectOriginalExport();
  });

  it('exports renamed answer and prompt content through cached catalog repairs', async () => {
    page = await openGeminiPage({
      beforeStart: async () => {
        // Native paragraph structure survives while both old content class names disappear.
        document.querySelectorAll('.query-text-line').forEach((line) => {
          const renamed = document.createElement('p');
          renamed.className = 'catalog-user-line';
          renamed.textContent = line.textContent;
          line.replaceWith(renamed);
        });
        document
          .querySelectorAll('model-response > .response-container > message-content')
          .forEach((message) => {
            const renamed = document.createElement('answer-content');
            renamed.className = 'catalog-answer';
            renamed.innerHTML = message.innerHTML;
            renamed.querySelectorAll('.markdown, .markdown-main-panel').forEach((body) => {
              body.className = 'catalog-answer-body';
            });
            message.replaceWith(renamed);
          });
        // The document's native reference remains, with its label owned by the closed chip UI.
        document.querySelectorAll('immersive-entry-chip').forEach((chip) => chip.replaceChildren());
        await publishGeminiLocators({
          'content.answer': ['.catalog-answer'],
          'content.userLines': ['p.catalog-user-line'],
        });
      },
    });
    await expectOriginalExport();
  });
});
