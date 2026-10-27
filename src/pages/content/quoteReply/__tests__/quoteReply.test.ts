// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { describe, expect, it, vi } from 'vitest';

import { getBrowserName } from '@/core/utils/browser';

import { expandInputCollapseIfNeeded } from '../../inputCollapse/index';
import {
  setupQuoteReplyFixture,
  inputFocusMock,
  inputBlurMock,
  installFocusTracking,
  selectSourceText,
  triggerQuoteReply,
} from './quoteReplyFixture';
import { startQuoteReply } from './startQuoteReply';

vi.mock('../../inputCollapse/index', () => ({
  expandInputCollapseIfNeeded: vi.fn(),
}));

vi.mock('@/core/utils/browser', () => ({
  getBrowserName: vi.fn(() => 'Chrome/Chromium'),
}));

setupQuoteReplyFixture();

describe('quote reply', () => {
  it('expands input collapse when using quote reply', () => {
    const cleanup = startQuoteReply();
    triggerQuoteReply();

    expect(expandInputCollapseIfNeeded).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('styles sent quote blocks even when the Quote Reply action is disabled', () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'afterbegin',
        '<div class="query-text"><p class="query-text-line">&gt; Existing quote</p><p class="query-text-line">Follow-up</p></div>',
      );

    const cleanup = startQuoteReply({ quoteEnabled: false });

    expect(document.querySelector('blockquote.gv-rendered-quote')).not.toBeNull();
    expect(document.querySelector('.gv-rendered-quote-marker')?.textContent).toBe('> ');

    cleanup();
  });

  it('does not show Quote Reply for Gemini new-chat greeting text', () => {
    document.querySelector('main')!.innerHTML = '<h1>Your move, Ivaris!</h1>';
    const greeting = document.querySelector('h1');
    if (!(greeting?.firstChild instanceof Text)) {
      throw new Error('Expected greeting text node.');
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(greeting);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const cleanup = startQuoteReply({ highlightEnabled: false });
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    expect(document.querySelector('.gv-quote-btn')).toBeNull();

    cleanup();
  });

  it.each([
    ['message to greeting', 'source', 'greeting'],
    ['greeting to message', 'greeting', 'source'],
  ])('does not show Quote Reply for a selection spanning %s', (_direction, anchorId, focusId) => {
    document
      .querySelector('main')!
      .insertAdjacentHTML('afterbegin', '<h1 id="greeting">Your move, Ivaris!</h1>');
    const anchorNode = document.getElementById(anchorId)?.firstChild;
    const focusNode = document.getElementById(focusId)?.firstChild;
    const greetingNode = document.getElementById('greeting')?.firstChild;
    const sourceNode = document.getElementById('source')?.firstChild;
    if (!(anchorNode instanceof Text) || !(focusNode instanceof Text)) {
      throw new Error('Expected selection boundary text nodes.');
    }
    if (!(greetingNode instanceof Text) || !(sourceNode instanceof Text)) {
      throw new Error('Expected ordered range boundary text nodes.');
    }

    const range = document.createRange();
    range.setStart(greetingNode, 0);
    range.setEnd(sourceNode, sourceNode.length);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode,
      focusNode,
      rangeCount: 1,
      isCollapsed: false,
      toString: () => range.toString(),
      getRangeAt: () => range,
    } as unknown as Selection);

    const cleanup = startQuoteReply({ highlightEnabled: false });
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    expect(document.querySelector('.gv-quote-btn')).toBeNull();

    cleanup();
  });

  it('does not blur or refocus the contenteditable input after quote insertion', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    triggerQuoteReply();

    expect(inputBlurMock).not.toHaveBeenCalled();
    expect(inputFocusMock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);

    cleanup();
  });

  it('activates Quote Reply from a keyboard-style click without mousedown', () => {
    const cleanup = startQuoteReply();
    selectSourceText();
    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();
    const quoteButton = document.querySelector<HTMLElement>('.gv-quote-btn');
    if (!quoteButton) throw new Error('Expected quote button');

    quoteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    expect(document.getElementById('input')?.textContent).toBe('> Hello\n');
    cleanup();
  });

  it('treats ql-blank editor as empty even if placeholder text exists', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    input.classList.add('ql-blank');
    input.setAttribute('data-placeholder', 'Message Gemini');
    input.textContent = 'Message Gemini';

    triggerQuoteReply();

    expect(input.textContent).toBe('Message Gemini> Hello\n');

    cleanup();
  });

  it('treats stale ql-blank with real user text as non-empty', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    input.classList.add('ql-blank');
    input.setAttribute('data-placeholder', 'Message Gemini');
    input.textContent = '已有内容';

    triggerQuoteReply();

    expect(input.textContent).toBe('已有内容\n\n> Hello\n');

    cleanup();
  });

  it('adds a blank line when input has visible text', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    input.textContent = 'Existing';

    triggerQuoteReply();

    expect(input.textContent).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('uses single-line separator for Firefox contenteditable', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    vi.mocked(getBrowserName).mockReturnValue('Firefox');

    const execCommandMock = vi.spyOn(document, 'execCommand');
    input.textContent = 'Existing';

    triggerQuoteReply();

    expect(execCommandMock).toHaveBeenCalledWith('insertText', false, '\n');
    expect(execCommandMock).not.toHaveBeenCalledWith('insertText', false, '\n\n');
    expect(input.textContent).toBe('Existing\n> Hello\n');

    cleanup();
  });

  it('prepends two newlines for non-empty textarea input', () => {
    const cleanup = startQuoteReply();
    const inputContainer = document.getElementById('input-container');
    if (!(inputContainer instanceof HTMLElement)) {
      throw new Error('Expected input container element.');
    }

    inputContainer.innerHTML = '<textarea id="input" placeholder="Ask Gemini"></textarea>';
    const textarea = document.getElementById('input');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Expected textarea input element.');
    }

    textarea.getBoundingClientRect = () =>
      ({
        height: 20,
        width: 100,
        top: 0,
        left: 0,
        bottom: 20,
        right: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    installFocusTracking(textarea);
    textarea.scrollIntoView = vi.fn();
    textarea.value = 'Existing';

    triggerQuoteReply();

    expect(textarea.value).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('falls back to Range insertion when execCommand is unavailable', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    const execCommandMock = vi.spyOn(document, 'execCommand').mockReturnValue(false);
    input.textContent = 'Existing';

    triggerQuoteReply();

    expect(execCommandMock).toHaveBeenCalledWith('insertText', false, '\n\n> Hello\n');
    expect(input.textContent).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('avoids full fallback separator when separator insertion partially mutates content', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    input.textContent = 'Existing';
    const execCommandMock = vi
      .spyOn(document, 'execCommand')
      .mockImplementation((command: string, _showUI?: boolean, value?: string) => {
        if (command === 'insertText' && typeof value === 'string') {
          const stripped = value.startsWith('\n') ? value.slice(1) : value;
          input.textContent = `${input.textContent ?? ''}${stripped}`;
          return true;
        }
        return false;
      });

    triggerQuoteReply();

    expect(execCommandMock.mock.calls).toEqual(
      expect.arrayContaining([['insertText', false, '\n\n']]),
    );
    expect(execCommandMock).not.toHaveBeenCalledWith('insertText', false, '\n\n> Hello\n');
    expect(input.textContent).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('keeps leading newline fallback when separator command does not change content', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    input.textContent = 'Existing';
    const execCommandMock = vi
      .spyOn(document, 'execCommand')
      .mockImplementation((command: string, _showUI?: boolean, value?: string) => {
        if (command === 'insertText' && typeof value === 'string') {
          if (value === '\n\n') {
            return true; // Pretend success but do not mutate content
          }
          input.textContent = `${input.textContent ?? ''}${value}`;
          return true;
        }
        return false;
      });

    triggerQuoteReply();

    expect(execCommandMock.mock.calls).toEqual(
      expect.arrayContaining([
        ['insertText', false, '\n\n'],
        ['insertText', false, '\n\n> Hello\n'],
      ]),
    );
    expect(input.textContent).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('treats separator as inserted when only innerText reflects line breaks', () => {
    const cleanup = startQuoteReply();
    const input = document.getElementById('input');
    if (!(input instanceof HTMLElement)) {
      throw new Error('Expected quote input element.');
    }

    const state = {
      visible: 'Existing',
      raw: 'Existing',
    };

    Object.defineProperty(input, 'innerText', {
      configurable: true,
      get: () => state.visible,
      set: (value: string) => {
        state.visible = value;
      },
    });

    Object.defineProperty(input, 'textContent', {
      configurable: true,
      get: () => state.raw,
      set: (value: string | null) => {
        state.raw = value ?? '';
      },
    });

    const execCommandMock = vi
      .spyOn(document, 'execCommand')
      .mockImplementation((command: string, _showUI?: boolean, value?: string) => {
        if (command !== 'insertText' || typeof value !== 'string') {
          return false;
        }

        if (value === '\n\n') {
          // Simulate Quill: visual line breaks changed, raw textContent unchanged.
          state.visible = `${state.visible}\n\n`;
          return true;
        }

        state.visible = `${state.visible}${value}`;
        state.raw = `${state.raw}${value.replace(/\n/g, '')}`;
        return true;
      });

    triggerQuoteReply();

    expect(execCommandMock.mock.calls).toEqual(
      expect.arrayContaining([
        ['insertText', false, '\n\n'],
        ['insertText', false, '> Hello\n'],
      ]),
    );
    expect(execCommandMock).not.toHaveBeenCalledWith('insertText', false, '\n\n> Hello\n');
    expect(state.visible).toBe('Existing\n\n> Hello\n');

    cleanup();
  });

  it('preserves inline math LaTeX syntax in quoted text', () => {
    const cleanup = startQuoteReply();
    const source = document.getElementById('source');
    if (!source) throw new Error('Expected source element.');

    source.innerHTML =
      'Variable <span class="math-inline"><span data-math="U \\in [0, 1)">U∈[0,1)</span></span> is uniform';

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(source);
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    const quoteButton = document.querySelector<HTMLElement>('.gv-quote-btn');
    if (!quoteButton) throw new Error('Expected quote button.');
    quoteButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    quoteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    const input = document.getElementById('input');
    if (!input) throw new Error('Expected input element.');

    expect(input.textContent).toContain('$U \\in [0, 1)$');

    cleanup();
  });

  it('preserves block math LaTeX syntax in quoted text', () => {
    const cleanup = startQuoteReply();
    const source = document.getElementById('source');
    if (!source) throw new Error('Expected source element.');

    source.innerHTML =
      'Equation: <span class="math-block"><span data-math="E = mc^2">E=mc²</span></span>';

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(source);
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    const quoteButton = document.querySelector<HTMLElement>('.gv-quote-btn');
    if (!quoteButton) throw new Error('Expected quote button.');
    quoteButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    quoteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    const input = document.getElementById('input');
    if (!input) throw new Error('Expected input element.');

    expect(input.textContent).toContain('$$E = mc^2$$');

    cleanup();
  });

  it('preserves standalone data-math elements without container', () => {
    const cleanup = startQuoteReply();
    const source = document.getElementById('source');
    if (!source) throw new Error('Expected source element.');

    source.innerHTML = 'Value <span data-math="x^2">x²</span> here';

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(source);
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    const quoteButton = document.querySelector<HTMLElement>('.gv-quote-btn');
    if (!quoteButton) throw new Error('Expected quote button.');
    quoteButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    quoteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    const input = document.getElementById('input');
    if (!input) throw new Error('Expected input element.');

    expect(input.textContent).toContain('$x^2$');

    cleanup();
  });
});
