// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://claude.ai/chat/work" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendSiteOf, trackUserSends } from '../trackUserSends';

let scope: PluginScope | undefined;
let lifetime: SiteSelectorLifetime | undefined;
afterEach(async () => {
  await scope?.dispose();
  lifetime?.stop();
  document.body.replaceChildren();
});

it('an admitted composer repair still records the catalog user-turn override outside the guarded contract', async () => {
  document.body.innerHTML =
    '<main></main><div data-composer-card-holder><div class="catalog-root"><div contenteditable="true" class="repaired-input">New prompt</div><button type="button" class="repaired-send">Send</button></div></div>';
  const bundle = requireBundledSiteAdapter('claude');
  const adapter = {
    ...bundle,
    selectors: {
      ...bundle.selectors,
      composer: '.repaired-input',
      composerRoot: '.catalog-root',
      sendButton: '.repaired-send',
      userTurn: '.catalog-user',
    },
    turnKeyAttributes: ['data-turn-key'],
  };
  lifetime = initializeSiteSelectors('claude', {
    host: 'claude.ai',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ ...adapter, catalogRevision: 1 }),
  });
  await lifetime.ready;
  scope = new PluginScope();
  const report = vi.fn();
  trackUserSends(scope, sendSiteOf(adapter)!, report);
  document.querySelector('button')!.click();
  document.querySelector('main')!.innerHTML =
    '<div data-turn-key="sent" class="catalog-user">New prompt</div>';
  for (let n = 0; n < 6; n++) await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith({
    conversationKey: 'claude:conv:work',
    turnKey: 'sent',
    at: expect.any(Number),
  });
});
