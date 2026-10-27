// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chat.deepseek.com/a/chat/s/export" }
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { deepseekAdapter } from '@/features/plugins/sites/adapters/deepseek';
import type { SiteAdapter } from '@/features/plugins/types';

import { captureCatalogWindow } from '../../sites/catalogReader';
import { buildCatalogExportAdapter } from '../platform/catalog';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

it('a catalog turn repair remains exportable while a foreign scroll-root override falls back', async () => {
  document.body.innerHTML =
    '<main class="ds-virtual-list ds-scroll-area"><div data-virtual-list-item-key="u"><div class="repaired-user"><p>Repaired prompt</p></div></div><div data-virtual-list-item-key="a"><div class="repaired-answer"><div class="markdown"><p>Repaired answer</p></div></div></div></main><aside class="other">Foreign conversation</aside>';
  const cached: SiteAdapter = {
    ...deepseekAdapter,
    selectors: {
      ...deepseekAdapter.selectors,
      userTurn: '.repaired-user',
      assistantTurn: '.repaired-answer',
      scrollContainer: '.other',
    },
  };
  const read = () => {
    const adapter = buildCatalogExportAdapter(cached);
    const root = adapter.resolveConversationRoot([], document);
    expect(root).toBe(document.querySelector('main'));
    return captureCatalogWindow(cached, adapter, root).map(({ nativeId, role, text }) => ({
      nativeId,
      role,
      text,
    }));
  };
  const expected = [
    { nativeId: 'data-virtual-list-item-key:u', role: 'user', text: 'Repaired prompt' },
    { nativeId: 'data-virtual-list-item-key:a', role: 'assistant', text: 'Repaired answer' },
  ];
  // OFF retains the scroll owner selected by the baseline cached adapter.
  expect(buildCatalogExportAdapter(cached).resolveConversationRoot([], document)).toBe(
    document.querySelector('.other'),
  );

  const running = initializeSiteSelectors('deepseek', {
    host: 'chat.deepseek.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'deepseek',
      catalogRevision: 1,
      selectors: cached.selectors,
      locators: { 'export.assistantContent': ['.markdown'] },
    }),
  });
  stop = running.stop;
  await running.ready;
  expect(read()).toEqual(expected);
});
