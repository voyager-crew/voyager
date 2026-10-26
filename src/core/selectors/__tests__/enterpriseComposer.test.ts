// @vitest-environment-options { "url": "https://business.gemini.google/app" }
import { afterEach, expect, it } from 'vitest';

import { findGeminiChatInput } from '@/core/gemini/composer/inputs';
import { readChatInput } from '@/core/gemini/composer/inputs';
import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '../service';

let lifetime: SiteSelectorLifetime | undefined;

afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
});

it('Enterprise repairs the same independently owned composer and rejects a foreign editor', async () => {
  document.body.innerHTML =
    '<input-area-v2><section id="draft" contenteditable="true">Enterprise draft</section><button>Send</button></input-area-v2><model-response><section id="foreign" contenteditable="true">Other content</section></model-response>';
  const draft = document.getElementById('draft')!;
  const foreign = document.getElementById('foreign')!;
  for (const field of [draft, foreign])
    field.getBoundingClientRect = () => ({ width: 200, height: 20 }) as DOMRect;
  const mount = async (selector: string) => {
    lifetime?.stop();
    lifetime = initializeSiteSelectors('gemini', {
      host: 'business.gemini.google',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 1,
      read: async () => ({
        id: 'gemini',
        catalogRevision: 2,
        locators: { 'composer.candidates': [selector] },
      }),
    });
    await lifetime.ready;
  };
  await mount('#draft');
  expect(findGeminiChatInput()).toBe(draft);
  expect(findGeminiChatInput()?.textContent).toBe('Enterprise draft');
  await mount('#foreign');
  expect(findGeminiChatInput()).toBe(
    readChatInput(getBundledGeminiSelectorView().profiles['composer.candidates']),
  );
  expect(draft.textContent).toBe('Enterprise draft');
});
