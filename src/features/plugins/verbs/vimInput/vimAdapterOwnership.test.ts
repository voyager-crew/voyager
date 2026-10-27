// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://claude.ai/new" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { vimInputPrimitive } from './index';

let scope: PluginScope;
let lifetime: SiteSelectorLifetime | undefined;
afterEach(async () => {
  await scope?.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each([
  ['ON ignores a cached composer that cannot prove ownership of the original draft', true],
  ['OFF keeps Vim editing the cached composer instead of the bundled editor', false],
] as const)('%s', async (_name, online) => {
  document.body.innerHTML =
    '<form><div class="bio" contenteditable="true">bio text</div><button>Submit</button></form><div data-composer-card-holder><fieldset><div data-testid="chat-input" contenteditable="true" role="textbox">main draft</div></fieldset></div>';
  for (const element of document.querySelectorAll<HTMLElement>('[contenteditable], fieldset'))
    element.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
  const main = document.querySelector<HTMLElement>('[data-testid="chat-input"]')!;
  const bio = document.querySelector<HTMLElement>('.bio')!;
  const adapter = requireBundledSiteAdapter('claude');
  const source = { ...adapter, selectors: { ...adapter.selectors, composer: '.bio' } };
  lifetime = initializeSiteSelectors('claude', {
    host: 'claude.ai',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    readOnlineUpdates: async () => online,
    read: async () =>
      online ? { id: 'claude', catalogRevision: 1, selectors: source.selectors } : null,
  });
  await lifetime.ready;
  scope = new PluginScope();
  vimInputPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: source,
      pluginId: 'test.vim',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const target = online ? main : bio;
  const other = online ? bio : main;
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  other.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  const range = document.createRange();
  range.setStart(target.firstChild!, 0);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  expect(main.textContent).toBe(online ? 'ain draft' : 'main draft');
  expect(bio.textContent).toBe(online ? 'bio text' : 'io text');
});
