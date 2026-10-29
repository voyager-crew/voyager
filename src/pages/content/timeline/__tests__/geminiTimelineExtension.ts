/** In-memory extension boundaries shared by the Gemini timeline acceptance fixtures. */
import { vi } from 'vitest';

import { createStarStore } from '@/features/savedLibrary/starStore';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

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
