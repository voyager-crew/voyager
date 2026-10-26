import type { GeminiSelectorFile, GeminiSelectorHost } from '@/core/gemini/selectors/types';
import { StorageKeys } from '@/core/types/common';

import type { GeminiSelectorCacheEntry } from '../cache';
import type { GeminiSelectorStorage } from '../settings';

export const HOST: GeminiSelectorHost = 'gemini.google.com';
export const VERSION = '2.2.1';

export function selectorFile(
  catalogRevision = 11,
  selectors: GeminiSelectorFile['selectors'] = { 'turn.user': ['.fixed-user'] },
  host: GeminiSelectorHost = HOST,
): GeminiSelectorFile {
  return { format: 2, site: 'gemini', host, catalogRevision, selectors };
}

export function cacheEntry(file = selectorFile()): GeminiSelectorCacheEntry {
  return { format: 1, host: file.host, extensionVersion: VERSION, fetchedAt: 100, file };
}

export function memoryStorage(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: true,
    ...initial,
  };
  const storage: GeminiSelectorStorage = {
    async get(keys) {
      const names = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(names.map((key) => [key, structuredClone(values[key])]));
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) values[key] = structuredClone(value);
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    },
  };
  return { values, storage };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function jsonResponse(file: unknown = selectorFile()): Response {
  return new Response(JSON.stringify(file), { headers: { 'content-type': 'application/json' } });
}
