// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import './__tests__/formulaCopyTestHarness';
import { afterEach, describe, expect, it } from 'vitest';

import { replaceMathWithLatex } from '@/core/utils/quotedText';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { setupFormulaCopyTestSuite } from './__tests__/formulaCopyTestHarness';
import { extractLatexSource, findMathElement, isDisplayMode } from './formulaSource';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((stop) => stop()));

function install(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body.firstElementChild as HTMLElement;
}

describe('packaged Gemini formula reads', () => {
  const context = setupFormulaCopyTestSuite();

  function click(element: Element): void {
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    context.service.initialize();
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it.each([
    {
      shape: 'inline container-owned source',
      markup:
        '<span class="math-inline" data-math="x^2"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi></mrow></semantics></math></span></span></span>',
      display: false,
      markdown: '$x^2$',
      text: 'x',
    },
    {
      shape: 'block descendant source',
      markup: '<div class="math-block"><span data-math="x^2">x²</span></div>',
      display: true,
      markdown: '$$x^2$$',
      text: 'x²',
    },
  ])(
    'keeps $shape copy and quote output when online fixes are enabled',
    async ({ markup, display, markdown, text }) => {
      const host = install(markup);
      const source = findMathElement(host)!;
      click(host);
      await Promise.resolve();
      cleanups.push(await installGeminiSelectorPatch({ 'code.host': ['code-block-v2'] }));
      expect(findMathElement(host)).toBe(source);
      expect(extractLatexSource(source)).toBe('x^2');
      expect(isDisplayMode(source)).toBe(display);
      click(host);
      await Promise.resolve();
      expect(context.writeTextMock.mock.calls).toEqual([[markdown], [markdown]]);
      const clone = document.createDocumentFragment();
      clone.append(host.cloneNode(true));
      replaceMathWithLatex(clone);
      expect(clone.textContent).toBe(markdown);
      expect(host.textContent).toBe(text);
    },
  );
});
