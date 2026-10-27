import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import {
  injectResponseActionCopyImageButtons,
  removeResponseActionCopyImageButtons,
} from '../responseActionImageButton';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
});
function response(id: string, bundled = true): HTMLElement {
  const host = document.createElement('model-response');
  host.id = id;
  host.innerHTML = `<message-content>Answer ${id}</message-content><div class="${bundled ? 'message-actions ' : ''}online-bar ${id}"><button class="style-${id}" data-test-id="copy-button"><mat-icon>content_copy</mat-icon></button><button data-test-id="more-menu-button"><mat-icon>more_vert</mat-icon></button></div>`;
  document.body.append(host);
  return host;
}
const inject = (root: ParentNode = document) =>
  injectResponseActionCopyImageButtons(root, {
    label: 'Copy as image',
    tooltip: 'Copy as image',
    onClick: vi.fn(),
  });
function describeButtons(buttons: HTMLElement[]) {
  return buttons.map((button) => ({
    owner: button.closest('model-response')?.id,
    className: button.className,
    next: button.nextElementSibling?.getAttribute('data-test-id'),
  }));
}
it('clones the same response button in the same position with bundled and online bars', async () => {
  response('first');
  response('second');
  const baseline = describeButtons(inject());
  removeResponseActionCopyImageButtons();
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.online-bar'] }));
  expect(describeButtons(inject())).toEqual(baseline);
  expect(describeButtons(inject()).map((item) => item.owner)).toEqual(['first', 'second']);
});
it('a partial online bar list keeps both responses and their own clone styles', async () => {
  response('first');
  response('second');
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.first'] }));
  expect(describeButtons(inject())).toEqual([
    { owner: 'first', className: 'style-first', next: 'more-menu-button' },
    { owner: 'second', className: 'style-second', next: 'more-menu-button' },
  ]);
});
it('an oversized online bar cannot clone a control from another response', async () => {
  response('first');
  response('second');
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['body'] }));
  expect(describeButtons(inject()).map((item) => [item.owner, item.className])).toEqual([
    ['first', 'style-first'],
    ['second', 'style-second'],
  ]);
});
it('a renamed action bar is repaired when a copy-icon mutation starts the read', async () => {
  const host = response('first', false);
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.online-bar'] }));
  const icon = host.querySelector<HTMLElement>('mat-icon')!;
  expect(describeButtons(inject(icon))).toEqual([
    { owner: 'first', className: 'style-first', next: 'more-menu-button' },
  ]);
});
it('a renamed bar containing response text falls back for the whole scan', async () => {
  const first = response('first', false);
  first.className = 'wrong';
  const second = response('second');
  second.querySelector('.message-actions')!.classList.add('wrong');
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.wrong'] }));
  expect(describeButtons(inject())).toEqual([
    { owner: 'second', className: 'style-second', next: 'more-menu-button' },
  ]);
});

it('a response host cannot become the action bar when its content has not mounted yet', async () => {
  const first = response('first', false);
  first.querySelector('message-content')!.remove();
  first.className = 'wrong-root';
  const second = response('second');
  second.querySelector('.message-actions')!.classList.add('wrong-root');
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.wrong-root'] }));
  expect(describeButtons(inject())).toEqual([
    { owner: 'second', className: 'style-second', next: 'more-menu-button' },
  ]);
});

it('a wider bar cannot replace the response copy control with a styled decoy', async () => {
  const host = response('first');
  const wrapper = document.createElement('div');
  wrapper.className = 'outer';
  const bar = host.querySelector('.message-actions')!;
  bar.before(wrapper);
  wrapper.innerHTML = '<button data-test-id="copy-button" class="wrong-style"></button>';
  wrapper.append(bar);
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.outer'] }));
  expect(describeButtons(inject())).toEqual([
    { owner: 'first', className: 'style-first', next: 'more-menu-button' },
  ]);
});
it('a renamed wrapper containing prose cannot receive a response action', async () => {
  const first = response('first', false);
  const wrapper = document.createElement('section');
  wrapper.className = 'wrong';
  wrapper.append(...Array.from(first.children));
  first.append(wrapper);
  const second = response('second');
  second.querySelector('.message-actions')!.classList.add('wrong');
  cleanups.push(await installGeminiSelectorPatch({ 'responseActions.bars': ['.wrong'] }));
  expect(describeButtons(inject())).toEqual([
    { owner: 'second', className: 'style-second', next: 'more-menu-button' },
  ]);
});

it('repeated scans update the injected button without rereading native icon text', () => {
  const host = response('first');
  host.querySelector('[data-test-id="copy-button"]')!.removeAttribute('data-test-id');
  const icons = Array.from(host.querySelectorAll('mat-icon'));
  let nativeTextReads = 0;
  for (const icon of icons) {
    const text = icon.textContent;
    Object.defineProperty(icon, 'textContent', {
      configurable: true,
      get: () => {
        nativeTextReads++;
        return text;
      },
    });
  }
  const first = inject();
  expect(describeButtons(first)).toEqual([
    { owner: 'first', className: 'style-first', next: 'more-menu-button' },
  ]);
  expect(nativeTextReads).toBeGreaterThan(0);
  nativeTextReads = 0;
  const onClick = vi.fn();
  const repeated = injectResponseActionCopyImageButtons(document, {
    label: 'Updated image copy',
    tooltip: 'Updated image copy',
    onClick,
  });
  expect(repeated).toEqual(first);
  expect(repeated[0].title).toBe('Updated image copy');
  repeated[0].click();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(nativeTextReads).toBe(0);
});
