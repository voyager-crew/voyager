// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendTargets } from '../sendTargets';
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
    sendTargets(site, document);
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
