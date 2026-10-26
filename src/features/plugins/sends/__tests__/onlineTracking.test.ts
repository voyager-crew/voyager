// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendSiteOf, trackUserSends } from '../trackUserSends';

const scopes: PluginScope[] = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  document.body.replaceChildren();
});

it('a partial online user-turn read still reports the newly sent prompt under its own key', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="old"><div data-user-message-bubble class="partial">Old prompt</div></div></main><form><div id="prompt-textarea" contenteditable="true">New prompt</div><button type="submit">Send</button></form>';
  const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
  const scope = new PluginScope();
  scopes.push(scope);
  const report = vi.fn();
  trackUserSends(scope, { ...site, userTurn: '.partial' }, report);
  document
    .getElementById('prompt-textarea')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-turn-key="new"><div data-user-message-bubble>New prompt</div></div>',
    );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(report).toHaveBeenCalledWith({
    conversationKey: 'chatgpt:conv:work',
    turnKey: 'new',
    at: expect.any(Number),
  });
  expect(report).toHaveBeenCalledTimes(1);
});
