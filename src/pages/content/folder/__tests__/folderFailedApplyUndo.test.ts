import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import { isWriteCopyMessage } from '@/features/storage/budgetCopyMessage';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { FolderRepository } from '../FolderRepository';
import { GEMINI_FOLDER_CONFIG } from '../platformFolderConfig';
import {
  type IFolderStorageAdapter,
  LocalStorageFolderAdapter,
  SafariFolderAdapter,
} from '../storage/FolderStorageAdapter';
import type { FolderData } from '../types';

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

const EMPTY: FolderData = { folders: [], folderContents: {} };
function folder(name: string): FolderData {
  return {
    folders: [
      { id: 'f', name, parentId: null, isExpanded: true, sortIndex: 0, createdAt: 1, updatedAt: 1 },
    ],
    folderContents: { f: [] },
  };
}
const DOWNLOADED = folder('Downloaded but not committed');
const OLDER = folder('Different older page copy');

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repositories: Set<FolderRepository>;
let reloads: Promise<void>[];

function createRepository(adapter: IFolderStorageAdapter): FolderRepository {
  const repository = new FolderRepository(GEMINI_FOLDER_CONFIG, adapter, {
    onChange: () => {},
    onRecovery: () => {},
    onAccountReleased: () => {},
    isEnabled: () => true,
    onExternalChange: () => {
      reloads.push(repository.loadData());
    },
  });
  repositories.add(repository);
  return repository;
}

async function settleReloads(): Promise<void> {
  await settle();
  while (reloads.length) {
    await Promise.all(reloads.splice(0));
    await settle();
  }
}

async function failedDownload(repository: FolderRepository): Promise<void> {
  const key = repository.storageKey;
  expect(memory.values.local.has(key)).toBe(false);
  const snapshot = await captureCloudSyncSnapshot({
    context: {
      source: 'folder-panel-download',
      platform: 'gemini',
      accountScope: repository.accountScope,
    },
    keys: [{ area: 'local', key }],
  });
  const set = memory.api.local.set.bind(memory.api.local);
  const unavailable = vi.spyOn(memory.api.local, 'set').mockImplementation(async (items) => {
    if (key in items) throw new Error('Canonical folder quota exceeded');
    await set(items);
  });
  expect(
    await repository.replaceData(DOWNLOADED, undefined, (items) =>
      recordCloudSyncWrites(snapshot.id, [
        { area: 'local', key, kind: 'folders', value: items[key] },
      ]),
    ),
  ).toBe(false);
  unavailable.mockRestore();
  await finishCloudSyncSnapshot(snapshot.id);
  await settleReloads();
  // The real adapter mirrored the download before both canonical attempts failed.
  expect(localStorage.getItem(key)).toBe(JSON.stringify(DOWNLOADED));
  expect(memory.values.local.has(key)).toBe(false);
  expect(repository.data).toEqual(EMPTY);
}

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  repositories = new Set();
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
  for (const repository of repositories) await repository.destroy();
  await settleReloads();
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe.each([
  { backend: 'localStorage', create: () => new LocalStorageFolderAdapter() },
  { backend: 'Safari', create: () => new SafariFolderAdapter() },
])('failed folder download undo followed by $backend re-init', ({ create }) => {
  it.each([false, true])(
    'suppresses the failed mirror on reload and re-init (undo retries: %s)',
    async (retryUndo) => {
      const repository = createRepository(new LocalStorageFolderAdapter());
      await repository.init();
      await failedDownload(repository);
      const key = repository.storageKey;
      memory.writes.length = 0;

      if (retryUndo) {
        const set = memory.api.local.set.bind(memory.api.local);
        const unavailable = vi
          .spyOn(memory.api.local, 'set')
          .mockImplementation(async (items: Record<string, unknown>) => {
            if (
              parseCloudSyncSnapshotSlot(items[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT])?.kind ===
              'undone'
            )
              throw new Error('Final undo metadata quota exceeded');
            await set(items);
          });
        expect(await undoCloudSyncSnapshot()).toEqual({
          status: 'failed',
          error: 'Final undo metadata quota exceeded',
        });
        unavailable.mockRestore();
      }

      expect(await undoCloudSyncSnapshot()).toMatchObject({
        status: 'restored',
        restoredKeys: 0,
        kept: [],
      });
      expect(memory.writes.filter((write) => write.key === key)).toEqual([]);
      await settleReloads();
      await repository.loadData();
      const openView = structuredClone(repository.data);
      await repository.destroy();
      repositories.delete(repository);
      // A still-open older page can leave the same mirror again after this page read it.
      localStorage.setItem(key, JSON.stringify(DOWNLOADED));
      const reopened = createRepository(create());
      await reopened.init();
      await settleReloads();

      expect(openView).toEqual(EMPTY);
      expect(reopened.data).toEqual(EMPTY);
      expect(localStorage.getItem(key)).toBeNull();
      expect(memory.values.local.has(key)).toBe(false);
    },
  );

  it('still migrates a different older page copy after undoing the failed download', async () => {
    const repository = createRepository(new LocalStorageFolderAdapter());
    await repository.init();
    await failedDownload(repository);
    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [],
    });
    await repository.destroy();
    repositories.delete(repository);
    const key = repository.storageKey;
    localStorage.setItem(key, JSON.stringify(OLDER));
    const reopened = createRepository(create());
    await reopened.init();
    await settleReloads();

    expect(reopened.data).toEqual(OLDER);
    const stored = memory.values.local.get(key);
    expect(typeof stored === 'string' ? JSON.parse(stored) : stored).toEqual(OLDER);
  });
});
