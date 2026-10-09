/**
 * A Gemini conversation page plus the extension boundaries the timeline talks to, for
 * characterization tests that drive the timeline only through `startTimeline()` and its stop, the
 * DOM and storage. Faked here, and nothing else:
 * - `chrome.storage` (local, sync, onChanged), in memory, with promise and callback forms;
 * - the background page behind `chrome.runtime.sendMessage`, using the real starred-message owner;
 * - layout that jsdom does not compute (box heights, turn offsets, bounding rects);
 * - `IntersectionObserver` and pointer capture, which jsdom lacks.
 *
 * Each test file must also mock `webextension-polyfill` to read `globalThis.chrome` at call time
 * (see `polyfillMock` below) and run under fake timers.
 *
 * Rendered DOM that the tests read is named once in `SURFACE` so a deliberate rename is a one-line
 * change here rather than in every assertion.
 */
import { afterEach, beforeEach, vi } from 'vitest';

import { createStarStore } from '@/features/savedLibrary/starStore';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

export const SURFACE = {
  bar: '.gemini-timeline-bar',
  trackContent: '.timeline-track-content',
  dot: '.timeline-dot',
  slider: '.timeline-left-slider',
  tooltip: '#gemini-timeline-tooltip',
  previewToggle: '.timeline-preview-toggle',
  previewPanel: '.timeline-preview-panel',
  previewItem: '.timeline-preview-item',
  previewSearch: '.timeline-preview-search input',
  levelMenu: '.timeline-context-menu',
} as const;

type Area = 'local' | 'sync';
type Change = { oldValue?: unknown; newValue?: unknown };
type StorageListener = (changes: Record<string, Change>, area: string) => void;
type Keys = string | string[] | Record<string, unknown> | null | undefined;
type ResultCallback = (result: Record<string, unknown>) => void;

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

export interface ExtensionFake {
  readonly values: Record<Area, Map<string, unknown>>;
  readonly listeners: Set<StorageListener>;
  read<T = unknown>(area: Area, key: string): T | undefined;
  seed(area: Area, items: Record<string, unknown>): void;
  /** Another context (popup, another tab) writes storage: listeners fire, like Chrome. */
  external(area: Area, items: Record<string, unknown>): void;
}

/** Installs an in-memory extension as `globalThis.chrome`. Call before importing the timeline. */
export function installExtension(): ExtensionFake {
  const values: Record<Area, Map<string, unknown>> = { local: new Map(), sync: new Map() };
  const listeners = new Set<StorageListener>();

  const notify = (area: Area, changes: Record<string, Change>): void => {
    queueMicrotask(() => {
      // Snapshot: a listener may register another one (a timeline rebuilding) while being notified.
      for (const listener of Array.from(listeners)) listener(changes, area);
    });
  };
  const write = (area: Area, items: Record<string, unknown>): void => {
    const changes: Record<string, Change> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: clone(values[area].get(key)), newValue: clone(value) };
      values[area].set(key, clone(value));
    }
    notify(area, changes);
  };
  const lookup = (area: Area, keys: Keys): Record<string, unknown> => {
    const store = values[area];
    const result: Record<string, unknown> = {};
    if (keys === null || keys === undefined) {
      for (const [key, value] of store) result[key] = clone(value);
      return result;
    }
    const entries: Array<[string, unknown]> =
      typeof keys === 'string'
        ? [[keys, undefined]]
        : Array.isArray(keys)
          ? keys.map((key) => [key, undefined])
          : Object.entries(keys);
    for (const [key, fallback] of entries) {
      if (store.has(key)) result[key] = clone(store.get(key));
      else if (fallback !== undefined) result[key] = clone(fallback);
    }
    return result;
  };
  // Chrome answers both forms; the timeline uses callbacks for settings and promises elsewhere.
  const reply = <T>(value: T, callback?: (value: T) => void): Promise<T> => {
    if (callback) queueMicrotask(() => callback(value));
    return Promise.resolve(value);
  };
  const area = (name: Area) => ({
    get: (keys?: Keys | ResultCallback, callback?: ResultCallback) =>
      typeof keys === 'function'
        ? reply(lookup(name, null), keys)
        : reply(lookup(name, keys), callback),
    set: (items: Record<string, unknown>, callback?: () => void) => {
      write(name, items);
      return reply(undefined, callback);
    },
    remove: (keys: string | string[], callback?: () => void) => {
      const changes: Record<string, Change> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        changes[key] = { oldValue: clone(values[name].get(key)) };
        values[name].delete(key);
      }
      notify(name, changes);
      return reply(undefined, callback);
    },
    clear: (callback?: () => void) => {
      values[name].clear();
      return reply(undefined, callback);
    },
  });

  const local = area('local');
  const handle = createStarredMessagesHandler(
    createStarStore({
      get: (keys) => local.get(keys),
      set: (items) => local.set(items),
    }),
  );

  const fake = {
    storage: {
      local,
      sync: area('sync'),
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
        hasListener: (listener: StorageListener) => listeners.has(listener),
      },
    },
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => {
        const pending = handle(message) ?? Promise.resolve(undefined);
        return pending.then((response) => {
          callback?.(response);
          return response;
        });
      },
    },
    i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
  };
  vi.stubGlobal('chrome', fake);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  );

  return {
    values,
    listeners,
    read: <T>(name: Area, key: string) => clone(values[name].get(key)) as T | undefined,
    seed: (name, items) => {
      for (const [key, value] of Object.entries(items)) values[name].set(key, clone(value));
    },
    external: (name, items) => write(name, items),
  };
}

/** Factory for `vi.mock('webextension-polyfill', ...)`: the polyfill reads the fake at call time. */
export function polyfillMock() {
  return {
    default: {
      get storage() {
        return globalThis.chrome.storage;
      },
      get runtime() {
        return globalThis.chrome.runtime;
      },
      i18n: { getUILanguage: () => 'en' },
    },
  };
}

export interface GeminiTurn {
  prompt: string;
  response?: string;
  /** Gemini's response container id (hex). Omitted for turns Gemini renders without one. */
  serverId?: string;
}

/** The timeline's id for a Gemini response container id. */
export const turnIdOf = (serverId: string) => `s-${serverId}`;

const VIEWPORT_HEIGHT = 400;
const TURN_SPACING = 300;
const DEFAULT_BOX_HEIGHT = 400;

/**
 * jsdom has no layout. Every box reports a viewport-sized client height unless a fixture element
 * overrides it, and turn bubbles report the offsets a real chat column would give them.
 */
export function installLayout(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return DEFAULT_BOX_HEIGHT;
    },
  });
  // jsdom has no pointer capture; dragging and resizing the rail call it.
  const hadPointerCapture = 'setPointerCapture' in HTMLElement.prototype;
  if (!hadPointerCapture) {
    Object.assign(HTMLElement.prototype, {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    });
  }
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    if (!hadPointerCapture) {
      const proto = HTMLElement.prototype as Partial<HTMLElement>;
      delete proto.setPointerCapture;
      delete proto.releasePointerCapture;
    }
  };
}

/** Gives a fixed-position element the box its inline `top`/`left` would give it. */
export function followInlinePosition(element: HTMLElement, width = 24, height = 300): void {
  element.getBoundingClientRect = () =>
    new DOMRect(
      Number.parseFloat(element.style.left) || 0,
      Number.parseFloat(element.style.top) || 0,
      width,
      height,
    );
}

type ListenerRecord = { target: EventTarget; type: string; listener: unknown; capture: boolean };

/**
 * Counts listeners that page code keeps registered on `window` and `document`, honouring
 * `removeEventListener`, `once` and `AbortSignal`. Call before the timeline starts.
 */
export function trackPageListeners(): () => number {
  const live: ListenerRecord[] = [];
  const captureOf = (options: unknown) =>
    typeof options === 'boolean' ? options : Boolean((options as AddEventListenerOptions)?.capture);
  const indexOf = (target: EventTarget, type: string, listener: unknown, capture: boolean) =>
    live.findIndex(
      (entry) =>
        entry.target === target &&
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
  const drop = (target: EventTarget, type: string, listener: unknown, capture: boolean) => {
    const index = indexOf(target, type, listener, capture);
    if (index >= 0) live.splice(index, 1);
  };
  // The test environment exposes `window` methods as bound copies, so spy on each target itself.
  for (const target of [window, document] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        add(type, listener, options);
        const capture = captureOf(options);
        const signal = typeof options === 'object' ? options.signal : undefined;
        if (!listener || signal?.aborted || indexOf(target, type, listener, capture) >= 0) return;
        live.push({ target, type, listener, capture });
        signal?.addEventListener('abort', () => drop(target, type, listener, capture));
        if (typeof options === 'object' && options.once) {
          add(type, () => drop(target, type, listener, capture), { once: true, capture });
        }
      },
    );
    vi.spyOn(target, 'removeEventListener').mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) => {
        remove(type, listener, options);
        drop(target, type, listener, captureOf(options));
      },
    );
  }
  return () => live.length;
}

export class GeminiPage {
  main!: HTMLElement;
  viewport!: HTMLElement;

  constructor(turns: GeminiTurn[]) {
    this.render(turns);
  }

  /** Gemini renders (or re-renders) the whole chat: a new main, scroll viewport and turn nodes. */
  render(turns: GeminiTurn[]): void {
    this.main?.remove();
    this.main = document.createElement('main');
    const viewport = document.createElement('div');
    viewport.className = 'chat-history-scroll-container';
    viewport.style.overflowY = 'auto';
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 800, VIEWPORT_HEIGHT);
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => Math.max(VIEWPORT_HEIGHT, this.containers().length * TURN_SPACING),
    });
    this.viewport = viewport;
    turns.forEach((turn) => viewport.appendChild(this.renderTurn(turn)));
    this.main.appendChild(viewport);
    document.body.appendChild(this.main);
  }

  /** Gemini lazily mounts older turns above the current ones, in the same viewport. */
  prepend(older: GeminiTurn[]): void {
    const first = this.viewport.firstChild;
    older.forEach((turn) => this.viewport.insertBefore(this.renderTurn(turn), first));
  }

  /** A new turn is appended at the bottom, inside the same viewport. */
  append(turn: GeminiTurn): void {
    this.viewport.appendChild(this.renderTurn(turn));
  }

  bubble(prompt: string): HTMLElement {
    const bubble = Array.from(
      this.viewport.querySelectorAll<HTMLElement>('.user-query-bubble-with-background'),
    ).find((element) => element.textContent === prompt);
    if (!bubble) throw new Error(`No turn "${prompt}"`);
    return bubble;
  }

  response(prompt: string): HTMLElement {
    return this.bubble(prompt)
      .closest('.conversation-container')!
      .querySelector('message-content')!;
  }

  /** The scroll position that puts a turn at the top of the chat viewport. */
  topOf(prompt: string): number {
    return this.bubble(prompt).offsetTop;
  }

  /** The user scrolls the chat. */
  scrollTo(top: number): void {
    this.viewport.scrollTop = top;
    this.viewport.dispatchEvent(new Event('scroll'));
  }

  private containers(): HTMLElement[] {
    return Array.from(this.viewport.querySelectorAll<HTMLElement>('.conversation-container'));
  }

  private renderTurn(turn: GeminiTurn): HTMLElement {
    const container = document.createElement('div');
    container.className = 'conversation-container';
    if (turn.serverId) container.id = turn.serverId;
    container.innerHTML =
      '<user-query><user-query-content><div class="user-query-bubble-with-background"></div>' +
      '</user-query-content></user-query><model-response><message-content></message-content>' +
      '</model-response>';
    const bubble = container.querySelector<HTMLElement>('.user-query-bubble-with-background')!;
    bubble.textContent = turn.prompt;
    container.querySelector('message-content')!.textContent = turn.response ?? '';
    // Turns stack top to bottom at a fixed pitch, so a prepended turn pushes the others down.
    const top = () => this.containers().indexOf(container) * TURN_SPACING;
    Object.defineProperty(bubble, 'offsetTop', { configurable: true, get: top });
    bubble.getBoundingClientRect = () =>
      new DOMRect(0, top() - (container.parentElement?.scrollTop ?? 0), 300, 80);
    return container;
  }
}

/** Normalized rail position of a dot (0 = top, 1 = bottom), the `--n` the stylesheet reads. */
export const railPosition = (dot: HTMLElement) =>
  Number.parseFloat(dot.style.getPropertyValue('--n'));

export const timelineBar = () => document.querySelector<HTMLElement>(SURFACE.bar);
export const dots = () =>
  Array.from(document.querySelectorAll<HTMLElement>(`${SURFACE.bar} ${SURFACE.dot}`));
/** Dot labels top to bottom as the rail shows them (DOM order of reused dots may differ). */
export const dotLabels = () =>
  dots()
    .sort((a, b) => railPosition(a) - railPosition(b))
    .map((dot) => dot.getAttribute('aria-label'));
export function dotFor(prompt: string): HTMLElement {
  const dot = dots().find((candidate) => candidate.getAttribute('aria-label') === prompt);
  if (!dot) throw new Error(`No dot for "${prompt}"; dots: ${JSON.stringify(dotLabels())}`);
  return dot;
}
export const activeDotLabel = () =>
  dots()
    .find((dot) => dot.classList.contains('active'))
    ?.getAttribute('aria-label') ?? null;
export const starredDotLabels = () =>
  dots()
    .filter((dot) => dot.classList.contains('starred'))
    .map((dot) => dot.getAttribute('aria-label'));

/** Lets startup, storage round trips and debounced rescans settle. */
export async function settle(ms = 1000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

let stopTimeline: (() => void) | null = null;

/** Boots the timeline the way the content script does, on the current URL. */
export async function startTimelineOnPage(): Promise<void> {
  const { startTimeline } = await import('../index');
  stopTimeline = startTimeline();
  await settle();
}

/** The user leaves conversations (e.g. opens Gemini's home); the route poller notices. */
export async function leaveConversation(path = '/'): Promise<void> {
  history.pushState(null, '', path);
  await settle();
}

/** SPA navigation inside Gemini; the timeline rebuilds after its route debounce. */
export async function navigateTo(path: string): Promise<void> {
  history.pushState(null, '', path);
  await settle(2000);
}

/** Page unload: the content script's cleanup runs the stop `startTimeline()` returned. */
export function unloadPage(): void {
  const stop = stopTimeline;
  stopTimeline = null;
  stop?.();
}

export function longPress(target: HTMLElement): Promise<void> {
  target.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }),
  );
  return settle(600).then(() => {
    window.dispatchEvent(new MouseEvent('pointerup'));
  });
}

export function hover(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

export function pressKey(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

export function openLevelMenu(dot: HTMLElement): HTMLElement | null {
  dot.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
  );
  return document.querySelector<HTMLElement>(SURFACE.levelMenu);
}

/**
 * Registers per-test setup: fake timers, fresh timeline modules (a fresh content-script load),
 * an empty extension and localStorage, the layout shim, and the conversation URL. Leaves the
 * conversation and unloads the page after each test so no timeline outlives its test.
 */
export function useTimelinePage(initialPath = '/app/abc123'): () => ExtensionFake {
  let ext: ExtensionFake | null = null;
  let restoreLayout: (() => void) | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    ext = installExtension();
    restoreLayout = installLayout();
    history.replaceState(null, '', initialPath);
  });
  afterEach(async () => {
    await leaveConversation();
    unloadPage();
    await settle();
    document.body.innerHTML = '';
    restoreLayout?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  return () => {
    if (!ext) throw new Error('useTimelinePage: extension not installed yet');
    return ext;
  };
}

/**
 * The page reloads: storage and localStorage survive, the DOM and every module do not. Gemini
 * renders the same conversation again and the content script starts a new timeline.
 */
export async function reloadPage(turns: GeminiTurn[]): Promise<GeminiPage> {
  const path = location.pathname + location.search;
  await leaveConversation('/');
  unloadPage();
  document.body.innerHTML = '';
  vi.resetModules();
  history.replaceState(null, '', path);
  const page = new GeminiPage(turns);
  await startTimelineOnPage();
  return page;
}
