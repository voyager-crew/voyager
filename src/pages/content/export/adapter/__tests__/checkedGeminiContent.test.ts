// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { afterEach, expect, it } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';

import { installGeminiSelectorPatch } from '../../../__tests__/geminiOnlineSelectorFixture';
import { resolveAnswerElement } from '../../../researchPack/turnCapture';
import { resolveExportAdapter } from '../platformAdapters';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

it('a direct export keeps the paired prompt bundled when its answer repair is rejected', async () => {
  document.body.innerHTML = `<main><section class="conversation-container">
    <user-query><p>First line</p><p>Second line</p><user-query-file-preview><span data-test-id="uploaded-file">notes.pdf</span></user-query-file-preview></user-query>
    <model-response><message-content><p>Answer</p></message-content></model-response>
  </section></main>`;
  const user = document.querySelector<HTMLElement>('user-query')!;
  const extractor = () => createContentExtractor(resolveExportAdapter());
  const expected = extractor().extractUserContent(user);
  stop = await installGeminiSelectorPatch({
    'content.answer': ['.missing-answer'],
    'content.userLines': ['p'],
  });
  expect(extractor().extractUserContent(user)).toEqual(expected);
  expect(extractor().extractUserContent(user).text).toBe('📎 notes.pdf');
});

it('research selection keeps the whole answer boundary when the paired prompt repair is rejected', async () => {
  document.body.innerHTML = `<section class="conversation-container">
    <user-query><p class="query-text-line">First line</p><p class="query-text-line">Second line</p></user-query>
    <model-response><div class="new-answer"><p>Complete answer</p></div></model-response>
  </section>`;
  const host = document.querySelector<HTMLElement>('model-response')!;
  stop = await installGeminiSelectorPatch({
    'content.answer': ['.new-answer'],
    'content.userLines': ['p:first-child'],
  });
  expect(resolveAnswerElement(host)).toBe(host);
  expect(resolveAnswerElement(host).textContent).toBe('Complete answer');
});

it('a direct export still repairs the prompt after the complete paired answer is accepted', async () => {
  document.body.innerHTML = `<main><section class="conversation-container">
    <user-query><p>First line</p><p>Second line</p></user-query>
    <model-response><div class="new-answer"><p>Complete answer</p></div></model-response>
  </section></main>`;
  stop = await installGeminiSelectorPatch({
    'content.answer': ['.new-answer'],
    'content.userLines': ['p'],
  });
  const extractor = createContentExtractor(resolveExportAdapter());
  expect(
    extractor.extractUserContent(document.querySelector<HTMLElement>('user-query')!).text,
  ).toBe('First line\nSecond line');
  expect(
    extractor.extractAssistantContent(document.querySelector<HTMLElement>('model-response')!).text,
  ).toBe('Complete answer');
});
