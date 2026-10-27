// @vitest-environment-options { "url": "https://chatgpt.com/?temporary-chat=true" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { activateChatGptTemporaryHandoff } from './index';

vi.mock('@/utils/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/i18n')>()),
  getCurrentLanguage: async () => 'en',
}));

let lifetime: SiteSelectorLifetime | undefined;
const scopes: PluginScope[] = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
});
async function mount(): Promise<Element | null> {
  const scope = new PluginScope();
  scopes.push(scope);
  await activateChatGptTemporaryHandoff(scope);
  return document.querySelector('[data-gv-chatgpt-handoff-button]')?.parentElement ?? null;
}
async function online(selector: string): Promise<void> {
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 2,
      selectors: { headerActions: selector },
    }),
  });
  await lifetime.ready;
}

it.each([
  ['catalog placement', '<section id="remote"></section>', '#remote', 'remote'],
  [
    'no matching placement',
    '<section id="remote"></section>',
    '.missing',
    'conversation-header-actions',
  ],
  [
    'editable ancestor',
    '<div contenteditable="true"><span id="remote"></span></div>',
    '#remote',
    'conversation-header-actions',
  ],
  ['input control', '<input id="remote">', '#remote', 'conversation-header-actions'],
  [
    'textarea control',
    '<textarea id="remote"></textarea>',
    '#remote',
    'conversation-header-actions',
  ],
  ['select control', '<select id="remote"></select>', '#remote', 'conversation-header-actions'],
] as const)(
  'headerActions mounts the handoff button with %s',
  async (_name, target, selector, id) => {
    document.body.innerHTML = `<header id="conversation-header-actions"></header>${target}`;
    await online(selector);
    expect(await mount()).toBe(document.getElementById(id));
  },
);

it('the same header keeps the actual handoff button in place through both data sources', async () => {
  document.body.innerHTML = '<header id="conversation-header-actions" class="remote"></header>';
  const nativeParent = await mount();
  await scopes.pop()!.dispose();
  await online('.remote');
  expect(await mount()).toBe(nativeParent);
});
