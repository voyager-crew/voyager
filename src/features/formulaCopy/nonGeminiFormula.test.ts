// @vitest-environment-options { "url": "https://aistudio.google.com/prompts/test" }
import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { extractLatexSource, findMathElement, isDisplayMode } from './formulaSource';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

it('keeps AI Studio math and its source on the shared protocol with a Gemini patch present', async () => {
  document.body.innerHTML =
    '<div class="new-math" role="math"><span data-math="x">x</span></div><ms-katex><math display="block"><annotation encoding="application/x-tex">y^2</annotation></math></ms-katex>';
  const native = document.querySelector<HTMLElement>('ms-katex')!;
  const before = [findMathElement(native), extractLatexSource(native), isDisplayMode(native)];
  stop = await installGeminiSelectorPatch({ 'code.host': ['code-block-v2'] });
  expect([findMathElement(native), extractLatexSource(native), isDisplayMode(native)]).toEqual(
    before,
  );
  expect(before).toEqual([native, 'y^2', true]);
  expect(findMathElement(document.querySelector('.new-math')!)).toBeNull();
  expect(extractLatexSource(document.querySelector<HTMLElement>('[data-math]')!)).toBe('x');
});
