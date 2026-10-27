import { afterEach, describe, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getBundledGeminiSelectorView } from '../selectors';
import { geminiAnswerChain, renameGeminiAnswer } from './__tests__/answerFixture';
import { readGeminiContextImages, readGeminiUserLines, resolveGeminiAnswerElement } from './reads';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
});
function render(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body.firstElementChild as HTMLElement;
}
async function patch(selectors: Parameters<typeof installGeminiSelectorPatch>[0]) {
  cleanups.push(await installGeminiSelectorPatch(selectors));
}

describe('Gemini content reads', () => {
  it('keeps the same answer and every prompt line through bundled and online profiles', async () => {
    const host = render(
      '<model-response><message-content class="answer"><p>Answer</p></message-content></model-response>',
    );
    const answer = resolveGeminiAnswerElement(host);
    await patch({ 'content.answer': ['.answer'], 'content.userLines': ['p.line'] });
    expect(resolveGeminiAnswerElement(host)).toBe(answer);
    const prompt = render(
      '<user-query><p class="query-text-line line">First</p><p class="query-text-line line">Second</p></user-query>',
    );
    expect(Array.from(readGeminiUserLines(prompt))).toEqual(
      Array.from(readGeminiUserLines(prompt, getBundledGeminiSelectorView())),
    );
  });

  it('repairs renamed answer and prompt containers only when the complete native content agrees', async () => {
    await patch({ 'content.answer': ['.answer'], 'content.userLines': ['.line'] });
    const host = render(
      '<model-response><div class="answer"><p>Prose</p><pre><code>code</code></pre><span data-math="x">x</span><img src="image.png"></div><message-actions><button>Copy</button></message-actions></model-response>',
    );
    expect(resolveGeminiAnswerElement(host)).toBe(host.firstElementChild);
    const prompt = render(
      '<user-query><p class="line">First</p><p class="line">Second</p></user-query>',
    );
    expect(Array.from(readGeminiUserLines(prompt), (line) => line.textContent)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('repairs a renamed markdown answer through the real Angular response chain', async () => {
    const host = render(
      geminiAnswerChain(
        '<p>Prose</p><ol><li>Step</li></ol><h3>Heading</h3><blockquote><p>Quote</p></blockquote><ul><li>Tail</li></ul>',
      ),
    );
    const answer = renameGeminiAnswer(host);
    expect(resolveGeminiAnswerElement(host)).toBe(host);
    await patch({ 'content.answer': ['.answer-surface'] });
    expect(resolveGeminiAnswerElement(host)).toBe(answer);
    expect(resolveGeminiAnswerElement(host).textContent).toBe('ProseStepHeadingQuoteTail');
  });

  it.each([
    ['h3', ''],
    ['pre', ''],
    ['code', ''],
    ['a', ''],
    ['li', ''],
    ['table', ''],
    ['blockquote', ''],
    ['math', ''],
    ['span', 'katex'],
    ['div', 'image-container'],
    ['div', 'gv-export-content'],
  ])('keeps the full answer when a repair would strip a %s %s frame', async (tag, className) => {
    const host = render(geminiAnswerChain('<p>Complete answer</p>'));
    const answer = renameGeminiAnswer(host);
    await patch({ 'content.answer': ['.answer-surface'] });
    expect(resolveGeminiAnswerElement(host)).toBe(answer);
    const frame = document.createElement(tag);
    frame.className = className;
    answer.replaceWith(frame);
    frame.append(answer);
    expect(resolveGeminiAnswerElement(host)).toBe(host);
    expect(resolveGeminiAnswerElement(host).textContent).toContain('Complete answer');
  });

  it('exports the complete answer when an online match selects one paragraph', async () => {
    const host = render(
      '<model-response><message-content><p class="partial">First</p><p>Second</p></message-content></model-response>',
    );
    await patch({ 'content.answer': ['.partial'] });
    expect(resolveGeminiAnswerElement(host).textContent).toBe('FirstSecond');
    expect(resolveGeminiAnswerElement(host)).toBe(host.firstElementChild);
  });

  it('keeps the entire renamed answer when an online locator omits prose or an image', async () => {
    const host = render(
      '<model-response><div><div class="partial"><p>First</p></div><p>Second</p><img src="image.png"></div></model-response>',
    );
    await patch({ 'content.answer': ['.partial'] });
    expect(resolveGeminiAnswerElement(host)).toBe(host);
    expect(resolveGeminiAnswerElement(host).querySelector('img')?.getAttribute('src')).toBe(
      'image.png',
    );
  });

  it('keeps the operation host when a nested response impersonates its answer', async () => {
    const host = render(
      '<model-response><model-response><div class="answer">Foreign</div></model-response></model-response>',
    );
    await patch({ 'content.answer': ['.answer'] });
    expect(resolveGeminiAnswerElement(host)).toBe(host);
  });

  it('keeps both native prompt lines when an online list loses the second line', async () => {
    const host = render(
      '<user-query><p class="query-text-line chosen">First</p><p class="query-text-line">Second</p></user-query>',
    );
    await patch({ 'content.userLines': ['.chosen'] });
    expect(Array.from(readGeminiUserLines(host), (line) => line.textContent)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('does not turn a partial native paragraph or a nested prompt into a repaired user message', async () => {
    const host = render(
      '<user-query><p class="line">Partial</p>Missing tail<user-query><p class="line">Other</p></user-query></user-query>',
    );
    await patch({ 'content.userLines': ['.line'] });
    expect(Array.from(readGeminiUserLines(host))).toEqual(
      Array.from(readGeminiUserLines(host, getBundledGeminiSelectorView())),
    );
    expect(host.textContent).toBe('PartialMissing tailOther');
  });

  it('a paragraph repair cannot drop plain text outside the native paragraph', async () => {
    const host = render('<user-query><p class="line">Partial</p>Missing tail</user-query>');
    await patch({ 'content.userLines': ['.line'] });
    expect(Array.from(readGeminiUserLines(host))).toEqual(
      Array.from(readGeminiUserLines(host, getBundledGeminiSelectorView())),
    );
    host.lastChild!.remove();
    expect(Array.from(readGeminiUserLines(host), (line) => line.textContent)).toEqual(['Partial']);
  });

  it('a nested prompt cannot supply the original turn text during a paragraph repair', async () => {
    const host = render(
      '<user-query><user-query><p class="line">Foreign prompt</p></user-query></user-query>',
    );
    await patch({ 'content.userLines': ['.line'] });
    expect(Array.from(readGeminiUserLines(host))).toEqual(
      Array.from(readGeminiUserLines(host, getBundledGeminiSelectorView())),
    );
    host.innerHTML = '<p class="line">Current prompt</p>';
    expect(Array.from(readGeminiUserLines(host), (line) => line.textContent)).toEqual([
      'Current prompt',
    ]);
  });

  it('keeps the image order and repairs a renamed wrapper with native full-size source evidence', async () => {
    const host = render(
      '<model-response><single-image><img class="image" src="one.png"></single-image><generated-image><img class="image" src="two.png"></generated-image></model-response>',
    );
    const bundled = readGeminiContextImages(host);
    await patch({ 'context.images': ['.image'] });
    expect(readGeminiContextImages(host)).toEqual(bundled);
    host.innerHTML =
      '<div data-full-size-image-uri="full.png"><img class="image" src="one.png"></div>';
    expect(readGeminiContextImages(host).map((image) => image.getAttribute('src'))).toEqual([
      'one.png',
    ]);
  });

  it('a partial image list falls back with both attachments in their original order', async () => {
    const host = render(
      '<model-response><single-image><img class="chosen" src="one.png"><img src="two.png"></single-image></model-response>',
    );
    await patch({ 'context.images': ['.chosen'] });
    expect(readGeminiContextImages(host).map((image) => image.getAttribute('src'))).toEqual([
      'one.png',
      'two.png',
    ]);
  });

  it('a renamed image list cannot omit a second native full-size image', async () => {
    const host = render(
      '<model-response><div data-full-size-image-uri="one-full.png"><img class="chosen" src="one.png"></div><div data-full-size-image-uri="two-full.png"><img src="two.png"></div></model-response>',
    );
    await patch({ 'context.images': ['.chosen'] });
    expect(readGeminiContextImages(host)).toEqual(
      readGeminiContextImages(host, getBundledGeminiSelectorView()),
    );
    host.lastElementChild!.remove();
    expect(readGeminiContextImages(host).map((image) => image.getAttribute('src'))).toEqual([
      'one.png',
    ]);
  });

  it('an avatar cannot become a downloaded context attachment through a broad online match', async () => {
    const host = render(
      '<model-response><img class="avatar" src="avatar.png"><div data-full-size-image-uri="full.png"><img src="content.png"></div></model-response>',
    );
    await patch({ 'context.images': ['img'] });
    expect(readGeminiContextImages(host)).toEqual(
      readGeminiContextImages(host, getBundledGeminiSelectorView()),
    );
    host.querySelector('.avatar')!.remove();
    expect(readGeminiContextImages(host).map((image) => image.getAttribute('src'))).toEqual([
      'content.png',
    ]);
  });
});
