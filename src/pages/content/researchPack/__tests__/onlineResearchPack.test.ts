import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { ensureAddButtons, removeAddButtons } from '../turnButtons';
import { captureAnswer, collectAnswerLinks, resolveAnswerElement } from '../turnCapture';
import { turn } from './fixtures';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
});
const add = () => ensureAddButtons(document, { label: 'Add to pack', onAdd: vi.fn() });
function renamedTurn(text: string): HTMLElement {
  const host = turn(`<p>${text}</p><a href="https://example.org/${text}">${text}</a>`);
  const bar = host.querySelector('.buttons-container-v2')!;
  bar.className = 'new-actions';
  bar.querySelector('button')!.setAttribute('data-test-id', 'copy-button');
  const outer = host.querySelector('message-actions')!;
  const actions = host.querySelector('.actions-container-v2')!;
  outer.replaceWith(bar);
  actions.remove();
  return host;
}
it('adds the same final button and preserves answer and source links with online action bars', async () => {
  const host = turn('<p>Answer</p><a href="https://example.org/source">Source</a>');
  const bar = host.querySelector('.buttons-container-v2')!;
  bar.classList.add('online');
  const answer = resolveAnswerElement(host);
  const sources = collectAnswerLinks(host);
  expect(add()).toBe(1);
  const firstMarkup = bar.lastElementChild!.outerHTML;
  removeAddButtons(document);
  cleanups.push(await installGeminiSelectorPatch({ 'researchPack.actionBars': ['.online'] }));
  expect(add()).toBe(1);
  expect(bar.lastElementChild!.outerHTML).toBe(firstMarkup);
  expect(resolveAnswerElement(host)).toBe(answer);
  expect(collectAnswerLinks(host)).toEqual(sources);
});
it('a renamed research action bar keeps share links out of the source list', async () => {
  const host = renamedTurn('answer');
  cleanups.push(await installGeminiSelectorPatch({ 'researchPack.actionBars': ['.new-actions'] }));
  expect(add()).toBe(1);
  expect(collectAnswerLinks(host)).toEqual([
    { url: 'https://example.org/answer', title: 'answer' },
  ]);
  expect(host.querySelector('.new-actions')!.lastElementChild!.className).toBe('gv-rp-add-btn');
});
it('a partial repaired action list falls back for every response in the scan', async () => {
  const first = renamedTurn('first');
  renamedTurn('second');
  const third = turn('<p>third</p>');
  first.querySelector('.new-actions')!.classList.add('only-first');
  third.querySelector('.buttons-container-v2')!.classList.add('only-first');
  cleanups.push(await installGeminiSelectorPatch({ 'researchPack.actionBars': ['.only-first'] }));
  expect(add()).toBe(1);
  expect(
    Array.from(document.querySelectorAll('.gv-rp-add-btn')).map((button) =>
      button.closest('model-response'),
    ),
  ).toEqual([third]);
});
it('an online content wrapper cannot become a research action bar', async () => {
  const first = renamedTurn('first');
  const second = turn('<p>second</p>');
  first.querySelector('message-content')!.classList.add('wrong');
  second.querySelector('.buttons-container-v2')!.classList.add('wrong');
  cleanups.push(await installGeminiSelectorPatch({ 'researchPack.actionBars': ['.wrong'] }));
  expect(add()).toBe(1);
  expect(document.querySelector('.gv-rp-add-btn')!.closest('model-response')).toBe(second);
});

it('an online outer action wrapper keeps Add at the bundled inner bar position', async () => {
  const host = turn('<p>Answer</p>');
  host.querySelector('message-actions')!.classList.add('wrong-outer');
  cleanups.push(await installGeminiSelectorPatch({ 'researchPack.actionBars': ['.wrong-outer'] }));
  expect(add()).toBe(1);
  expect(host.querySelector('.buttons-container-v2')!.lastElementChild!.className).toBe(
    'gv-rp-add-btn',
  );
});

it('a rejected answer locator also falls back the paired prompt before capture', async () => {
  const host = turn('<p>Answer</p>');
  host.closest('.conversation-container')!.querySelector('user-query')!.innerHTML =
    '<p>First line</p><p>Second line</p>';
  const original = captureAnswer(host, '');
  cleanups.push(
    await installGeminiSelectorPatch({
      'content.answer': ['.missing-answer'],
      'content.userLines': ['p'],
    }),
  );
  expect(captureAnswer(host, '')).toEqual(original);
  expect(captureAnswer(host, '').prompt).toBe('First lineSecond line');
});

it('a rejected action-bar locator also falls back the paired prompt before capture', async () => {
  const host = turn('<p>Answer</p>');
  host.closest('.conversation-container')!.querySelector('user-query')!.innerHTML =
    '<p>First line</p><p>Second line</p>';
  host.querySelector('message-actions')!.classList.add('wrong-outer');
  const original = captureAnswer(host, '');
  cleanups.push(
    await installGeminiSelectorPatch({
      'researchPack.actionBars': ['.wrong-outer'],
      'content.userLines': ['p'],
    }),
  );
  expect(captureAnswer(host, '')).toEqual(original);
  expect(captureAnswer(host, '').prompt).toBe('First lineSecond line');
});
