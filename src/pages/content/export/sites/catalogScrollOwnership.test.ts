// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chat.deepseek.com/a/chat/s/work" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { deepseekAdapter } from '@/features/plugins/sites/adapters/deepseek';
import type { SiteAdapter } from '@/features/plugins/types';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import { captureCatalogWindow, readCatalogConversation } from './catalogReader';

const TIMING = { pollMs: 10, stableSamples: 1, topTimeoutMs: 100, timeoutMs: 300 };
const site: SiteAdapter = {
  ...deepseekAdapter,
  export: { ...deepseekAdapter.export!, generating: '.native-streaming' },
};
let stop = () => {};
function messages(prefix: string): string {
  return `<div data-virtual-list-item-key="u"><div class="ds-message"><div class="ds-collapsible-text">${prefix} question</div></div></div><div data-virtual-list-item-key="a"><div class="ds-message"><div class="ds-assistant-message-main-content"><p>${prefix} answer</p></div></div></div>`;
}
function rootFixture(native = false) {
  document.body.innerHTML = `<section id="root" class="${native ? 'ds-virtual-list ds-scroll-area' : 'repaired'}" style="overflow-y:auto">${messages('Original')}</section>`;
  const root = document.getElementById('root')!;
  let top = 80;
  const writeTop = vi.fn((value: number) => {
    top = value;
  });
  Object.defineProperties(root, {
    scrollHeight: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, get: () => top, set: writeTop },
  });
  return { root, writeTop };
}
async function patch() {
  const running = initializeSiteSelectors('deepseek', {
    host: 'chat.deepseek.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'deepseek',
      catalogRevision: 1,
      selectors: { scrollContainer: '.repaired' },
    }),
  });
  stop = running.stop;
  await running.ready;
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('an export adapter rechecks a root alias that moves to a foreign conversation after construction', async () => {
  const { root } = rootFixture();
  await patch();
  const adapter = buildCatalogExportAdapter(site);
  expect(adapter.resolveConversationRoot([], document)).toBe(root);
  root.className = 'ds-virtual-list ds-scroll-area';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<aside role="dialog" class="repaired">${messages('Foreign')}</aside>`,
  );
  const resolved = adapter.resolveConversationRoot([], document);
  const exported = captureCatalogWindow(site, adapter, resolved);
  expect(exported.map(({ text }) => text)).toEqual(['Original question', 'Original answer']);
  expect(exported.map(({ nativeId }) => nativeId)).toEqual([
    'data-virtual-list-item-key:u',
    'data-virtual-list-item-key:a',
  ]);
});

it('a virtual export never reads or scrolls a remote root reused by a dialog during a wait', async () => {
  const { root, writeTop } = rootFixture();
  await patch();
  const adapter = buildCatalogExportAdapter(site);
  const pending = readCatalogConversation(site, adapter, {}, TIMING);
  let writesAtReuse = 0;
  setTimeout(() => {
    root.setAttribute('role', 'dialog');
    root.innerHTML = messages('Foreign');
    writesAtReuse = writeTop.mock.calls.length;
  }, 5);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result).toMatchObject({ completeness: 'partial', reason: 'identity' });
  expect(result.snapshots.map(({ text }) => text)).toEqual([
    'Original question',
    'Original answer',
  ]);
  expect(writeTop).toHaveBeenCalledTimes(writesAtReuse);

  root.removeAttribute('role');
  root.innerHTML = messages('Restored');
  const retry = readCatalogConversation(site, adapter, {}, TIMING);
  await vi.runAllTimersAsync();
  expect((await retry).snapshots.map(({ text }) => text)).toEqual([
    'Restored question',
    'Restored answer',
  ]);
});

it('a bundled virtual export keeps one root lookup while preserving all exported messages', async () => {
  rootFixture(true);
  const query = vi.spyOn(document, 'querySelector');
  const pending = readCatalogConversation(site, buildCatalogExportAdapter(site), {}, TIMING);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.snapshots.map(({ text }) => text)).toEqual([
    'Original question',
    'Original answer',
  ]);
  expect(
    query.mock.calls.filter(([selector]) => selector === site.selectors.scrollContainer),
  ).toHaveLength(1);
});

it('scroll restoration stops when the proved root is reused during its settling wait', async () => {
  const { root, writeTop } = rootFixture();
  await patch();
  const originalWrite = writeTop.getMockImplementation()!;
  let reused = false;
  let writesAtReuse = 0;
  writeTop.mockImplementation((top) => {
    originalWrite(top);
    if (top === 80 && !reused) {
      reused = true;
      setTimeout(() => {
        root.setAttribute('role', 'dialog');
        root.innerHTML = messages('Foreign');
        root.scrollTop = 250;
        writesAtReuse = writeTop.mock.calls.length;
      }, 5);
    }
  });
  const pending = readCatalogConversation(site, buildCatalogExportAdapter(site), {}, TIMING);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.snapshots.map(({ text }) => text)).toEqual([
    'Original question',
    'Original answer',
  ]);
  expect(reused).toBe(true);
  expect(writeTop).toHaveBeenCalledTimes(writesAtReuse);
  expect(root.scrollTop).toBe(250);
});
