import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { registerSelectionAction, startSelectionToolbarHost } from '../host';

describe('selection toolbar online turn admission', () => {
  let stopSelectors: (() => void) | undefined;
  let stopHost: (() => void) | undefined;
  let unregister: (() => void) | undefined;
  let originalRect: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 110, left: 100, width: 20, height: 10 }),
    });
    document.body.innerHTML =
      '<main><user-query class="online-user"><p id="text">Question text</p></user-query></main>';
  });

  afterEach(() => {
    unregister?.();
    stopHost?.();
    stopSelectors?.();
    unregister = stopHost = stopSelectors = undefined;
    if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function selectQuestion(): void {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('text')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.advanceTimersByTime(250);
  }

  it.each(['.online-user', '.missing-online-user'])(
    'keeps the same saved range and available action with %s',
    async (selector) => {
      stopHost = startSelectionToolbarHost();
      const selected: string[] = [];
      unregister = registerSelectionAction({
        id: 'online-selection-fixture',
        order: 1,
        className: 'gv-online-selection-fixture',
        label: () => 'Selection',
        createIcon: () => document.createElement('i'),
        isAvailable: () => true,
        run: (range) => {
          selected.push(range.toString());
          return false;
        },
      });
      selectQuestion();
      document.querySelector<HTMLButtonElement>('.gv-online-selection-fixture')!.click();
      stopSelectors = await installGeminiTurnPatch({ 'turn.userWithHosts': [selector] });

      selectQuestion();
      document.querySelector<HTMLButtonElement>('.gv-online-selection-fixture')!.click();

      expect(selected).toEqual(['Question text', 'Question text']);
      expect(document.querySelector('.gv-selection-toolbar')!.classList.contains('gv-hidden')).toBe(
        false,
      );
    },
  );
});
