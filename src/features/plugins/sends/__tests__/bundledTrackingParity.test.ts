// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import * as latex from '@/core/utils/userLatexSource';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendSiteOf, trackUserSends } from '../trackUserSends';

const scopes: PluginScope[] = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function track() {
  const scope = new PluginScope();
  scopes.push(scope);
  const report = vi.fn();
  trackUserSends(scope, sendSiteOf(requireBundledSiteAdapter('chatgpt'))!, report);
  return report;
}
function sent(key = 'new') {
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      `<div data-turn-key="${key}"><div data-user-message-bubble>draft</div></div>`,
    );
}

it('a labelled button send still records its turn when the button is not type submit', async () => {
  document.body.innerHTML =
    '<main></main><form><div id="prompt-textarea" contenteditable="true">draft</div><button type="button" aria-label="Send"><span>icon</span></button></form>';
  const report = track();
  document.querySelector('button span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  sent();
  await settle();
  expect(report).toHaveBeenCalledWith({
    conversationKey: 'chatgpt:conv:work',
    turnKey: 'new',
    at: expect.any(Number),
  });
});

it('a form submit records its own prompt without a site-specific root marker', async () => {
  document.body.innerHTML =
    '<main></main><form><div data-composer-markdown contenteditable="true">draft</div></form>';
  const report = track();
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
  sent();
  await settle();
  expect(report).toHaveBeenCalledTimes(1);
});

it('unrelated streaming does not serialize a known user turn before the submitted turn mounts', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="old"><div data-user-message-bubble>old</div></div></main><form><div id="prompt-textarea" contenteditable="true">draft</div></form>';
  const read = vi.spyOn(latex, 'textWithLatexSource');
  const report = track();
  document
    .getElementById('prompt-textarea')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  for (let i = 0; i < 3; i++) {
    document.querySelector('main')!.append(document.createElement('span'));
    await settle();
  }
  expect(read).not.toHaveBeenCalled();
  sent();
  await settle();
  expect(read).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledTimes(1);
});
