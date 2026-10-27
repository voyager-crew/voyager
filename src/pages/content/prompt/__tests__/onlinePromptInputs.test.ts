import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readChatInput } from '@/core/gemini/composer/inputs';
import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import {
  inputFromTarget as historyInput,
  isPromptInput,
  promptTypeForInput,
} from '../../promptHistory/promptInput';
import { resolvePromptInputOperation } from '../selectorInput';
import {
  findPromptInputForSendButton,
  findSlashFormInput,
  inputFromTarget,
} from '../slashInputTargets';
import { expandAllPromptTokens } from '../slashPlacements';
import { setRect } from './slashPromptTestHarness';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let retire: (() => void) | undefined;
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
  document.body.innerHTML = '';
});
afterEach(() => {
  Object.defineProperty(window, 'location', originalLocation);
  retire?.();
  retire = undefined;
  document.body.innerHTML = '';
});

function input(id: string): HTMLElement {
  const node = document.getElementById(id)!;
  setRect(node);
  return node;
}

describe('online prompt owners', () => {
  it('keeps form, send, edit-history and hidden fallback identities with equivalent profiles', async () => {
    document.body.innerHTML =
      '<form><textarea id="main"></textarea><button id="send">Send</button></form><div class="edit-container"><textarea id="old"></textarea></div>';
    const main = input('main');
    const old = input('old');
    const form = document.querySelector('form')!;
    const button = document.getElementById('send')!;
    const snapshot = () => [
      inputFromTarget(main),
      findSlashFormInput(form),
      findPromptInputForSendButton(button, (candidate) => candidate === main),
      historyInput(old),
      promptTypeForInput(old),
    ];
    const bundled = snapshot();
    retire = await installGeminiSelectorPatch({
      'slash.candidates': ['#main', '#old'],
      'promptHistory.candidates': ['#main', '#old'],
    });
    expect(snapshot()).toEqual(bundled);
    expect(bundled).toEqual([main, main, main, old, 'edited']);
    main.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    old.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    expect(inputFromTarget(main)).toBe(main);
  });

  it('a partial profile keeps the current input but falls back for the entire accepted read session', async () => {
    document.body.innerHTML = '<textarea id="first"></textarea><textarea id="second"></textarea>';
    const first = input('first');
    input('second');
    const read = (selectors: readonly string[]) =>
      readChatInput(selectors, { requireVisible: false });
    retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#first'] });
    const partial = resolvePromptInputOperation('slash.candidates', read);
    expect(partial.value).toBe(first);
    expect(partial.view).toBe(getBundledGeminiSelectorView());
    retire();
    retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#first, #second'] });
    const complete = resolvePromptInputOperation('slash.candidates', read);
    expect(complete.value).toBe(first);
    expect(complete.view.remoteKeys.has('slash.candidates')).toBe(true);
  });

  it('a partial or reordered remote list cannot expand the second mounted draft', async () => {
    document.body.innerHTML =
      '<form><textarea id="first"></textarea><textarea id="second"></textarea></form>';
    const first = input('first');
    const second = input('second');
    const form = document.querySelector('form')!;
    for (const selectors of [['#second'], ['#second', '#first']]) {
      retire = await installGeminiSelectorPatch({
        'slash.candidates': selectors,
        'promptHistory.candidates': selectors,
      });
      expect(findSlashFormInput(form)).toBe(first);
      expect(inputFromTarget(first)).toBe(first);
      expect(isPromptInput(first)).toBe(true);
      expect(historyInput(second)).toBeNull();
      retire();
    }
  });

  it('a disabled first match cannot redirect form expansion away from the accepted editor', async () => {
    for (const markup of [
      '<textarea id="main"></textarea>',
      '<section id="main" contenteditable="true"></section>',
    ]) {
      document.body.innerHTML = `<input-area-v2><form><input id="wrong" readonly>${markup}</form></input-area-v2>`;
      const main = input('main');
      retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#wrong, #main'] });
      expect(findSlashFormInput(document.querySelector('form')!)).toBe(
        markup.startsWith('<textarea') ? main : null,
      );
      retire();
      retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#main'] });
      expect(findSlashFormInput(document.querySelector('form')!)).toBe(main);
      retire();
    }
  });

  it('renamed main editors work for slash and history when native ownership proves them', async () => {
    document.body.innerHTML =
      '<input-area-v2><form><section id="renamed" contenteditable="true"></section><button id="send">Send</button></form></input-area-v2>';
    const editor = input('renamed');
    expect(inputFromTarget(editor)).toBeNull();
    retire = await installGeminiSelectorPatch({
      'slash.candidates': ['#renamed'],
      'promptHistory.candidates': ['#renamed'],
    });
    expect(inputFromTarget(editor)).toBe(editor);
    expect(historyInput(editor)).toBe(editor);
    editor.classList.add('gv-input-vim-mode-normal');
    editor.closest('input-area-v2')!.classList.add('gv-input-collapse-processed');
    editor.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    expect(inputFromTarget(editor)).toBe(editor);
    expect(historyInput(editor)).toBe(editor);
    expect(findSlashFormInput(document.querySelector('form')!)).toBe(editor);
    expect(findPromptInputForSendButton(document.getElementById('send')!, () => true)).toBe(editor);
  });

  it('teardown expands a token that Gemini moved into its renamed replacement editor', async () => {
    document.body.innerHTML =
      '<input-area-v2><section id="main" contenteditable="true"><span class="gv-pm-slash-token" data-gv-prompt-text="Full prompt body">Name</span></section></input-area-v2>';
    const main = input('main');
    retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#main'] });
    expandAllPromptTokens();
    expect(main.textContent).toBe('Full prompt body');
  });

  it('Enterprise shares Gemini input fixes while another site keeps its own packaged input', async () => {
    document.body.innerHTML =
      '<input-area-v2><section id="main" contenteditable="true"></section></input-area-v2>';
    const main = input('main');
    retire = await installGeminiSelectorPatch({ 'slash.candidates': ['#main'] });
    expect(inputFromTarget(main)).toBe(main);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'business.gemini.google' },
    });
    expect(inputFromTarget(main)).toBe(main);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'aistudio.google.com' },
    });
    expect(inputFromTarget(main)).toBeNull();
  });

  it('a response editor cannot steal a renamed main editor through a valid remote locator', async () => {
    document.body.innerHTML =
      '<input-area-v2><section id="main" contenteditable="true"></section></input-area-v2><model-response><form><section id="wrong" contenteditable="true"></section></form></model-response>';
    const main = input('main');
    const wrong = input('wrong');
    retire = await installGeminiSelectorPatch({
      'slash.candidates': ['#wrong'],
      'promptHistory.candidates': ['#wrong'],
    });
    expect(inputFromTarget(wrong)).toBeNull();
    expect(historyInput(wrong)).toBeNull();
    retire();
    retire = await installGeminiSelectorPatch({
      'slash.candidates': ['#main'],
      'promptHistory.candidates': ['#main'],
    });
    expect(inputFromTarget(main)).toBe(main);
    expect(historyInput(main)).toBe(main);
  });
});
