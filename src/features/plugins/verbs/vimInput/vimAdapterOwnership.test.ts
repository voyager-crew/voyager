// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://claude.ai/new" }
import { afterEach, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { vimInputPrimitive } from './index';

let scope: PluginScope;
afterEach(async () => {
  await scope?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('an online adapter composer cannot masquerade as a user-selected Vim override', async () => {
  document.body.innerHTML =
    '<form><div class="bio" contenteditable="true">bio text</div><button>Submit</button></form><div data-composer-card-holder><fieldset><div data-testid="chat-input" contenteditable="true" role="textbox">main draft</div></fieldset></div>';
  for (const element of document.querySelectorAll<HTMLElement>('[contenteditable], fieldset'))
    element.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
  const main = document.querySelector<HTMLElement>('[data-testid="chat-input"]')!;
  const bio = document.querySelector<HTMLElement>('.bio')!;
  const adapter = requireBundledSiteAdapter('claude');
  scope = new PluginScope();
  vimInputPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: { ...adapter, selectors: { ...adapter.selectors, composer: '.bio' } },
      pluginId: 'test.vim',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  bio.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  const range = document.createRange();
  range.setStart(main.firstChild!, 0);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  main.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  main.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  expect(main.textContent).toBe('ain draft');
  expect(bio.textContent).toBe('bio text');
});
