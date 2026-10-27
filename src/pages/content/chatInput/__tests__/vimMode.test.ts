import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setupVimTestEnvironment,
  setScrollableRect,
  mockCharacterRects,
  mockInputVimModeStorage,
  createQuestionInput,
  addEditPromptInput,
  createTextareaInput,
  fireWindowKey,
  fireInputKey,
  fireClick,
  fireCtrlInputKey,
  setContentEditableSelection,
} from './vimHarness';

setupVimTestEnvironment();

describe('input Vim mode integration', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });

  afterEach(() => {
    try {
      cleanup?.();
    } finally {
      cleanup = undefined;
      vi.useRealTimers();
    }
  });

  it('focuses the question input with i when enabled', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireWindowKey('i');

    expect(input.focus).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('can be forced on by the plugin lifecycle without the Gemini setting', async () => {
    mockInputVimModeStorage(false);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode({ forceEnabled: true });

    const event = fireInputKey(input, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(input.dataset.gvVimMode).toBe('normal');
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
  });

  it('uses Vim commands in the visible edit prompt instead of the main composer', async () => {
    mockInputVimModeStorage(true);
    const mainInput = createQuestionInput('main prompt');
    const { editForm, input, wrapper } = addEditPromptInput('hello');
    input.selectionStart = 1;
    input.selectionEnd = 1;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const escapeEvent = fireInputKey(input, 'Escape');

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(input.dataset.gvVimMode).toBe('normal');
    expect(mainInput.dataset.gvVimMode).toBeUndefined();
    const hud = editForm.querySelector<HTMLElement>('.gv-input-vim-hud');
    expect(hud).not.toBeNull();
    expect(hud?.dataset.placement).toBe('edit');
    expect(hud?.style.getPropertyValue('--gv-input-vim-hud-left')).toBe('28px');
    expect(wrapper.querySelector('.gv-input-vim-hud')).toBeNull();

    fireInputKey(input, 'x');

    expect(input.value).toBe('hllo');
  });

  it('does not mistake a newline in the edit prompt for submitting the main composer', async () => {
    mockInputVimModeStorage(true);
    const mainInput = createQuestionInput('main prompt');
    const { input } = addEditPromptInput('edit prompt');
    input.selectionStart = 4;
    input.selectionEnd = 4;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'Enter');
    input.value = 'edit\n prompt';

    vi.advanceTimersByTime(80);

    expect(input.dataset.gvVimMode).toBe('normal');
    expect(mainInput.dataset.gvVimMode).toBeUndefined();

    // The retry must still detect a later send, proving the reconcile timer ran.
    input.value = '';
    vi.advanceTimersByTime(80);
    expect(input.dataset.gvVimMode).toBe('insert');
  });

  it('switches the question input from insert to normal mode with Escape', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireInputKey(input, 'Escape');

    expect(input.blur).not.toHaveBeenCalled();
    expect(input.dataset.gvVimMode).toBe('normal');
    expect(event.defaultPrevented).toBe(true);
  });

  it('switches from insert to normal mode with Ctrl+[', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireCtrlInputKey(input, '[');

    expect(input.dataset.gvVimMode).toBe('normal');
    expect(event.defaultPrevented).toBe(true);
  });

  it('allows normal typing while in insert mode', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireInputKey(input, 'a');

    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps the HUD buffer empty after a single completed H motion', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();
    setContentEditableSelection(input, 2);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'H');

    const buffer = document.querySelector<HTMLElement>('.gv-input-vim-hud-buffer');
    expect(buffer?.hidden).toBe(true);
    expect(buffer?.textContent).toBe('');
  });

  it('shows count while pending and clears it after a counted H motion', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();
    setContentEditableSelection(input, 4);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, '1');
    fireInputKey(input, '2');

    const buffer = document.querySelector<HTMLElement>('.gv-input-vim-hud-buffer');
    expect(buffer?.hidden).toBe(false);
    expect(buffer?.textContent).toBe('12');

    fireInputKey(input, 'H');

    expect(buffer?.hidden).toBe(true);
    expect(buffer?.textContent).toBe('');
  });

  it('shows pending operator commands in typed order', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput('one\ntwo\nthree');
    setContentEditableSelection(input, 0);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, '3');
    fireInputKey(input, 'd');

    const buffer = document.querySelector<HTMLElement>('.gv-input-vim-hud-buffer');
    expect(buffer?.hidden).toBe(false);
    expect(buffer?.textContent).toBe('3d');
  });

  it('prevents unsupported printable keys from inserting text in normal mode', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 2;
    input.selectionEnd = 2;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    const event = fireInputKey(input, 'q');

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('hello');
  });

  it('prevents Backspace and Delete from editing text in normal mode', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 2;
    input.selectionEnd = 2;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    const backspaceEvent = fireInputKey(input, 'Backspace');
    const deleteEvent = fireInputKey(input, 'Delete');

    expect(backspaceEvent.defaultPrevented).toBe(true);
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe('hello');
  });

  it('prevents browser editing shortcuts from mutating text in normal mode', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 2;
    input.selectionEnd = 2;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    const pasteEvent = fireCtrlInputKey(input, 'v');
    const undoEvent = fireCtrlInputKey(input, 'z');

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe('hello');
  });

  it('allows browser editing shortcuts in insert mode', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 2;
    input.selectionEnd = 2;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const pasteEvent = fireCtrlInputKey(input, 'v');

    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  it('keeps x effective after leaving insert mode at EOF', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 5;
    input.selectionEnd = 5;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'x');

    expect(input.value).toBe('hell');
    expect(input.selectionStart).toBe(4);
  });

  it('moves the visible block cursor with the textarea caret', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('hello');
    input.selectionStart = 2;
    input.selectionEnd = 2;
    input.getBoundingClientRect = () =>
      ({
        height: 24,
        width: 200,
        top: 40,
        left: 100,
        right: 300,
        bottom: 64,
        x: 100,
        y: 40,
        toJSON: () => {},
      }) as DOMRect;
    Object.defineProperty(input, 'clientWidth', { configurable: true, value: 200 });

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('gv-input-vim-textarea-mirror')) {
          return {
            height: 24,
            width: 200,
            top: 0,
            left: 0,
            right: 200,
            bottom: 24,
            x: 0,
            y: 0,
            toJSON: () => {},
          } as DOMRect;
        }

        if (this.classList.contains('gv-input-vim-textarea-marker')) {
          const offset = Number(this.dataset.gvVimOffset ?? 0);
          const line = offset >= 3 ? 1 : 0;
          const left = (line === 0 ? offset : offset - 3) * 12;
          const top = line * 24;
          return {
            height: 24,
            width: 12,
            top,
            left,
            right: left + 12,
            bottom: top + 24,
            x: left,
            y: top,
            toJSON: () => {},
          } as DOMRect;
        }

        return originalGetBoundingClientRect.call(this);
      },
    );

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'h');
    window.dispatchEvent(new Event('resize'));

    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(input.selectionStart).toBe(1);
    expect(cursor?.style.left).toBe('112px');
    expect(cursor?.style.top).toBe('40px');
    expect(cursor?.style.width).toBe('12px');
    expect(document.querySelector('.gv-input-vim-textarea-mirror')).toBeNull();

    fireInputKey(input, 'l');
    window.dispatchEvent(new Event('resize'));

    expect(input.selectionStart).toBe(2);
    expect(cursor?.style.left).toBe('124px');

    fireInputKey(input, 'j');
    window.dispatchEvent(new Event('resize'));

    expect(input.selectionStart).toBe(4);
    expect(cursor?.style.left).toBe('112px');
    expect(cursor?.style.top).toBe('64px');

    fireInputKey(input, 'k');
    expect(input.selectionStart).toBe(2);
  });

  it('returns to insert mode and hides the Vim cursor after Enter sends and clears the input', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput('send this');
    setContentEditableSelection(input, 4);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    vi.advanceTimersToNextFrame();
    const cursor = document.querySelector<HTMLElement>('.gv-input-vim-cursor');
    expect(cursor?.hidden).toBe(false);

    fireInputKey(input, 'Enter');
    input.textContent = '';

    vi.advanceTimersByTime(80);
    vi.advanceTimersToNextFrame();

    expect(input.dataset.gvVimMode).toBe('insert');
    expect(cursor?.hidden).toBe(true);
  });

  it('returns to insert mode after clicking the send button clears the input', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput('send this');
    const sendButton = document.createElement('button');
    sendButton.setAttribute('aria-label', 'Send message');
    document.body.appendChild(sendButton);
    setContentEditableSelection(input, 4);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireClick(sendButton);
    input.textContent = '';

    vi.advanceTimersByTime(80);

    expect(input.dataset.gvVimMode).toBe('insert');
  });

  it('keeps normal mode after Enter when the input content remains', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput('send this');
    setContentEditableSelection(input, 4);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'Enter');
    input.textContent = 'send this\n';

    vi.advanceTimersByTime(80);

    expect(input.dataset.gvVimMode).toBe('normal');

    // Clearing on a later retry proves the unchanged-mode assertion was observed.
    input.textContent = '';
    vi.advanceTimersByTime(80);
    expect(input.dataset.gvVimMode).toBe('insert');
  });

  it('completes dd even when the second d keydown is marked repeat', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('one\ntwo\nthree');
    input.selectionStart = 4;
    input.selectionEnd = 4;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'd');
    fireInputKey(input, 'd', { repeat: true });

    expect(input.value).toBe('one\nthree');
    expect(input.selectionStart).toBe(4);
  });

  it('ignores repeated destructive keydown events after 2dd', async () => {
    mockInputVimModeStorage(true);
    const input = createTextareaInput('one\ntwo\nthree\nfour\nfive');
    input.selectionStart = 4;
    input.selectionEnd = 4;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, '2');
    fireInputKey(input, 'd');
    fireInputKey(input, 'd');
    const repeatEvent = fireInputKey(input, 'd', { repeat: true });

    expect(repeatEvent.defaultPrevented).toBe(true);
    expect(input.value).toBe('one\nfour\nfive');
  });

  it('clears undo history when the active input changes', async () => {
    mockInputVimModeStorage(true);
    const firstInput = createTextareaInput('hello');
    firstInput.selectionStart = 1;
    firstInput.selectionEnd = 1;

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(firstInput, 'Escape');
    fireInputKey(firstInput, 'x');
    expect(firstInput.value).toBe('hllo');

    const secondInput = createTextareaInput('world');
    secondInput.selectionStart = 1;
    secondInput.selectionEnd = 1;
    secondInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    fireInputKey(secondInput, 'Escape');
    fireInputKey(secondInput, 'u');

    expect(secondInput.value).toBe('world');
  });

  it('does not steal keys while another editable element is focused', async () => {
    mockInputVimModeStorage(true);
    const input = createQuestionInput();
    const otherInput = document.createElement('input');
    document.body.appendChild(otherInput);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireInputKey(otherInput, 'i');

    expect(input.focus).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while disabled', async () => {
    mockInputVimModeStorage(false);
    const input = createQuestionInput();

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    const event = fireWindowKey('i');

    expect(input.focus).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('scrolls the input viewport when j moves the Vim caret below the visible area', async () => {
    mockInputVimModeStorage(true);
    mockCharacterRects({
      0: { left: 80, top: 10, width: 10 },
      1: { left: 90, top: 10, width: 10 },
      2: { left: 80, top: 90, width: 10 },
      3: { left: 90, top: 90, width: 10 },
    });
    const input = createQuestionInput('abcd');
    setScrollableRect(input, 40);
    setContentEditableSelection(input, 1);

    const { startInputVimMode } = await import('../vimMode');
    cleanup = await startInputVimMode();

    fireInputKey(input, 'Escape');
    fireInputKey(input, 'j');

    expect(input.scrollTop).toBeGreaterThan(0);
  });
});
