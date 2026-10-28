import { afterEach, beforeEach, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { readContentStyle } from '@/tests/contentStyle';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { createVimCommands } from '../vimCommands';
import type { VimMode } from '../vimCommands';
import { createVimEditor } from '../vimDomEditor';
import { createVimPresentation } from '../vimPresentation';

function rect(left = 0, top = 0, width = 320, height = 24): DOMRect {
  return {
    height,
    width,
    top,
    left,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => {},
  } as DOMRect;
}

export function setVimTestSite(hostname: string): void {
  setPageUrl(`https://${hostname}/`);
}

export function setupVimTestEnvironment(): void {
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  const rangeBox = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    setVimTestSite('gemini.google.com');
    mockCollapsedCaretRects();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.querySelector('[data-vim-test-styles]')?.remove();
    vi.restoreAllMocks();
    resetPageUrl();
    for (const [key, descriptor] of [
      ['getClientRects', rangeRects],
      ['getBoundingClientRect', rangeBox],
    ] as const) {
      if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
      else Reflect.deleteProperty(Range.prototype, key);
    }
  });
}

export function setVisibleRect(element: HTMLElement): void {
  element.getBoundingClientRect = () => rect();
}

export function setScrollableRect(element: HTMLElement, height: number, width = 320): void {
  let scrollTop = 0;
  let scrollLeft = 0;
  element.getBoundingClientRect = () => rect(0, 0, width, height);
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: height * 4 },
    clientWidth: { configurable: true, value: width },
    scrollWidth: { configurable: true, value: width },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    },
  });
}

export function mockInputVimModeStorage(enabled: boolean): void {
  (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_defaults: Record<string, unknown>, callback: (result: Record<string, unknown>) => void) => {
      callback({ [StorageKeys.INPUT_VIM_MODE]: enabled });
    },
  );
}

export function createQuestionInput(text = 'hello'): HTMLElement {
  document.body.innerHTML = `<rich-textarea><div id="question-input" contenteditable="true" role="textbox">${text}</div></rich-textarea>`;
  const input = document.getElementById('question-input')!;
  setVisibleRect(input);
  input.focus = vi.fn();
  input.blur = vi.fn();
  return input;
}

export function createQuillParagraphInput(lines: string[]): HTMLElement {
  document.body.innerHTML = `<rich-textarea><div id="question-input" class="ql-editor" contenteditable="true" role="textbox">${lines.map((line) => (line ? `<p>${line}</p>` : '<p><br></p>')).join('')}</div></rich-textarea>`;
  const input = document.getElementById('question-input')!;
  Object.defineProperty(input, 'innerText', { configurable: true, get: () => lines.join('\n') });
  setVisibleRect(input);
  input.focus = vi.fn();
  input.blur = vi.fn();
  return input;
}

export function createQuillInlineNewlineInput(text: string): HTMLElement {
  document.body.innerHTML =
    '<rich-textarea><div id="question-input" class="ql-editor" contenteditable="true" role="textbox"><p></p></div></rich-textarea>';
  const input = document.getElementById('question-input')!;
  input.querySelector('p')!.textContent = text;
  setVisibleRect(input);
  input.focus = vi.fn();
  input.blur = vi.fn();
  return input;
}

export function setParagraphRects(input: HTMLElement, topByLine: number[]): void {
  Array.from(input.children).forEach((child, index) => {
    (child as HTMLElement).getBoundingClientRect = () =>
      rect(80, topByLine[index] ?? 10 + index * 20, 280, 18);
  });
}

export function getParagraphTexts(input: HTMLElement): string[] {
  return Array.from(input.children).map((child) => child.textContent ?? '');
}

export function addToolboxLabel(options: { hidden?: boolean; text?: string } = {}): HTMLElement {
  const label = document.createElement('div');
  label.className = 'toolbox-drawer-button-label-icon-text';
  label.innerHTML = `<span>${options.text ?? 'Tools'}</span>`;
  label.getBoundingClientRect = () => rect(0, 0, options.hidden ? 0 : 80, options.hidden ? 0 : 24);
  const drawer = document.createElement('toolbox-drawer');
  drawer.appendChild(label);
  document.body.appendChild(drawer);
  return label;
}

export function addPromptComposer(input: HTMLElement): HTMLElement {
  const richTextarea = input.closest('rich-textarea')!;
  const composer = document.createElement('div');
  composer.className = 'text-input-field';
  composer.getBoundingClientRect = () => rect(20, 0, 420, 64);
  input.getBoundingClientRect = () => rect(74, 20, 320, 24);
  richTextarea.replaceWith(composer);
  composer.appendChild(richTextarea);
  return composer;
}

export function addEditPromptInput(value = 'hello') {
  const editContainer = document.createElement('div');
  editContainer.className = 'query-content edit-mode';
  editContainer.innerHTML =
    '<div class="edit-container"><mat-form-field class="edit-form"><div class="mat-mdc-text-field-wrapper"><textarea aria-label="Edit prompt"></textarea></div></mat-form-field></div>';
  document.body.prepend(editContainer);
  const input = editContainer.querySelector('textarea')!;
  const editForm = editContainer.querySelector<HTMLElement>('.edit-form')!;
  const wrapper = editContainer.querySelector<HTMLElement>('.mat-mdc-text-field-wrapper')!;
  input.value = value;
  input.focus = vi.fn();
  editForm.getBoundingClientRect = () => rect(20, 0, 484, 152);
  wrapper.getBoundingClientRect = () => rect(20, 0, 484, 136);
  input.getBoundingClientRect = () => rect(48, 20, 428, 96);
  return { editForm, input, wrapper };
}

export function createTextareaInput(value: string): HTMLTextAreaElement {
  document.body.innerHTML = `<textarea id="question-input">${value}</textarea>`;
  const input = document.querySelector('textarea')!;
  setVisibleRect(input);
  input.focus = vi.fn();
  return input;
}

export function fireWindowKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

export function fireInputKey(
  input: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  input.dispatchEvent(event);
  return event;
}

export function fireCtrlInputKey(input: HTMLElement, key: string): KeyboardEvent {
  return fireInputKey(input, key, { ctrlKey: true });
}

export function fireClick(input: HTMLElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

export function setContentEditableSelection(input: HTMLElement, offset: number): void {
  const range = document.createRange();
  range.setStart(input.firstChild!, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

export function setParagraphSelection(input: HTMLElement, lineIndex: number, offset = 0): void {
  const paragraph = input.children[lineIndex];
  const textNode = Array.from(paragraph.childNodes).find((node) => node instanceof Text);
  const range = document.createRange();
  range.setStart(textNode ?? paragraph, textNode ? offset : 0);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function mockRangeRects(readRects: (range: Range) => DOMRect[]): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      return readRects(this) as unknown as DOMRectList;
    },
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range) {
      return readRects(this)[0] ?? rect(0, 0, 0, 0);
    },
  });
}

export function mockCollapsedCaretRects(): void {
  mockRangeRects((range) => [rect(80 + range.startOffset * 12, 10, 0, 18)]);
}

export function mockCharacterRects(
  rects: Record<
    number,
    { left: number; top: number; width: number; height?: number; missing?: boolean }
  >,
): void {
  mockRangeRects((range) => {
    const character = rects[range.startOffset] ?? {
      left: 80 + range.startOffset * 10,
      top: 10,
      width: 10,
    };
    if (character.missing) return [];
    return [
      rect(
        character.left,
        character.top,
        range.endOffset > range.startOffset ? character.width : 0,
        character.height ?? 18,
      ),
    ];
  });
}

export function mockParagraphRangeRects(): void {
  mockRangeRects((range) => {
    const container =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
    const paragraph = container?.closest('p')?.getBoundingClientRect();
    return [
      rect(
        (paragraph?.left ?? 80) + range.startOffset * 10,
        paragraph?.top ?? 10,
        range.endOffset > range.startOffset ? 10 : 0,
        paragraph?.height ?? 18,
      ),
    ];
  });
}

export function commandsFor(input: HTMLElement) {
  const editor = createVimEditor(() => {});
  return createVimCommands(editor, () => input, {
    modeChanged: () => {},
    commandChanged: () => {},
  });
}

export function presentationFor(input: HTMLElement, mode: VimMode = 'normal') {
  const context = { activeInput: input, isEnabled: true, mode, buffer: '', composerSelector: null };
  const view = createVimPresentation(
    () => context,
    () => input,
  );
  view.start();
  return view;
}

export function loadVimStyles(): void {
  const style = document.createElement('style');
  style.dataset.vimTestStyles = '';
  style.textContent = readContentStyle();
  document.head.appendChild(style);
}
