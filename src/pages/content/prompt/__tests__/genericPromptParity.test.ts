// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { readChatInput } from '@/core/gemini/composer/inputs';
import * as geminiBundle from '@/core/gemini/selectors/bundle';

import { inputFromTarget as historyInput } from '../../promptHistory/promptInput';
import { resolvePromptInputOperation } from '../selectorInput';
import { inputFromTarget as slashInput } from '../slashInputTargets';

const descriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
afterEach(() => {
  Object.defineProperty(window, 'location', descriptor);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each(['aistudio.google.com', 'custom.example'])(
  '%s prompt helpers keep the shared composer order independently of Gemini data',
  (hostname) => {
    Object.defineProperty(window, 'location', { configurable: true, value: { hostname } });
    document.body.innerHTML =
      '<textarea id="search"></textarea><div id="prompt-textarea" contenteditable="true">draft</div>';
    for (const element of document.querySelectorAll<HTMLElement>('textarea, [contenteditable]'))
      element.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
    const composer = document.getElementById('prompt-textarea')!;
    // A different site's bundled profile must not supply this helper's fallback.
    const readGemini = vi
      .spyOn(geminiBundle, 'getBundledGeminiSelectorView')
      .mockImplementation(() => {
        throw new Error('foreign site data read');
      });
    expect(historyInput(composer)).toBe(composer);
    expect(slashInput(composer)).toBe(composer);
    expect(
      resolvePromptInputOperation('promptHistory.candidates', (selectors) =>
        readChatInput(selectors),
      ).value,
    ).toBe(composer);
    expect(readGemini).not.toHaveBeenCalled();
  },
);
