// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendSiteOf, trackUserSends } from '../trackUserSends';

const scopes: PluginScope[] = [];
const selectorStops: Array<() => void> = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  selectorStops.splice(0).forEach((stop) => stop());
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

it.each(['click', 'submit'] as const)(
  'a renamed composer still records its %s send through the originally proved form',
  async (event) => {
    document.body.innerHTML =
      '<main></main><form data-chatgpt-composer><textarea class="repaired-input">New prompt</textarea><button type="submit" class="repaired-send">Send</button></form>';
    const session = initializeSiteSelectors('chatgpt', {
      host: 'chatgpt.com',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 0,
      read: async () => ({
        id: 'chatgpt',
        catalogRevision: 1,
        selectors: { composer: '.repaired-input', sendButton: '.repaired-send' },
      }),
    });
    selectorStops.push(session.stop);
    await session.ready;
    const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
    const scope = new PluginScope();
    scopes.push(scope);
    const report = vi.fn();
    trackUserSends(scope, site, report);
    if (event === 'click')
      document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    document.querySelector('main')!.innerHTML =
      '<div data-turn-key="new"><div data-user-message-bubble>New prompt</div></div>';
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(report).toHaveBeenCalledWith({
      conversationKey: 'chatgpt:conv:work',
      turnKey: 'new',
      at: expect.any(Number),
    });
    expect(report).toHaveBeenCalledTimes(1);
  },
);

it('a later button alias outside the proved composer cannot claim a newly mounted prompt', async () => {
  document.body.innerHTML =
    '<main></main><form data-chatgpt-composer><textarea class="repaired-input">New prompt</textarea><button type="button" class="repaired-send">Send</button></form>';
  const session = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 1,
      selectors: { composer: '.repaired-input', sendButton: '.repaired-send' },
    }),
  });
  selectorStops.push(session.stop);
  await session.ready;
  const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
  const scope = new PluginScope();
  scopes.push(scope);
  const report = vi.fn();
  trackUserSends(scope, site, report);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button type="button" class="repaired-send" id="foreign">Other send</button>',
  );
  document.getElementById('foreign')!.click();
  document.querySelector('main')!.innerHTML =
    '<div data-turn-key="historical"><div data-user-message-bubble>New prompt</div></div>';
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(report).not.toHaveBeenCalled();

  document.querySelector<HTMLButtonElement>('form button')!.click();
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-turn-key="sent"><div data-user-message-bubble>New prompt</div></div>',
    );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(report).toHaveBeenCalledWith({
    conversationKey: 'chatgpt:conv:work',
    turnKey: 'sent',
    at: expect.any(Number),
  });
});
