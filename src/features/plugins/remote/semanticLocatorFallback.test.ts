import { afterEach, expect, it } from 'vitest';

import { SiteSelectorService } from '@/core/selectors';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/site.json';
import {
  readSiteAdapterData,
  validateSiteAdapterData,
} from '@/features/plugins/sites/siteAdapterData';

import { validateHostCatalogFile } from './hostCatalogFile';

afterEach(() => document.body.replaceChildren());

it('a broken composer locator keeps a complete bridge reply repair usable', async () => {
  document.body.innerHTML =
    '<form><div id="prompt-textarea" contenteditable="true">Draft</div><button type="submit">Send</button></form><article class="repaired"><p>Complete reply</p></article>';
  const site = {
    ...chatgpt,
    catalogRevision: 2,
    selectors: {
      ...chatgpt.selectors,
      composer: '[',
      composerRoot: '.wrong-root',
      sendButton: '.wrong-send',
    },
    locators: { 'bridge.replyContent': ['.repaired'] },
  };
  expect(validateSiteAdapterData(site).success).toBe(false);
  const result = validateHostCatalogFile(
    { format: 1, host: 'chatgpt.com', plugins: [], site },
    'chatgpt.com',
  );
  expect(result?.siteIssues).toContainEqual({
    path: 'site.selectors.composer',
    message: 'selector does not parse',
  });
  const accepted = result!.site!;
  expect(document.querySelector(accepted.selectors.composer)?.textContent).toBe('Draft');
  expect(document.querySelector(accepted.selectors.sendButton)?.textContent).toBe('Send');
  expect(
    document
      .querySelector(accepted.selectors.composerRoot)
      ?.contains(document.querySelector('#prompt-textarea')),
  ).toBe(true);
  const service = new SiteSelectorService('chatgpt');
  const lifetime = service.initialize({
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => accepted,
  });
  await lifetime.ready;
  expect(
    document.querySelector(service.getView().profiles['bridge.replyContent'].join(','))
      ?.textContent,
  ).toBe('Complete reply');
  lifetime.stop();
});

it('unknown sites retain strict malformed selector rejection', () => {
  const result = readSiteAdapterData({
    ...chatgpt,
    id: 'future-site',
    selectors: { composer: '[' },
  });
  expect(result.result.success).toBe(false);
  expect(validateSiteAdapterData({ ...chatgpt, selectors: { composer: 'textarea' } }).success).toBe(
    true,
  );
});
