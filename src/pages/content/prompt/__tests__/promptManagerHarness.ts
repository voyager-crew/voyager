import { afterEach, beforeEach, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';

import { startPromptManager } from '../index';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

export let manager: Awaited<ReturnType<typeof startPromptManager>> | undefined;

export function storageGet(values: Record<string, unknown>): typeof chrome.storage.sync.get {
  const get = (
    keys: string | string[] | Record<string, unknown> | null = null,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const names =
      keys === null
        ? Object.keys(values)
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
    const result = Object.fromEntries(names.map((key) => [key, values[key] ?? defaults[key]]));
    callback?.(result);
    return Promise.resolve(result);
  };
  return get as typeof chrome.storage.sync.get;
}

export async function openManager(items: PromptItem[]): Promise<HTMLElement> {
  vi.mocked(chrome.storage.local.get).mockImplementation(
    storageGet({ [StorageKeys.PROMPT_ITEMS]: items }),
  );
  manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
  document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
  return document.querySelector<HTMLElement>('#gv-pm-panel')!;
}

export function emitStorageChange(changes: Record<string, unknown>, area: string): void {
  for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
    (listener as (changes: object, area: string) => void)(changes, area);
  }
}

export const prompt = (id: string, name: string, text = `${name} body`): PromptItem => ({
  id,
  name,
  text,
  tags: [],
  createdAt: 1,
});

/** Clean page, English UI and console spies around every prompt manager case. */
export function setupPromptManagerTests(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.mocked(chrome.storage.sync.get).mockImplementation(
      storageGet({ [StorageKeys.LANGUAGE]: 'en' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // startPromptManager wraps console.warn for KaTeX; let restoreAllMocks undo it.
    vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    manager?.destroy();
    manager = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
}
