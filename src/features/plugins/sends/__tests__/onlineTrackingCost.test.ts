// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { prepareSendTargets } from '../sendTargets';
import { sendSiteOf, trackUserSends } from '../trackUserSends';

let scope: PluginScope | undefined;
let lifetime: SiteSelectorLifetime | undefined;
afterEach(async () => {
  await scope?.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

it.each(['keydown', 'click', 'submit'] as const)(
  'a repaired %s send proves its composer once and ignores later composer churn',
  async (kind) => {
    document.body.innerHTML =
      '<main></main><form data-chatgpt-composer><textarea class="repaired-input">New prompt</textarea><button type="button" class="repaired-send">Send</button></form>';
    lifetime = initializeSiteSelectors('chatgpt', {
      host: 'chatgpt.com',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 0,
      read: async () => ({
        id: 'chatgpt',
        catalogRevision: 1,
        selectors: {
          composer: '.repaired-input',
          sendButton: '.repaired-send',
        },
      }),
    });
    await lifetime.ready;
    const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
    const query = vi.spyOn(document, 'querySelectorAll');
    prepareSendTargets(site, document).read?.();
    const singleProofScans = query.mock.calls.filter(
      ([selector]) => selector === '.repaired-input',
    ).length;
    expect(singleProofScans).toBeGreaterThan(0);
    query.mockClear();
    scope = new PluginScope();
    const report = vi.fn();
    trackUserSends(scope, site, report);
    const field = document.querySelector('textarea')!;
    const form = document.querySelector('form')!;
    if (kind === 'keydown')
      field.dispatchEvent(new KeyboardEvent(kind, { key: 'Enter', bubbles: true }));
    else if (kind === 'click')
      document.querySelector('button')!.dispatchEvent(new MouseEvent(kind, { bubbles: true }));
    else form.dispatchEvent(new Event(kind, { bubbles: true }));
    expect(query.mock.calls.filter(([selector]) => selector === '.repaired-input')).toHaveLength(
      singleProofScans,
    );
    query.mockClear();
    // Once submitted, mounting or replacing the composer cannot change which turn was sent.
    form.remove();
    for (let i = 0; i < 3; i++) {
      document.querySelector('main')!.append(document.createElement('span'));
      await settle();
    }
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<div data-turn-key="sent"><div data-user-message-bubble>New prompt</div></div>',
      );
    await settle();
    expect(report).toHaveBeenCalledExactlyOnceWith({
      conversationKey: 'chatgpt:conv:work',
      turnKey: 'sent',
      at: expect.any(Number),
    });
    expect(query.mock.calls.filter(([selector]) => selector === '.repaired-input')).toHaveLength(0);
  },
);

it('sidebar and menu clicks do no remote turn or composer work before the real send', async () => {
  document.body.innerHTML =
    '<main></main><aside><button type="button" id="menu"><span>Menu</span></button><a href="#" id="sidebar">Sidebar</a></aside><form data-chatgpt-composer><textarea class="repaired-input">New prompt</textarea><button type="button" class="repaired-send"><span>Send</span></button></form>';
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 1,
      selectors: {
        composer: '.repaired-input',
        sendButton: '.repaired-send',
        userTurn: '.repaired-turn',
      },
    }),
  });
  await lifetime.ready;
  const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
  scope = new PluginScope();
  const report = vi.fn();
  trackUserSends(scope, site, report);
  const query = vi.spyOn(document, 'querySelectorAll');
  const scans = () =>
    query.mock.calls.filter(
      ([selector]) => selector === '.repaired-input' || selector === '.repaired-turn',
    ).length;
  document.querySelector('#menu span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.querySelector('#sidebar')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(scans()).toBe(0);
  document
    .querySelector('form button span')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(scans()).toBeGreaterThan(0);
  document.querySelector('main')!.innerHTML =
    '<div data-turn-key="sent"><div data-chatgpt-search-unit-key="sent:user"><div class="repaired-turn">New prompt</div></div></div>';
  await settle();
  expect(report).toHaveBeenCalledExactlyOnceWith({
    conversationKey: 'chatgpt:conv:work',
    turnKey: 'sent',
    at: expect.any(Number),
  });
});

it.each([false, true])(
  'bundled clicks and pending mutations retain baseline work with an unrelated repair: %s',
  async (unrelated) => {
    document.body.innerHTML =
      '<main></main><aside><button type="button" id="menu">Menu</button></aside><form><div id="prompt-textarea" contenteditable="true">New prompt</div><button type="button" aria-label="Send">Send</button></form>';
    if (unrelated) {
      lifetime = initializeSiteSelectors('chatgpt', {
        host: 'chatgpt.com',
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({
          id: 'chatgpt',
          catalogRevision: 1,
          locators: { 'input.candidates': ['.unrelated-input'] },
        }),
      });
      await lifetime.ready;
    }
    const site = sendSiteOf(requireBundledSiteAdapter('chatgpt'))!;
    scope = new PluginScope();
    const report = vi.fn();
    trackUserSends(scope, site, report);
    const NativeURL = URL;
    const urls = vi.fn((input: string | URL, base?: string | URL) => new NativeURL(input, base));
    class MeasuredURL extends NativeURL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        urls(input, base);
      }
    }
    vi.stubGlobal('URL', MeasuredURL);
    try {
      const queries = vi.spyOn(document, 'querySelectorAll');
      document.getElementById('menu')!.click();
      const idleReads = { urls: urls.mock.calls.length, queries: queries.mock.calls.length };
      expect(idleReads).toEqual({ urls: 0, queries: 0 });
      document.querySelector<HTMLButtonElement>('form button')!.click();
      expect(queries.mock.calls.map(([selector]) => selector)).toEqual([site.userTurn]);
      // Baseline only parses the route when starting or reporting a send, never on transcript churn.
      urls.mockClear();
      queries.mockClear();
      document.querySelector('main')!.append(document.createElement('span'));
      await settle();
      expect(urls.mock.calls).toHaveLength(0);
      expect(queries.mock.calls.map(([selector]) => selector)).toEqual([site.userTurn]);
      document.querySelector('main')!.innerHTML =
        '<div data-turn-key="sent"><div data-user-message-bubble>New prompt</div></div>';
      await settle();
      expect(report).toHaveBeenCalledExactlyOnceWith({
        conversationKey: 'chatgpt:conv:work',
        turnKey: 'sent',
        at: expect.any(Number),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
