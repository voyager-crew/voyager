import { afterEach, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import type { SiteAdapter } from '@/features/plugins/types';

import { pageSemanticSelector, withPageSemanticSelectors } from '../semanticSnapshot';
import { initializeSiteSelectors, type SiteSelectorLifetime } from '../service';

let lifetime: SiteSelectorLifetime | undefined;

afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
});

it('ON without an accepted snapshot cannot redirect the composer through a cached adapter', async () => {
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    read: async () => null,
  });
  await lifetime.ready;
  const bundle = requireBundledSiteAdapter('chatgpt');
  const changed = { ...bundle, selectors: { ...bundle.selectors, composer: '.wrong' } };
  document.body.innerHTML =
    '<div id="prompt-textarea">Kept draft</div><textarea class="wrong">Other draft</textarea>';
  const site = withPageSemanticSelectors(changed, ['composer', 'composerRoot', 'sendButton']);
  expect(document.querySelector(site.selectors.composer)?.textContent).toBe('Kept draft');
  expect(site.theme).toBe(changed.theme);
  expect(withPageSemanticSelectors(bundle, ['composer'])).toBe(bundle);
});

it('a later adapter reload cannot change the frozen page read while an admitted profile stays usable', async () => {
  const bundle = requireBundledSiteAdapter('claude');
  document.body.innerHTML =
    '<div data-composer-card-holder><div><section class="online-composer" contenteditable="true">Original draft</section><button type="submit">Send</button></div></div><section class="repaired">Complete reply</section><textarea class="later">Other draft</textarea>';
  lifetime = initializeSiteSelectors('claude', {
    host: 'claude.ai',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({
      id: 'claude',
      catalogRevision: 2,
      selectors: { composer: '.online-composer' },
      locators: { 'export.assistantContent': ['.repaired'], composer: ['.later'] },
    }),
  });
  await lifetime.ready;
  const later: SiteAdapter = {
    ...bundle,
    catalogRevision: 3,
    selectors: { ...bundle.selectors, composer: '.later' },
  };
  expect(document.querySelector(pageSemanticSelector(later, 'composer')!)?.textContent).toBe(
    'Original draft',
  );
  expect(
    document.querySelector(pageSemanticSelector(later, 'export.assistantContent')!)?.textContent,
  ).toBe('Complete reply');
});

it('an explicitly provided unknown custom adapter retains its own input', () => {
  const custom: SiteAdapter = {
    ...requireBundledSiteAdapter('chatgpt'),
    id: 'custom-site',
    selectors: { composer: '.custom' },
  };
  document.body.innerHTML = '<textarea class="custom">Custom draft</textarea>';
  const site = withPageSemanticSelectors(custom, ['composer']);
  expect(site).toBe(custom);
  expect(document.querySelector(pageSemanticSelector(site, 'composer')!)?.textContent).toBe(
    'Custom draft',
  );
});

it('Gemini exposes its bundled composer and turn semantics through the shared snapshot', () => {
  const bundle = requireBundledSiteAdapter('gemini');
  document.body.innerHTML =
    '<input-area-v2>Draft</input-area-v2><user-query>Question</user-query><model-response>Answer</model-response>';
  const adapter = withPageSemanticSelectors(bundle, ['composer', 'userTurn', 'assistantTurn']);
  expect(document.querySelector(pageSemanticSelector(adapter, 'composer')!)?.textContent).toBe(
    'Draft',
  );
  expect(document.querySelector(adapter.selectors.userTurn)?.textContent).toBe('Question');
  expect(document.querySelector(adapter.selectors.assistantTurn)?.textContent).toBe('Answer');
});
