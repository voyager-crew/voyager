// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  _resetUserLatexKatexLoader,
  _setUserLatexKatexLoaderForTest,
} from '@/pages/content/userLatex';

import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
  moveToDialog,
  PluginScope,
} from './catalogConsumerFixture';
import { quoteReplyPrimitive } from './quoteReply';
import { userLatexPrimitive } from './userLatex';

let scope: PluginScope;
let retire: (() => void) | undefined;
const rect = {
  x: 20,
  y: 40,
  top: 40,
  left: 20,
  right: 180,
  bottom: 60,
  width: 160,
  height: 20,
  toJSON: () => ({}),
};
let rangeRect: PropertyDescriptor | undefined;
let rangeRects: PropertyDescriptor | undefined;
function select(): void {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('#quote')!);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}
beforeEach(() => {
  scope = new PluginScope();
  catalogConsumerPage();
  _resetUserLatexKatexLoader();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [rect],
  });
});
afterEach(async () => {
  await scope.dispose();
  retire?.();
  retire = undefined;
  _resetUserLatexKatexLoader();
  for (const [key, descriptor] of [
    ['getBoundingClientRect', rangeRect],
    ['getClientRects', rangeRects],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  }
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('Quote cannot insert text after the selected response becomes a dialog preview', async () => {
  retire = await catalogConsumerPatch();
  void quoteReplyPrimitive.activate(scope, {}, catalogConsumerContext());
  select();
  const button = document.querySelector<HTMLButtonElement>('.gv-quote-reply-button')!;
  expect(button).not.toBeNull();
  document.querySelector('main')!.setAttribute('role', 'dialog');
  button.click();
  expect(document.querySelector('textarea')!.value).toBe('');
  expect(document.querySelector('.gv-quote-reply-button')).toBeNull();
  document.querySelector('main')!.removeAttribute('role');
  select();
  document.querySelector<HTMLButtonElement>('.gv-quote-reply-button')!.click();
  expect(document.querySelector('textarea')!.value).toBe('> Answer\n');
});

it('Quote preserves the same selected text through bundled and remote data', async () => {
  catalogConsumerPage(true);
  void quoteReplyPrimitive.activate(scope, {}, catalogConsumerContext());
  select();
  document.querySelector<HTMLButtonElement>('.gv-quote-reply-button')!.click();
  const baseline = document.querySelector('textarea')!.value;
  expect(baseline).toBe('> Answer\n');
  await scope.dispose();
  scope = new PluginScope();
  document.querySelector('textarea')!.value = '';
  retire = await catalogConsumerPatch();
  void quoteReplyPrimitive.activate(scope, {}, catalogConsumerContext());
  select();
  document.querySelector<HTMLButtonElement>('.gv-quote-reply-button')!.click();
  expect(document.querySelector('textarea')!.value).toBe(baseline);
});

it('a repaired user turn that moves to a dialog while KaTeX loads keeps its original text', async () => {
  retire = await catalogConsumerPatch();
  let release!: () => void;
  const renderToString = (source: string) => `<span class="katex">${source}</span>`;
  _setUserLatexKatexLoaderForTest(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ default: { renderToString } } as unknown as typeof import('katex'));
      }),
  );
  void userLatexPrimitive.activate(scope, {}, catalogConsumerContext());
  const prompt = document.querySelector('.prompt')!;
  moveToDialog(prompt);
  release();
  await vi.waitFor(() => expect(prompt.hasAttribute('data-user-latex-processed')).toBe(false));
  expect(prompt.textContent).toBe('Question $x$');
  document.querySelector('main')!.append(prompt);
  await vi.waitFor(() => expect(prompt.querySelector('.katex')?.textContent).toBe('x'));
});

it('a later dialog user alias is never rendered by the next LaTeX scan', async () => {
  retire = await catalogConsumerPatch();
  _setUserLatexKatexLoaderForTest(
    async () =>
      ({
        default: {
          renderToString: (source: string) => `<span class="katex">${source}</span>`,
        },
      }) as unknown as typeof import('katex'),
  );
  void userLatexPrimitive.activate(scope, {}, catalogConsumerContext());
  await vi.waitFor(() => expect(document.querySelector('.prompt .katex')?.textContent).toBe('x'));
  const preview = document.createElement('section');
  preview.className = 'prompt';
  preview.setAttribute('data-message-role', 'user');
  preview.textContent = 'Preview $y$';
  moveToDialog(preview);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(preview.textContent).toBe('Preview $y$');
  expect(preview.innerHTML).toBe('Preview $y$');
});
