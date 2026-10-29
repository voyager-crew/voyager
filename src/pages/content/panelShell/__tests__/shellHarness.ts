/**
 * A host page for the panel shell: in-memory storage whose writes fire
 * `onChanged` like the browser's, a fake background that issues panel
 * tokens, and helpers that speak for the panel page and the keyboard.
 */
import { vi } from 'vitest';

import { PANEL_MESSAGE, PANEL_PAGE_PATH } from '@/features/panel/protocol';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';
import { initI18n } from '@/utils/i18n';

import { startPanelShell } from '../index';

export const EXTENSION_ORIGIN = 'chrome-extension://test-extension-id';
export const TOKEN = 'a'.repeat(64);
export const PANEL_URL = `${EXTENSION_ORIGIN}/${PANEL_PAGE_PATH}`;

type Message = { type?: string; payload?: unknown };

export interface ShellPage {
  readonly memory: MemoryStorage;
  /** Every runtime message the page sent, in order. */
  readonly sent: Message[];
  /** What the background answers a token request with; a function may defer it. */
  tokenReply: () => unknown;
  popupReply: unknown;
  start(): Promise<() => void>;
  sentOfType(type: string): Message[];
  /** Stops the shell, lets its last messages go out, then puts the page back. */
  restore(): Promise<void>;
}

/**
 * Loads the interface language once, against storage of its own: its page-wide
 * language listener is infrastructure, not something a test page should count.
 */
export async function bootstrapI18n(): Promise<void> {
  const previous = chrome.storage;
  chrome.storage = createMemoryStorage().api;
  try {
    await initI18n();
  } finally {
    chrome.storage = previous;
  }
}

export function issued(): unknown {
  return { ok: true, token: TOKEN, panelUrl: PANEL_URL };
}

/** Lets storage events, the shortcut session and the token round trip settle. */
export async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await settle(20);
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export interface RecordedAnimation {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

/**
 * jsdom has no Web Animations: record what the shell asks for, and finish
 * each animation at once.
 */
export function recordAnimations(): RecordedAnimation[] {
  const recorded: RecordedAnimation[] = [];
  const animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    recorded.push({ element: this, keyframes, options });
    return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
  };
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  return recorded;
}

export function stopRecordingAnimations(): void {
  Reflect.deleteProperty(Element.prototype, 'animate');
}

export function installShellPage(url: string): ShellPage {
  setPageUrl(url);
  const previousStorage = chrome.storage;
  const previousSend = chrome.runtime.sendMessage;
  const memory = createMemoryStorage();
  chrome.storage = memory.api;
  const stops: Array<() => void> = [];
  const page: ShellPage = {
    memory,
    sent: [],
    tokenReply: issued,
    popupReply: { ok: true },
    async start() {
      const stop = startPanelShell();
      stops.push(stop);
      await flush();
      return stop;
    },
    sentOfType: (type) => page.sent.filter((message) => message.type === type),
    async restore() {
      for (const stop of stops.splice(0)) stop();
      // The panel's goodbye to the background leaves after its machine stops.
      await flush();
      chrome.storage = previousStorage;
      chrome.runtime.sendMessage = previousSend;
      resetPageUrl();
      document.body.innerHTML = '';
      document.documentElement.removeAttribute('class');
    },
  };
  chrome.runtime.sendMessage = vi.fn(async (message: Message) => {
    page.sent.push(message);
    if (message?.type === PANEL_MESSAGE.tokenIssue) return page.tokenReply();
    if (message?.type === 'gv.openPopup') return page.popupReply;
    return { ok: true };
  }) as unknown as typeof chrome.runtime.sendMessage;
  return page;
}

export function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.gv-ps-panel');
}

export function frameWindow(): Window | null {
  return document.querySelector<HTMLIFrameElement>('.gv-ps-frame')?.contentWindow ?? null;
}

/** A window message as the panel page sends it, unless `from` says otherwise. */
export function postFromPanel(
  data: unknown,
  from: { source?: Window | null; origin?: string } = {},
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin: from.origin ?? EXTENSION_ORIGIN,
      source: from.source === undefined ? frameWindow() : from.source,
    }),
  );
}

/** ⌥V as macOS reports it: Option turns the key into "√", the code stays KeyV. */
export function pressAltV(
  target: EventTarget = document.activeElement ?? document.body,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: '√',
    code: 'KeyV',
    altKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export function ball(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#gv-pm-trigger');
}

export function satellite(slot: 'panel' | 'hide'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.gv-ps-hit[data-slot="${slot}"]`);
}

export function hover(element: Element | null): void {
  element?.dispatchEvent(new PointerEvent('pointerenter'));
}

export function unhover(element: Element | null): void {
  element?.dispatchEvent(new PointerEvent('pointerleave'));
}

export function rect(left: number, top: number, size = 46): DOMRect {
  return {
    left,
    top,
    right: left + size,
    bottom: top + size,
    width: size,
    height: size,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
