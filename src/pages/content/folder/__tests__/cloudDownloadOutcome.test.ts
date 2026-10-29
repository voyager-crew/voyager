import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { parseCloudSyncSnapshot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { applyFolderCloudDownload } from '@/features/folder/services/cloudDownloadApply';
import { createMemoryStorage, type MemoryStorage } from '@/tests/memoryStorage';

import { LocalStorageFolderAdapter } from '../storage/FolderStorageAdapter';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return chrome.storage;
    },
  },
}));

const KEY = StorageKeys.FOLDER_DATA;
const EXTRA = StorageKeys.TIMELINE_HIERARCHY;
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const context = {
  source: 'folder-panel-download',
  platform: 'gemini',
  accountScope: null,
} as const;
const original: FolderData = { folders: [], folderContents: {} };
const downloaded: FolderData = {
  folders: [
    {
      id: 'cloud',
      name: 'Downloaded',
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: { cloud: [] },
};
let memory: MemoryStorage;
let previousStorage: typeof chrome.storage;

function saveFolders(snapshotId: string) {
  return new LocalStorageFolderAdapter().saveData(KEY, downloaded, undefined, (items) =>
    recordCloudSyncWrites(snapshotId, [
      { area: 'local', key: KEY, kind: 'folders', value: items[KEY] },
    ]),
  );
}

beforeEach(() => {
  previousStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  memory.values.local.set(KEY, original);
  memory.values.local.set(EXTRA, { conversations: {} });
  localStorage.clear();
});

afterEach(() => {
  chrome.storage = previousStorage;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('folder download settled outcomes', () => {
  it.each(['canonical', 'finish'] as const)(
    'keeps successful folders and the undo id when cancelled during %s',
    async (phase) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const set = memory.api.local.set.bind(memory.api.local);
      vi.spyOn(memory.api.local, 'set').mockImplementation(
        async (items: Record<string, unknown>) => {
          if (
            phase === 'canonical'
              ? KEY in items
              : parseCloudSyncSnapshot(items[SLOT])?.entries.length === 1
          ) {
            entered.resolve();
            await release.promise;
          }
          await set(items);
        },
      );
      const applying = applyFolderCloudDownload({
        context,
        keys: [
          { area: 'local', key: KEY },
          { area: 'local', key: EXTRA },
        ],
        current: () => true,
        saveFolders,
      });
      await entered.promise;
      const snapshotId = parseCloudSyncSnapshot(memory.values.local.get(SLOT))?.id;
      window.dispatchEvent(new Event('pagehide'));
      expect(memory.values.local.get(KEY)).toEqual(phase === 'canonical' ? original : downloaded);
      release.resolve();

      expect(await applying).toMatchObject({
        status: 'cancelled',
        snapshotId,
        restored: ['folders'],
      });
      expect(memory.values.local.get(KEY)).toEqual(downloaded);
      expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
      expect(memory.values.local.get(KEY)).toEqual(original);
    },
  );

  it('keeps the owner failure and snapshot id when finish also fails', async () => {
    const set = memory.api.local.set.bind(memory.api.local);
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      const snapshot = parseCloudSyncSnapshot(items[SLOT]);
      if (snapshot?.entries.length === 1) throw new Error('Finish quota exceeded');
      await set(items);
    });
    const ownerError = new Error('Hierarchy owner failed');
    const result = await applyFolderCloudDownload({
      context,
      keys: [
        { area: 'local', key: KEY },
        { area: 'local', key: EXTRA },
      ],
      current: () => true,
      saveFolders,
      restoreExtras: async () => {
        throw ownerError;
      },
    }).catch((error: unknown) => error);

    expect(result).toMatchObject({
      message: 'Hierarchy owner failed',
      cause: ownerError,
      snapshotId: (await readCloudSyncSnapshot())?.id,
      restored: ['folders'],
    });
    expect(memory.values.local.get(KEY)).toEqual(downloaded);
    expect(memory.values.local.get(EXTRA)).toEqual({ conversations: {} });
  });

  it('carries the snapshot id when successful owners are followed by finish failure', async () => {
    const set = memory.api.local.set.bind(memory.api.local);
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      const snapshot = parseCloudSyncSnapshot(items[SLOT]);
      if (snapshot?.entries.length === 1) throw new Error('Finish quota exceeded');
      await set(items);
    });
    const result = await applyFolderCloudDownload({
      context,
      keys: [
        { area: 'local', key: KEY },
        { area: 'local', key: EXTRA },
      ],
      current: () => true,
      saveFolders,
    }).catch((error: unknown) => error);

    expect(result).toMatchObject({
      message: 'Finish quota exceeded',
      snapshotId: (await readCloudSyncSnapshot())?.id,
      restored: ['folders'],
    });
    expect(memory.values.local.get(KEY)).toEqual(downloaded);
  });
});
