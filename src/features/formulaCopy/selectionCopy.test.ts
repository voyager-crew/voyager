// Load shared mocks before the service and its dependencies.
import './__tests__/formulaCopyTestHarness';
import { describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import { setupFormulaCopyTestSuite, storageMocks } from './__tests__/formulaCopyTestHarness';

const MIXED_REPLY =
  '<div id="reply"><p>Before <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span> after</p><p><span class="katex-display"><span class="katex"><math><semantics><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math><span aria-hidden="true">ab</span></span></span></p></div>';

function selectContents(element: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function dispatchCopy(target: Node): { event: Event; setData: ReturnType<typeof vi.fn> } {
  const setData = vi.fn();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData } });
  target.dispatchEvent(event);
  return { event, setData };
}

function storageListener(): Parameters<typeof browser.storage.onChanged.addListener>[0] {
  const listener = storageMocks.addListener.mock.calls.at(-1)?.[0] as
    | Parameters<typeof browser.storage.onChanged.addListener>[0]
    | undefined;
  if (!listener) throw new Error('formula copy did not subscribe to storage');
  return listener;
}

describe('Formula selection copy', () => {
  const context = setupFormulaCopyTestSuite();

  it('copies mixed text and KaTeX as LaTeX, and keeps the original HTML', () => {
    document.body.innerHTML = MIXED_REPLY;
    const reply = document.getElementById('reply')!;
    selectContents(reply);
    context.service.initialize();

    const { event, setData } = dispatchCopy(reply);

    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Before $x^2$ after\n$$\\frac{a}{b}$$');
    expect(setData).toHaveBeenCalledWith('text/html', expect.stringContaining('application/x-tex'));
    expect(context.writeMock).not.toHaveBeenCalled();
    expect(context.writeTextMock).not.toHaveBeenCalled();
  });

  it('expands an endpoint inside a formula to the whole formula LaTeX', () => {
    document.body.innerHTML =
      '<p id="line"><span class="katex-display" id="formula"><span class="katex"><span class="katex-html" aria-hidden="true" id="visual">ab</span><math><semantics><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span></span> tail</p>';
    const visual = document.getElementById('visual')!.firstChild!;
    const range = document.createRange();
    range.setStart(visual, 0);
    range.setEnd(visual, 1);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    context.service.initialize();

    const { event, setData } = dispatchCopy(document.getElementById('line')!);

    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', '$$\\frac{a}{b}$$');
    expect(selection.rangeCount).toBe(1);
    expect(selection.getRangeAt(0).startContainer).toBe(visual);
    expect(selection.getRangeAt(0).startOffset).toBe(0);
    expect(selection.getRangeAt(0).endOffset).toBe(1);
  });

  it('leaves a selection with no formula to the browser', () => {
    document.body.innerHTML = '<p id="plain">Just words</p>';
    const plain = document.getElementById('plain')!;
    selectContents(plain);
    context.service.initialize();

    const { event, setData } = dispatchCopy(plain);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it('leaves a collapsed caret inside a formula to the browser', () => {
    document.body.innerHTML =
      '<p><span class="katex"><annotation encoding="application/x-tex">x^2</annotation><span id="visual">x2</span></span></p>';
    const visual = document.getElementById('visual')!.firstChild!;
    const range = document.createRange();
    range.setStart(visual, 1);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    context.service.initialize();

    const { event, setData } = dispatchCopy(visual);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it('leaves a selection inside a contenteditable composer to the browser', () => {
    document.body.innerHTML = `<div id="composer" contenteditable="true">${MIXED_REPLY}</div>`;
    const reply = document.getElementById('reply')!;
    selectContents(reply);
    context.service.initialize();

    const { event, setData } = dispatchCopy(reply);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it('leaves the copy alone when selection conversion is off', () => {
    document.body.innerHTML = MIXED_REPLY;
    const reply = document.getElementById('reply')!;
    selectContents(reply);
    context.service.initialize();
    storageListener()({ [StorageKeys.FORMULA_COPY_SELECTION_LATEX]: { newValue: false } }, 'sync');

    const { event, setData } = dispatchCopy(reply);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it('reads a stored off switch before the first copy', async () => {
    storageMocks.get.mockResolvedValue({ [StorageKeys.FORMULA_COPY_SELECTION_LATEX]: false });
    document.body.innerHTML = MIXED_REPLY;
    const reply = document.getElementById('reply')!;
    selectContents(reply);
    await context.service.prepare();
    context.service.initialize();

    const { event, setData } = dispatchCopy(reply);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it('drops the copy listener when the service stops', () => {
    document.body.innerHTML = MIXED_REPLY;
    const reply = document.getElementById('reply')!;
    selectContents(reply);
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    context.service.initialize();
    const handler = addSpy.mock.calls.find((call) => call[0] === 'copy')?.[1];
    expect(handler).toEqual(expect.any(Function));

    context.service.destroy();

    expect(removeSpy).toHaveBeenCalledWith('copy', handler, true);
    const { event, setData } = dispatchCopy(reply);
    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('joins each range of a multi-range selection with a newline', () => {
    document.body.innerHTML =
      '<p id="one">Before <span class="katex"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math><span aria-hidden="true">x2</span></span></p><p id="two">Tail</p>';
    const first = document.createRange();
    first.selectNodeContents(document.getElementById('one')!);
    const second = document.createRange();
    second.selectNodeContents(document.getElementById('two')!);
    const selection = {
      isCollapsed: false,
      rangeCount: 2,
      getRangeAt: (index: number) => (index === 0 ? first : second),
    } as Selection;
    const getSelection = vi.spyOn(document, 'getSelection').mockReturnValue(selection);
    context.service.initialize();

    const { event, setData } = dispatchCopy(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Before $x^2$\nTail');
    getSelection.mockRestore();
  });

  it('falls back to the browser when the selection has a formula but no LaTeX source', () => {
    document.body.innerHTML =
      '<p id="blank"><span class="katex"><span class="katex-html" aria-hidden="true">x</span></span></p>';
    const blank = document.getElementById('blank')!;
    selectContents(blank);
    context.service.initialize();

    const { event, setData } = dispatchCopy(blank);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });
});
