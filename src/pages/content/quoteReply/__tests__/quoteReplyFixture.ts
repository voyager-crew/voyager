import { afterEach, beforeEach, vi } from 'vitest';

import { getBrowserName } from '@/core/utils/browser';

let activeElement: Element | null = null;
export let inputFocusMock: ReturnType<typeof vi.fn>;
export let inputBlurMock: ReturnType<typeof vi.fn>;

export function installFocusTracking(element: HTMLElement | HTMLTextAreaElement) {
  const focusMock = vi.fn((_options?: FocusOptions) => {
    activeElement = element;
  });
  const blurMock = vi.fn(() => {
    if (activeElement === element) {
      activeElement = document.body;
    }
  });

  Object.defineProperty(element, 'focus', {
    value: focusMock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(element, 'blur', {
    value: blurMock,
    configurable: true,
    writable: true,
  });

  return { focusMock, blurMock };
}

export function selectSourceText(start = 0, end = 5) {
  const selection = window.getSelection();
  const textNode = document.getElementById('source')?.firstChild;
  if (!(textNode instanceof Text)) {
    throw new Error('Expected a Text node for quote selection.');
  }

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function installHighlightConversation(): void {
  document.querySelector('main')!.innerHTML = `
    <div class="conversation-container" id="1111111111111111">
      <div class="user-query-bubble-with-background">Question</div>
      <model-response><message-content><p id="source">Hello world</p></message-content></model-response>
    </div>
  `;
}

/** Deliver one change to every storage listener still registered, as the browser does. */
export function emitStorageChange(
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) {
  const removed = new Set(
    vi.mocked(chrome.storage.onChanged.removeListener).mock.calls.map(([listener]) => listener),
  );
  vi.mocked(chrome.storage.onChanged.addListener)
    .mock.calls.map(([listener]) => listener)
    .filter((listener) => !removed.has(listener))
    .forEach((listener) => listener(changes as never, areaName as never));
}

export function triggerQuoteReply() {
  selectSourceText();
  document.dispatchEvent(new MouseEvent('mouseup'));
  vi.runAllTimers();

  const quoteButton = document.querySelector<HTMLElement>('.gv-quote-btn');
  if (!(quoteButton instanceof HTMLElement)) {
    throw new Error('Expected quote button to be present.');
  }

  quoteButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  quoteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  vi.runAllTimers();
}

export function setupQuoteReplyFixture(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getBrowserName).mockReturnValue('Chrome/Chromium');
    activeElement = document.body;

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => activeElement ?? document.body,
    });

    document.body.innerHTML = `
    <main>
      <div class="conversation-container">
        <model-response><message-content><p id="source">Hello world</p></message-content></model-response>
      </div>
    </main>
    <div id="input-container">
      <rich-textarea>
        <div id="input" contenteditable="true"></div>
      </rich-textarea>
    </div>
  `;

    const input = document.getElementById('input') as HTMLElement;
    input.getBoundingClientRect = () =>
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
    ({ focusMock: inputFocusMock, blurMock: inputBlurMock } = installFocusTracking(input));
    input.scrollIntoView = vi.fn();

    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: vi.fn(
        () =>
          ({
            height: 10,
            width: 10,
            top: 0,
            left: 0,
            bottom: 10,
            right: 10,
            x: 0,
            y: 0,
            toJSON: () => {},
          }) as DOMRect,
      ),
      configurable: true,
    });

    Object.defineProperty(document, 'execCommand', {
      value: vi.fn((command: string, _showUI?: boolean, value?: string) => {
        if (command !== 'insertText' || typeof value !== 'string') {
          return false;
        }
        const input = document.getElementById('input');
        if (!(input instanceof HTMLElement)) {
          return false;
        }
        input.textContent = (input.textContent ?? '') + value;
        return true;
      }),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
}
