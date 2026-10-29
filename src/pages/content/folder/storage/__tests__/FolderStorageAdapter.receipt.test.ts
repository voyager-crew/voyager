import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import { LegacyFolderWriteRefusedError } from '@/features/folder/owner/legacyFolderFence';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import type { FolderData } from '../../types';
import { AIStudioFolderStorageAdapter } from '../AIStudioFolderStorageAdapter';
import { LocalStorageFolderAdapter, SafariFolderAdapter } from '../FolderStorageAdapter';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return chrome.storage;
    },
    get runtime() {
      return chrome.runtime;
    },
  },
}));

const KEY = StorageKeys.FOLDER_DATA;
const DATA: FolderData = {
  folders: [
    { id: 'f1', name: 'From Drive', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 2 },
  ],
  folderContents: { f1: [] },
};
const LATER: FolderData = { folders: [], folderContents: {} };
const ADAPTERS = [
  { backend: 'local', create: () => new LocalStorageFolderAdapter() },
  { backend: 'Safari', create: () => new SafariFolderAdapter() },
  { backend: 'AI Studio', create: () => new AIStudioFolderStorageAdapter() },
];
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  chrome.storage = originalStorage;
  localStorage.clear();
});

describe('canonical folder write receipts', () => {
  it('records the local adapter payload even if another tab replaces canonical storage immediately', async () => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      await set(items);
      memory.external('local', KEY, LATER);
    });
    const beforeWrite = vi.fn(async () => {});

    expect(await new LocalStorageFolderAdapter().saveData(KEY, DATA, undefined, beforeWrite)).toBe(
      true,
    );
    expect(beforeWrite).toHaveBeenCalledExactlyOnceWith({ [KEY]: DATA });
    expect(memory.values.local.get(KEY)).toEqual(LATER);
  });

  it('receipts the exact AI Studio folder and prompt values before their atomic write', async () => {
    const key = StorageKeys.FOLDER_DATA_AISTUDIO;
    const prompts = [{ id: 'p1', text: 'From Drive' }];
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      await set(items);
      memory.external('local', key, LATER);
      memory.external('local', StorageKeys.PROMPT_ITEMS, []);
    });
    const beforeWrite = vi.fn(async () => {});

    await new AIStudioFolderStorageAdapter().saveData(
      key,
      DATA,
      { [StorageKeys.PROMPT_ITEMS]: prompts },
      beforeWrite,
    );
    expect(beforeWrite).toHaveBeenCalledExactlyOnceWith({
      [key]: DATA,
      [StorageKeys.PROMPT_ITEMS]: prompts,
    });
    expect(memory.values.local.get(key)).toEqual(LATER);
  });

  it('retains Safari intent when a later canonical edit makes verification fail', async () => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      await set(items);
      memory.external('local', KEY, LATER);
    });
    const receipts: Record<string, unknown>[] = [];
    const saved = await new SafariFolderAdapter().saveData(KEY, DATA, undefined, async (items) => {
      receipts.push(structuredClone(items));
    });

    expect(saved).toBe(false);
    expect(receipts).toEqual([{ [KEY]: DATA }]);
    expect(memory.values.local.get(KEY)).toEqual(LATER);
  });

  it.each(ADAPTERS)(
    'leaves canonical data and page copies untouched while a $backend receipt is pending',
    async ({ create }) => {
      memory.values.local.set(KEY, LATER);
      localStorage.setItem(KEY, JSON.stringify(LATER));
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const saving = create().saveData(KEY, DATA, undefined, async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;

      expect(memory.values.local.get(KEY)).toEqual(LATER);
      expect(localStorage.getItem(KEY)).toBe(JSON.stringify(LATER));
      expect(memory.writes).toEqual([]);
      release.resolve();
      await saving;
      expect(memory.values.local.get(KEY)).toEqual(DATA);
    },
  );

  it.each(ADAPTERS)(
    'rejects a failed $backend receipt with no canonical or page fallback writes',
    async ({ create }) => {
      const failure = new Error('snapshot could not be saved');
      const beforeWrite = vi.fn(async () => {
        throw failure;
      });

      await expect(create().saveData(KEY, DATA, undefined, beforeWrite)).rejects.toBe(failure);
      expect(memory.values.local.has(KEY)).toBe(false);
      expect(memory.writes).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(beforeWrite).toHaveBeenCalledExactlyOnceWith({ [KEY]: DATA });
    },
  );

  it.each(ADAPTERS)(
    'rechecks $backend write authority after awaiting the receipt',
    async ({ backend, create }) => {
      const site = backend === 'AI Studio' ? 'aistudio' : 'gemini';
      const key = backend === 'AI Studio' ? StorageKeys.FOLDER_DATA_AISTUDIO : KEY;
      memory.values.local.set(key, LATER);
      localStorage.setItem(key, JSON.stringify(LATER));

      await expect(
        create().saveData(key, DATA, undefined, async () => {
          memory.values.local.set(AUTHORITY_FENCE_KEY, {
            build: 'owner',
            sites: { [site]: 'owner' },
          });
        }),
      ).rejects.toBeInstanceOf(LegacyFolderWriteRefusedError);
      expect(memory.values.local.get(key)).toEqual(LATER);
      expect(localStorage.getItem(key)).toBe(JSON.stringify(LATER));
      expect(memory.writes).toEqual([]);
    },
  );

  it.each(ADAPTERS)(
    'retains a harmless receipt when $backend canonical storage rejects its write',
    async ({ create }) => {
      vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(
        new Error('canonical storage failed'),
      );
      const beforeWrite = vi.fn(async () => {});

      expect(
        await create()
          .saveData(KEY, DATA, undefined, beforeWrite)
          .catch(() => false),
      ).toBe(false);
      expect(beforeWrite).toHaveBeenCalledExactlyOnceWith({ [KEY]: DATA });
      expect(memory.values.local.has(KEY)).toBe(false);
    },
  );
});
