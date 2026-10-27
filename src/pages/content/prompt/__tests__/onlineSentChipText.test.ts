import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { startSentPromptChips, type SentPromptChipsController } from '../SentPromptChips';
import { readSentChipTargets } from '../sentChipTargets';

let retire = () => {};
let chips: SentPromptChipsController | null = null;
afterEach(() => {
  chips?.destroy();
  chips = null;
  retire();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const prompts = [
  {
    id: 'real',
    name: 'Actual prompt',
    text: 'Please explain the complete proof step by step with examples.',
  },
  {
    id: 'wrong',
    name: 'Unrelated prompt',
    text: 'Write an entirely unrelated fictional story about another person.',
  },
];
function start(): string | null {
  chips?.destroy();
  chips = startSentPromptChips({ prompts, scheme: () => 'light' });
  return document.querySelector('.gv-pm-sent-chip')?.textContent ?? null;
}
it('repaired sent-chip text recognises the same saved prompt and refuses unrelated prose', async () => {
  vi.stubGlobal('location', new URL('https://gemini.google.com/app/abcdef1234'));
  document.body.innerHTML = `<user-query class="user-query-container"><div class="query-text"><p class="query-text-line" id="line">${prompts[0].text}</p></div><div id="wrong">${prompts[1].text}</div></user-query>`;
  const bundled = start();
  expect(bundled).toBe('Actual prompt');
  chips!.destroy();
  chips = null;
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#line'] });
  expect(start()).toBe(bundled);
  chips!.destroy();
  chips = null;
  retire();
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#wrong'] });
  expect(start()).toBe(bundled);
  chips!.destroy();
  chips = null;
  retire();
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#line'] });
  document.getElementById('line')!.className = 'renamed-line';
  expect(start()).toBe(bundled);
});

it('a remote first-line match cannot hide the rest of the sent instructions', async () => {
  vi.stubGlobal('location', new URL('https://gemini.google.com/app/abcdef1234'));
  document.body.innerHTML = `<user-query class="user-query-container"><div class="query-text"><p class="query-text-line" id="first">${prompts[0].text}</p><p class="query-text-line">Use my attached notes in every example.</p></div></user-query>`;
  expect(start()).toBe('Actual prompt');
  const remainder = document.querySelector('.gv-pm-sent-rest')!.textContent;
  chips!.destroy();
  chips = null;
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#first'] });
  expect(start()).toBe('Actual prompt');
  expect(document.querySelector('.gv-pm-sent-rest')?.textContent).toBe(remainder);
  expect(document.querySelectorAll('.gv-pm-sent-line')).toHaveLength(2);
});

it('an attachment filename cannot be mistaken for sent text after the native wrapper changes', async () => {
  vi.stubGlobal('location', new URL('https://gemini.google.com/app/abcdef1234'));
  document.body.innerHTML = `<user-query class="user-query-container"><div id="prompt">${prompts[0].text}</div> <span id="attachment">notes.pdf</span></user-query>`;
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#attachment'] });
  expect(readSentChipTargets(document)[0]?.lines).toEqual([]);
  retire();
  retire = await installGeminiSelectorPatch({ 'sentChips.lines': ['#prompt'] });
  expect(start()).toBe('Actual prompt');
});
