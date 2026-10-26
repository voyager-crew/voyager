import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { getInputContainer, isInputEmpty, isInputRelatedElement } from '../dom';
import { collapseInputNow, expand, setCollapseWhenNotEmpty } from '../runtime';

let retire: (() => void) | undefined;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

function input(id: string, wrapper = 'rich-textarea'): HTMLElement {
  const container = document.createElement('div');
  container.id = id;
  container.className = 'input-area';
  container.style.backgroundColor = '#fff';
  container.innerHTML = `<${wrapper} class="remote"><div contenteditable="true" class="ql-editor"></div></${wrapper}>`;
  document.body.append(container);
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com', pathname: '/app/chat' },
  });
  setCollapseWhenNotEmpty(false);
});

afterEach(() => {
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  Object.defineProperty(window, 'location', originalLocation);
  vi.useRealTimers();
});

describe('online input collapse', () => {
  it('keeps the same input, attachment state and related menus through bundled and remote reads', async () => {
    const container = input('main');
    input('second');
    const bundled = getInputContainer();
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBe(bundled);
    collapseInputNow();
    expect(container.classList.contains('gv-input-collapsed')).toBe(true);
    expand(container);
    expect(container.classList.contains('gv-input-collapsed')).toBe(false);
    container.append(document.createElement('uploader-file-preview'));
    expect(isInputEmpty(container)).toBe(false);
    const menu = document.createElement('div');
    menu.className = 'cdk-overlay-container';
    document.body.append(menu);
    expect(isInputRelatedElement(menu, container)).toBe(true);
  });

  it('a partial remote list cannot collapse the second mounted draft', async () => {
    const first = input('first');
    const second = input('second');
    retire = await installGeminiSelectorPatch({
      'inputCollapse.wrapper': ['#second rich-textarea'],
    });
    collapseInputNow();
    expect(first.classList.contains('gv-input-collapsed')).toBe(true);
    expect(second.classList.contains('gv-input-collapsed')).toBe(false);
  });

  it('an extra remote wrapper cannot replace the bundled visual island', async () => {
    const wrong = input('wrong', 'section');
    const right = input('right');
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    collapseInputNow();
    expect(right.classList.contains('gv-input-collapsed')).toBe(true);
    expect(wrong.classList.contains('gv-input-collapsed')).toBe(false);
  });

  it('a renamed wrapper retains its identity when collapse hides its editor', async () => {
    const main = input('main', 'section');
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBe(main);
    collapseInputNow();
    main.classList.add('gv-input-collapse-processed');
    main.classList.add('gv-input-vim-hud-composer-mount');
    main.querySelector<HTMLElement>('[contenteditable]')!.style.visibility = 'hidden';
    expect(getInputContainer()).toBe(main);
    expand(getInputContainer()!);
    await vi.advanceTimersByTimeAsync(1);
    expect(document.activeElement).toBe(main.querySelector('[contenteditable]'));
  });

  it('a page background cannot make a renamed input collapse the entire page', async () => {
    const main = input('main', 'section');
    document.body.style.backgroundColor = '#eee';
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBeNull();
    document.body.style.removeProperty('background-color');
    expect(getInputContainer()).toBe(main);
  });

  it('a renamed wrapper keeps a plaintext-only draft expanded until its content is empty', async () => {
    const main = input('main', 'section');
    const editor = main.querySelector<HTMLElement>('[contenteditable]')!;
    editor.setAttribute('contenteditable', 'plaintext-only');
    editor.textContent = 'unsent draft';
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    collapseInputNow();
    expect(isInputEmpty(main)).toBe(false);
    expect(main.classList.contains('gv-input-collapsed')).toBe(false);
    editor.textContent = '';
    collapseInputNow();
    expect(main.classList.contains('gv-input-collapsed')).toBe(true);
  });

  it('expanding a renamed textarea wrapper focuses the accepted editor without moving another input', async () => {
    const main = input('main', 'section');
    main.querySelector('[contenteditable]')!.remove();
    const editor = document.createElement('textarea');
    editor.value = 'unsent';
    main.querySelector('section')!.append(editor);
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    collapseInputNow();
    expect(isInputEmpty(main)).toBe(false);
    expect(main.classList.contains('gv-input-collapsed')).toBe(false);
    setCollapseWhenNotEmpty(true);
    collapseInputNow();
    expand(main, true);
    await vi.advanceTimersByTimeAsync(1);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('unsent');
  });

  it('ambiguous renamed editors cannot hide a draft until there is one native input', async () => {
    const main = input('main', 'section');
    const extra = document.createElement('textarea');
    main.append(extra);
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBeNull();
    extra.remove();
    expect(getInputContainer()).toBe(main);
  });

  it('a wrapper around unrelated content cannot borrow another input identity', async () => {
    const main = input('main', 'section');
    main.querySelector('.remote')!.classList.remove('remote');
    const wrong = document.createElement('section');
    wrong.className = 'remote';
    main.append(wrong);
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBeNull();
    main.querySelector('[contenteditable]')!.parentElement!.classList.add('remote');
    wrong.remove();
    expect(getInputContainer()).toBe(main);
  });

  it('a remote ancestor cannot hide a larger panel than the native input island', async () => {
    const main = input('main', 'section');
    const ancestor = document.createElement('article');
    main.before(ancestor);
    ancestor.append(main);
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['article'] });
    expect(getInputContainer()).toBeNull();
    retire();
    retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
    expect(getInputContainer()).toBe(main);
  });

  it.each(['model-response', 'dialog', '.gv-other-feature', '.edit-container'])(
    'a renamed %s editor never becomes the collapse input',
    async (owner) => {
      const main = input('main', 'section');
      const other = document.createElement(owner.startsWith('.') ? 'div' : owner);
      if (owner.startsWith('.')) other.className = owner.slice(1);
      main.before(other);
      other.append(main);
      retire = await installGeminiSelectorPatch({ 'inputCollapse.wrapper': ['.remote'] });
      expect(getInputContainer()).toBeNull();
      document.body.append(main);
      expect(getInputContainer()).toBe(main);
    },
  );

  it('OFF preserves the hidden inline edit input and attachment fallback', () => {
    const main = input('main');
    main.classList.add('edit-container');
    main.hidden = true;
    const preview = document.createElement('div');
    preview.className = 'file-preview-wrapper';
    main.append(preview);
    expect(getInputContainer()).toBe(main);
    expect(isInputEmpty(main)).toBe(false);
    preview.remove();
    expect(isInputEmpty(main)).toBe(true);
  });
});
