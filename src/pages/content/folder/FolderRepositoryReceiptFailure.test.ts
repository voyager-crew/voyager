import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { isWriteCopyMessage } from '@/features/storage/budgetCopyMessage';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { FolderRepository } from './FolderRepository';
import { GEMINI_FOLDER_CONFIG } from './platformFolderConfig';
import { LocalStorageFolderAdapter, SafariFolderAdapter } from './storage/FolderStorageAdapter';
import type { FolderData } from './types';

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

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
function folder(name: string): FolderData {
  return {
    folders: [
      { id: 'f', name, parentId: null, isExpanded: true, sortIndex: 0, createdAt: 1, updatedAt: 1 },
    ],
    folderContents: { f: [] },
  };
}
const BEFORE = folder('Before download');
const DOWNLOADED = folder('Downloaded A');
const LATER = folder('Newer local edit B');

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repository: FolderRepository | undefined;
let reloads: Promise<void>[];

async function settleReloads(): Promise<void> {
  await settle();
  while (reloads.length) {
    await Promise.all(reloads.splice(0));
    await settle();
  }
}

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  reloads = [];
  localStorage.clear();
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((async (message: unknown) => {
    if (!isWriteCopyMessage(message)) return undefined;
    await memory.api.local.set({ [message.key]: message.value });
    return { status: 'saved' };
  }) as typeof chrome.runtime.sendMessage);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await repository?.destroy();
  await settleReloads();
  repository = undefined;
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe.each([
  { backend: 'localStorage', create: () => new LocalStorageFolderAdapter() },
  { backend: 'Safari', create: () => new SafariFolderAdapter() },
])('folder download receipt failure through $backend', ({ create }) => {
  it.each(['once', 'permanent'] as const)(
    'keeps a later edit and writes no download payload when receipt storage fails %s',
    async (failure) => {
      memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, BEFORE);
      const current = new FolderRepository(GEMINI_FOLDER_CONFIG, create(), {
        onChange: () => {},
        onRecovery: () => {},
        onAccountReleased: () => {},
        isEnabled: () => true,
        onExternalChange: () => {
          reloads.push(current.loadData());
        },
      });
      repository = current;
      await current.init();
      const key = current.storageKey;
      const snapshot = await captureCloudSyncSnapshot({
        context: {
          source: 'folder-panel-download',
          platform: 'gemini',
          accountScope: current.accountScope,
        },
        keys: [{ area: 'local', key }],
      });
      const set = memory.api.local.set.bind(memory.api.local);
      const canonicalPayloads: unknown[] = [];
      const pagePayloads: string[] = [];
      const setPage = localStorage.setItem.bind(localStorage);
      vi.spyOn(localStorage, 'setItem').mockImplementation((storageKey, value) => {
        if (storageKey === key) pagePayloads.push(value);
        setPage(storageKey, value);
      });
      let receiptAttempts = 0;
      vi.spyOn(memory.api.local, 'set').mockImplementation(
        async (items: Record<string, unknown>) => {
          if (SLOT in items) {
            receiptAttempts += 1;
            if (receiptAttempts === 1) memory.external('local', key, LATER);
            if (failure === 'permanent' || receiptAttempts === 1)
              throw new Error('Receipt quota exceeded');
          }
          if (key in items) canonicalPayloads.push(structuredClone(items[key]));
          await set(items);
        },
      );

      const saved = await current.replaceData(DOWNLOADED, undefined, (items) =>
        recordCloudSyncWrites(snapshot.id, [
          { area: 'local', key, kind: 'folders', value: items[key] },
        ]),
      );
      await settleReloads();

      // A failed receipt admits no apply write, so the repository must not retry stale A over B.
      expect(saved).toBe(false);
      expect(receiptAttempts).toBe(1);
      expect(canonicalPayloads).toEqual([]);
      expect(pagePayloads).not.toContain(JSON.stringify(DOWNLOADED));
      expect(memory.values.local.get(key)).toEqual(LATER);
      expect(current.data).toEqual(LATER);

      vi.mocked(memory.api.local.set).mockRestore();
      await finishCloudSyncSnapshot(snapshot.id);
      expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
      await settleReloads();
      await current.loadData();
      expect(memory.values.local.get(key)).toEqual(LATER);
      expect(current.data).toEqual(LATER);
    },
  );
});
