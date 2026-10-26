import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { deepseekAdapter } from '@/features/plugins/sites/adapters/deepseek';
import type { SiteAdapter } from '@/features/plugins/types';

import { captureCatalogWindow } from '../../sites/catalogReader';
import { buildCatalogExportAdapter } from '../platform/catalog';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

it('a cached adapter cannot replace the original prompts or roles while page locators are bundled', async () => {
  document.body.innerHTML =
    '<main class="ds-virtual-list ds-scroll-area"><div data-virtual-list-item-key="u"><div class="ds-message"><div class="ds-collapsible-text">Original prompt</div></div></div><div data-virtual-list-item-key="a"><div class="ds-message"><div class="ds-assistant-message-main-content"><p>Original answer</p></div></div></div><aside class="other">Foreign conversation</aside></main>';
  const cached: SiteAdapter = {
    ...deepseekAdapter,
    selectors: {
      ...deepseekAdapter.selectors,
      userTurn: '.other',
      assistantTurn: '.other',
      scrollContainer: '.other',
    },
  };
  const adapter = buildCatalogExportAdapter(cached);
  const root = adapter.resolveConversationRoot([], document);
  const expected = captureCatalogWindow(
    deepseekAdapter,
    buildCatalogExportAdapter(deepseekAdapter),
    root,
  );
  const before = captureCatalogWindow(cached, adapter, root);
  expect(before.map(({ nativeId, role, text }) => ({ nativeId, role, text }))).toEqual(
    expected.map(({ nativeId, role, text }) => ({ nativeId, role, text })),
  );
  expect(before.map(({ text }) => text)).toEqual(['Original prompt', 'Original answer']);

  const running = initializeSiteSelectors('deepseek', {
    host: 'chat.deepseek.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'deepseek',
      catalogRevision: 1,
      selectors: cached.selectors,
      locators: { 'export.assistantContent': ['.ds-assistant-message-main-content'] },
    }),
  });
  stop = running.stop;
  await running.ready;
  const after = captureCatalogWindow(cached, buildCatalogExportAdapter(cached), root);
  expect(after.map(({ nativeId, role, text }) => ({ nativeId, role, text }))).toEqual(
    before.map(({ nativeId, role, text }) => ({ nativeId, role, text })),
  );
});
