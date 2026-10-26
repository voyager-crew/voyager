import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { insertIntoComposer, readComposer } from '@/core/services/composer';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findChatInput } from '../index';

let retire: (() => void) | undefined;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

function showInputs(): void {
  for (const input of document.querySelectorAll<HTMLElement>('[contenteditable], textarea')) {
    input.getBoundingClientRect = () => ({ height: input.hidden ? 0 : 20, width: 200 }) as DOMRect;
  }
}

function field(id: string): HTMLElement {
  return document.getElementById(id)!;
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
});
afterEach(() => {
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  Object.defineProperty(window, 'location', originalLocation);
  vi.restoreAllMocks();
});

describe('online Gemini composer inputs', () => {
  it('keeps visible priority and hidden fallback identical through bundled and remote profiles', async () => {
    document.body.innerHTML = `<rich-textarea><div id="folded" class="remote" contenteditable="true"></div></rich-textarea>
      <div class="text-input-field"><div id="visible" class="remote" contenteditable="true" role="textbox">draft</div></div>`;
    showInputs();
    field('folded').getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    const bundled = findChatInput({ requireVisible: false });
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.remote'] });
    expect(findChatInput({ online: true, requireVisible: false })).toBe(bundled);
    expect(readComposer(findChatInput({ online: true })!)).toBe('draft');
    field('visible').getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    expect(findChatInput({ online: true, requireVisible: false })).toBe(field('folded'));
    expect(findChatInput({ online: true })).toBeNull();
  });

  it('a partial candidate list cannot replace the first mounted draft with another editor', async () => {
    document.body.innerHTML = `<textarea id="first">first draft</textarea><textarea id="second">second draft</textarea>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#second'] });
    const input = findChatInput({ online: true })!;
    insertIntoComposer(input, 'kept first', 'replace');
    expect(readComposer(field('first'))).toBe('kept first');
    expect(readComposer(field('second'))).toBe('second draft');
  });

  it('a prefix-only profile cannot hide the visible composer behind a folded candidate', async () => {
    document.body.innerHTML = `<textarea id="folded">folded</textarea><textarea id="visible">visible</textarea>`;
    showInputs();
    field('folded').getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#folded'] });
    expect(findChatInput({ online: true })).toBe(field('visible'));
    expect(readComposer(findChatInput({ online: true })!)).toBe('visible');
  });

  it('a reordered complete profile cannot send an insertion to the second mounted draft', async () => {
    document.body.innerHTML = `<textarea id="first">first</textarea><textarea id="second">second</textarea>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#second', '#first'] });
    expect(readComposer(findChatInput({ online: true })!)).toBe('first');
  });

  it('repairs a renamed main input while prompt and Vim readers retain their bundled result', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="renamed" contenteditable="true">new draft</section></div>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#renamed'] });
    expect(readComposer(findChatInput({ online: true })!)).toBe('new draft');
    expect(findChatInput()).toBeNull();
  });

  it.each([
    '.edit-container',
    '[role="dialog"]',
    'model-response',
    '.gv-test-panel',
    '.unrelated-panel',
  ])('a renamed %s input cannot stand in for the main composer', async (owner) => {
    const container = document.createElement(owner === 'model-response' ? owner : 'div');
    if (owner.startsWith('.')) container.className = owner.slice(1);
    else if (owner.startsWith('[')) container.setAttribute('role', 'dialog');
    container.innerHTML = `<section class="candidate" contenteditable="true">unrelated draft</section>`;
    if (owner !== '.unrelated-panel') {
      const native = document.createElement('div');
      native.className = 'text-input-field';
      native.append(container);
      document.body.append(native);
    } else document.body.append(container);
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.candidate'] });
    expect(findChatInput({ online: true })).toBeNull();
    // A real native owner is needed before the very same candidate can be adopted.
    document.body.innerHTML = `<div class="text-input-field"><section class="candidate" contenteditable="true">main draft</section></div>`;
    showInputs();
    expect(readComposer(findChatInput({ online: true })!)).toBe('main draft');
  });

  it('ambiguous renamed main fields remain untouched until the page proves one owner', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="one" contenteditable="true">one</section><section id="two" contenteditable="true">two</section></div>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#one'] });
    expect(findChatInput({ online: true })).toBeNull();
    field('two').remove();
    expect(readComposer(findChatInput({ online: true })!)).toBe('one');
  });

  it('a non-main alias cannot borrow proof from a different native composer', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="main" contenteditable="true">main</section></div><section id="wrong" contenteditable="true">other</section>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#wrong'] });
    expect(findChatInput({ online: true })).toBeNull();
    retire();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#main'] });
    expect(readComposer(findChatInput({ online: true })!)).toBe('main');
  });

  it('an extra remote field cannot enter the native main input collection', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="main" class="candidate" contenteditable="true">main</section></div><section class="candidate" contenteditable="true">other</section>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['.candidate'] });
    expect(findChatInput({ online: true })).toBeNull();
    retire();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#main'] });
    expect(readComposer(findChatInput({ online: true })!)).toBe('main');
  });

  it('an online snapshot cannot change the input read on another host', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="main" contenteditable="true">main</section></div>`;
    showInputs();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#main'] });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'business.gemini.google' },
    });
    expect(findChatInput({ online: true })).toBeNull();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'gemini.google.com' },
    });
    expect(readComposer(findChatInput({ online: true })!)).toBe('main');
  });

  it('an unparsable composer fix preserves working turn and sidebar fixes while dropping its whole group', async () => {
    document.body.innerHTML = `<div class="text-input-field"><section id="renamed" contenteditable="true">new draft</section></div><article class="new-turn">Question</article><nav class="new-sidebar">Chats</nav>`;
    showInputs();
    retire = await installGeminiSelectorPatch({
      'composer.candidates': ['#renamed'],
      'composer.sendContainers': ['['],
      'turn.user': ['.new-turn'],
      'sidebar.overflow': ['.new-sidebar'],
    });
    expect(findChatInput({ online: true })).toBeNull();
    expect(
      document.querySelector(getGeminiSelectorView().profiles['turn.user'].join(','))?.textContent,
    ).toBe('Question');
    expect(
      document.querySelector(getGeminiSelectorView().profiles['sidebar.overflow'].join(','))
        ?.textContent,
    ).toBe('Chats');
    retire();
    retire = await installGeminiSelectorPatch({ 'composer.candidates': ['#renamed'] });
    expect(readComposer(findChatInput({ online: true })!)).toBe('new draft');
  });

  it('OFF keeps the legacy inline editor priority without applying remote ownership guards', () => {
    document.body.innerHTML = `<div class="edit-container"><rich-textarea><div id="edit" contenteditable="true">old edit</div></rich-textarea></div><textarea>main</textarea>`;
    showInputs();
    expect(readComposer(findChatInput({ online: true })!)).toBe('old edit');
    expect(findChatInput({ online: true })).toBe(findChatInput());
  });
});
