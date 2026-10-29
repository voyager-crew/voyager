import { onTestFinished, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { budgetCopyBridge } from '@/features/storage/__tests__/budgetCopyBridge';

// One in-memory extension storage behind both browser.storage.local (writes)
// and chrome.storage.local (StorageQuotaService's headroom probe). `set` rejects
// past `QUOTA_BYTES`, counting bytes the way Chrome does.
const extension = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const itemBytes = (key: string, value: unknown): number => {
    const encoder = new TextEncoder();
    return encoder.encode(key).byteLength + encoder.encode(JSON.stringify(value)).byteLength;
  };
  const bytesIn = (items: Record<string, unknown>, keys?: string[] | null): number =>
    (keys ?? Object.keys(items))
      .filter((key) => key in items)
      .reduce((sum, key) => sum + itemBytes(key, items[key]), 0);
  const list = (keys?: string | string[] | null): string[] =>
    keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
  const area = {
    QUOTA_BYTES: undefined as number | undefined,
    get: async (keys?: string | string[] | null) =>
      Object.fromEntries(
        list(keys)
          .filter((key) => key in store)
          .map((key) => [key, store[key]]),
      ),
    set: async (items: Record<string, unknown>) => {
      const quota = area.QUOTA_BYTES ?? Number.POSITIVE_INFINITY;
      if (bytesIn({ ...store, ...items }) > quota) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const key of list(keys)) delete store[key];
    },
    getBytesInUse: async (keys?: string | string[] | null) =>
      bytesIn(store, keys == null ? null : list(keys)),
  };
  return { store, area, itemBytes };
});
export const durableStore = extension.store;

/** The background end of `runtime.sendMessage`; `null` while the background is unreachable. */
const runtime = vi.hoisted(() => ({
  background: null as null | ((message: unknown) => Promise<unknown>),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn((message: unknown) =>
        runtime.background
          ? runtime.background(message)
          : Promise.reject(new Error('Could not establish connection')),
      ),
    },
    storage: {
      local: {
        get: vi.fn((keys) => extension.area.get(keys)),
        set: vi.fn((items) => extension.area.set(items)),
        remove: vi.fn((keys) => extension.area.remove(keys)),
      },
    },
  },
}));

// Toggle Safari detection per test. Read once per DataBackupService construction.
export const safari = { enabled: false };
vi.mock('@/core/utils/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/utils/browser')>()),
  isSafari: () => safari.enabled,
}));

export const chromeLocal = chrome.storage.local;

export function resetStores(): void {
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.set).mockImplementation((items) => extension.area.set(items));
  localStorage.clear();
  for (const key of Object.keys(durableStore)) delete durableStore[key];
  extension.area.QUOTA_BYTES = undefined;
  (chrome.storage as { local: unknown }).local = extension.area;
  runtime.background = budgetCopyBridge((items) => browser.storage.local.set(items));
}

export const usedBytes = (): number =>
  Object.entries(durableStore).reduce(
    (sum, [key, value]) => sum + extension.itemBytes(key, value),
    0,
  );

/** Chrome and Firefox require `unlimitedStorage`: no practical quota, only the soft cap. */
export function grantUnlimitedStorage(): void {
  const runtimeApi = chrome.runtime as { getManifest?: () => unknown };
  runtimeApi.getManifest = () => ({ permissions: ['unlimitedStorage'] });
  onTestFinished(() => {
    delete runtimeApi.getManifest;
  });
}

// Atomic quota stand-in: an unsuccessful replacement must leave the old value intact.
export function limitLocalStorage(limit: number): void {
  const values = new Map<string, string>();
  const setItem = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    const next = new Map(values).set(key, value);
    const size = [...next].reduce((sum, [name, stored]) => sum + name.length + stored.length, 0);
    if (size > limit) throw new DOMException('Storage full', 'QuotaExceededError');
    setItem(key, value);
    values.set(key, value);
  });
}

export { extension, runtime };
