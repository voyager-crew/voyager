import { afterEach, beforeEach, vi } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { draftSavePrimitive } from '@/features/plugins/verbs/draftSave';

export const SEND_CHECK_INTERVAL_MS = 1000;
const adapter = requireBundledSiteAdapter('gemini');
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let scopes: PluginScope[] = [];

/** Exercise the actual primitive with Gemini's route and composer policy. */
export function startDraftPlugin(): () => Promise<void> {
  const scope = new PluginScope();
  scopes.push(scope);
  const doc = new Proxy(document, {
    get(target, key) {
      if (key === 'location') return window.location;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  draftSavePrimitive.activate(
    scope,
    {},
    {
      pluginId: 'local.test.draft',
      settings: {},
      adapter,
      doc,
      setTargetCounter: () => {},
    },
  );
  return () => scope.dispose();
}

/** In-memory store for chrome.storage.local mock */
export let localStore: Record<string, unknown> = {};

export function setupMocks() {
  localStore = {};

  // Mock chrome.storage.local
  (chrome.storage as unknown as Record<string, unknown>).local = {
    get: vi.fn(
      (key: string | string[] | null, callback: (result: Record<string, unknown>) => void) => {
        if (key === null) {
          callback({ ...localStore });
        } else if (typeof key === 'string') {
          callback({ [key]: localStore[key] });
        } else {
          const result: Record<string, unknown> = {};
          for (const k of key) {
            result[k] = localStore[k];
          }
          callback(result);
        }
      },
    ),
    set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
      Object.assign(localStore, items);
      callback?.();
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      const keyList = typeof keys === 'string' ? [keys] : keys;
      for (const k of keyList) {
        delete localStore[k];
      }
      callback?.();
    }),
  };

  // Mock chrome.runtime.lastError
  Object.defineProperty(chrome.runtime, 'lastError', {
    get: () => null,
    configurable: true,
  });
}

export function createContentEditable(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('role', 'textbox');
  // Make it "visible" for getBoundingClientRect
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      height: 100,
      width: 500,
      top: 0,
      left: 0,
      bottom: 100,
      right: 500,
    }),
  });
  document.body.appendChild(el);
  return el;
}

export function createMainComposer(): {
  input: HTMLElement;
  button: HTMLButtonElement;
  root: HTMLElement;
} {
  const input = createContentEditable();
  const root = document.createElement('div');
  root.className = 'text-input-field';
  const button = document.createElement('button');
  button.className = 'send-button';
  button.setAttribute('aria-label', 'Send message');
  Object.defineProperty(button, 'offsetParent', { configurable: true, value: root });
  root.append(input, button);
  document.body.append(root);
  return { input, button, root };
}

export function addSentUserTurn(text: string): void {
  const turn = document.createElement('user-query');
  const bubble = document.createElement('div');
  bubble.className = 'user-query-bubble-with-background';
  bubble.textContent = text;
  turn.append(bubble);
  document.body.append(turn);
}

/** The Gemini page, fake clock and teardown every draftSave case starts from. */
export function setupDraftSaveTests(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.body.innerHTML = '';

    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/app/test-conversation-123',
        hostname: 'gemini.google.com',
        origin: 'https://gemini.google.com',
        search: '',
        get href() {
          return `https://gemini.google.com${this.pathname}${this.search}`;
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, 'location', originalLocation);
    document.body.replaceChildren();
  });
}
