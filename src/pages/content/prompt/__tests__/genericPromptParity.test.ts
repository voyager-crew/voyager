// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';

import { readChatInput } from '@/core/gemini/composer/inputs';
import { initializeGeminiSelectors, type GeminiSelectorLifetime } from '@/core/gemini/selectors';

import { inputFromTarget as historyInput } from '../../promptHistory/promptInput';
import { resolvePromptInputOperation } from '../selectorInput';
import { inputFromTarget as slashInput } from '../slashInputTargets';

const descriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
let lifetime: GeminiSelectorLifetime | undefined;
const site = (hostname: string) =>
  Object.defineProperty(window, 'location', { configurable: true, value: { hostname } });
afterEach(() => {
  lifetime?.stop();
  Object.defineProperty(window, 'location', descriptor);
  document.body.replaceChildren();
});

it.each(['aistudio.google.com', 'custom.example'])(
  '%s prompt helpers retain their own candidate order while a Gemini repair is usable',
  async (hostname) => {
    site('gemini.google.com');
    document.body.innerHTML =
      '<input-area-v2><span class="native-repair" contenteditable="true">draft</span></input-area-v2>';
    const repaired = document.querySelector<HTMLElement>('.native-repair')!;
    repaired.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
    lifetime = initializeGeminiSelectors({
      host: 'gemini.google.com',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 0,
      read: async () => ({
        id: 'gemini',
        catalogRevision: 1,
        locators: {
          'promptHistory.candidates': ['.native-repair'],
          'slash.candidates': ['.native-repair'],
        },
      }),
    });
    await lifetime.ready;
    // The identical DOM really admits the repair on its owning site.
    expect(historyInput(repaired)).toBe(repaired);
    expect(slashInput(repaired)).toBe(repaired);
    site(hostname);
    expect(historyInput(repaired)).toBeNull();
    expect(slashInput(repaired)).toBeNull();

    document.body.insertAdjacentHTML(
      'beforeend',
      '<textarea id="search"></textarea><div id="prompt-textarea" contenteditable="true">local draft</div>',
    );
    for (const element of document.querySelectorAll<HTMLElement>('textarea, [contenteditable]'))
      element.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
    const composer = document.getElementById('prompt-textarea')!;
    expect(historyInput(composer)).toBe(composer);
    expect(slashInput(composer)).toBe(composer);
    expect(
      resolvePromptInputOperation('promptHistory.candidates', (selectors) =>
        readChatInput(selectors),
      ).value,
    ).toBe(composer);
  },
);
