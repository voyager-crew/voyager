import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { DataBackupService } from '@/core/services/DataBackupService';
import { StorageKeys } from '@/core/types/common';
import { validateFolderData } from '@/features/folder/model/folderData';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import { isWriteCopyMessage } from '@/features/storage/budgetCopyMessage';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { FolderRepository } from './FolderRepository';
import { GEMINI_FOLDER_CONFIG } from './platformFolderConfig';
import {
  type IFolderStorageAdapter,
  LocalStorageFolderAdapter,
  SafariFolderAdapter,
} from './storage/FolderStorageAdapter';
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function folder(name: string): FolderData {
  return {
    folders: [
      { id: 'f', name, parentId: null, isExpanded: true, sortIndex: 0, createdAt: 1, updatedAt: 1 },
    ],
    folderContents: {
      f: [
        {
          conversationId: 'existing',
          title: 'Existing conversation',
          url: 'https://gemini.google.com/app/existing',
          addedAt: 1,
          lastOpenedAt: 1,
          sortIndex: 0,
        },
      ],
    },
  };
}

const adapters = [
  { name: 'localStorage', create: () => new LocalStorageFolderAdapter() },
  { name: 'Safari', create: () => new SafariFolderAdapter() },
];
const UNDO_FAILURE_KEY = 'q7UndoFailure';
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repositories: Set<FolderRepository>;
let reloads: Promise<void>[];
const recovery = vi.fn();
const saveFailed = vi.fn();

function createRepository(adapter: IFolderStorageAdapter): FolderRepository {
  const repository = new FolderRepository(
    { ...GEMINI_FOLDER_CONFIG, recoverMissingData: true },
    adapter,
    {
      onChange: () => {},
      onRecovery: recovery,
      onSaveFailed: saveFailed,
      onAccountReleased: () => {},
      isEnabled: () => true,
      onExternalChange: () => reloads.push(repository.loadData()),
    },
  );
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

beforeEach(() => {
  vi.useFakeTimers();
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  repositories = new Set();
  reloads = [];
  recovery.mockReset();
  saveFailed.mockReset();
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
  vi.useRealTimers();
  localStorage.clear();
});

describe.each(adapters)('cloud undo races through $name folders', ({ create }) => {
  it.each(['marker', 'fence', 'save'] as const)(
    'does not overwrite another tab after recovery waits for its %s read',
    async (boundary) => {
      await new DataBackupService<FolderData>(
        GEMINI_FOLDER_CONFIG.backupNamespace,
        validateFolderData,
      ).createPrimaryBackup(folder('Old backup'));
      memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, {
        folders: [],
        folderContents: [],
      });
      const waiting = deferred();
      const release = deferred();
      const get = memory.api.local.get.bind(memory.api.local) as (
        keys: unknown,
      ) => Promise<Record<string, unknown>>;
      let hydrated = false;
      let recoveryMarkerRead = false;
      let paused = false;
      let released = false;
      vi.spyOn(memory.api.local, 'get').mockImplementation(async (keys: unknown) => {
        const stored = await get(keys);
        if (Array.isArray(keys) && keys.some((key) => key.startsWith('gvBackup_'))) hydrated = true;
        const marker = hydrated && keys === StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
        if (marker) recoveryMarkerRead = true;
        const recoverySave =
          boundary === 'save' &&
          !released &&
          recovery.mock.calls.some(([result]) => result === 'recovered') &&
          keys === AUTHORITY_FENCE_KEY;
        if (
          recoverySave ||
          (!paused &&
            (boundary === 'marker'
              ? marker
              : boundary === 'fence' && recoveryMarkerRead && keys === AUTHORITY_FENCE_KEY))
        ) {
          paused = true;
          waiting.resolve();
          await release.promise;
        }
        return stored;
      });
      const repository = createRepository(create());
      const loading = repository.init();
      await waiting.promise;
      const newer = folder('Saved in another tab');
      memory.external('local', repository.storageKey, newer);
      await settle();
      released = true;
      release.resolve();
      await loading;

      expect(memory.values.local.get(repository.storageKey)).toEqual(newer);
      expect(memory.writes.filter(({ key }) => key === repository.storageKey)).toEqual([]);
      expect(saveFailed).not.toHaveBeenCalled();
      if (boundary !== 'save') expect(recovery).not.toHaveBeenCalledWith('recovered');
      await vi.advanceTimersByTimeAsync(1000);
      await settleReloads();
      expect(repository.data).toEqual(newer);
      expect(repository.canEdit).toBe(true);
    },
  );

  it.each(['newer', 'corrupt'] as const)(
    'keeps failed edits through an authority refusal and reads %s canonical data before retrying',
    async (canonical) => {
      memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, folder('Initial'));
      const repository = createRepository(create());
      await repository.init();
      const failedEdit = folder('Accepted edit whose save failed');
      const set = memory.api.local.set.bind(memory.api.local) as (
        items: Record<string, unknown>,
      ) => Promise<void>;
      const failedSave = vi
        .spyOn(memory.api.local, 'set')
        .mockImplementation(async (items: Record<string, unknown>) => {
          if (repository.storageKey in items) throw new Error('Initial save failed');
          await set(items);
        });
      repository.data = structuredClone(failedEdit);
      expect(await repository.saveData()).toBe(false);
      failedSave.mockRestore();
      memory.values.local.set(repository.storageKey, { folders: [], folderContents: [] });
      const get = memory.api.local.get.bind(memory.api.local) as (
        keys: unknown,
      ) => Promise<Record<string, unknown>>;
      let authorityUnavailable = true;
      vi.spyOn(memory.api.local, 'get').mockImplementation(async (keys: unknown) => {
        if (
          authorityUnavailable &&
          keys === AUTHORITY_FENCE_KEY &&
          recovery.mock.calls.some(([result]) => result === 'kept')
        )
          throw new Error('Recovery authority unavailable');
        return get(keys);
      });

      await repository.loadData();
      expect(repository.canEdit).toBe(false);
      expect(repository.data).toEqual(failedEdit);
      const expected =
        canonical === 'newer' ? folder('Written during authority outage') : failedEdit;
      if (canonical === 'newer') memory.external('local', repository.storageKey, expected);
      await settle();
      authorityUnavailable = false;
      await vi.advanceTimersByTimeAsync(1000);
      await settleReloads();
      await repository.loadData();
      await settleReloads();

      expect(repository.canEdit).toBe(true);
      expect(repository.data).toEqual(expected);
      expect(memory.values.local.get(repository.storageKey)).toEqual(expected);
    },
  );

  it.each(['undone', 'undoing'] as const)(
    'keeps differing debounced edits when an %s marker matches only their baseline',
    async (markerKind) => {
      const before = folder('Before download');
      memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, before);
      memory.values.sync.set(UNDO_FAILURE_KEY, 'before');
      const repository = createRepository(create());
      await repository.init();
      const keys = [
        { area: 'local', key: repository.storageKey },
        { area: 'sync', key: UNDO_FAILURE_KEY },
      ] as const;
      const snapshot = await captureCloudSyncSnapshot({
        context: {
          source: 'folder-panel-download',
          platform: 'gemini',
          accountScope: repository.accountScope,
        },
        keys,
      });
      const cloud = folder('Downloaded name');
      cloud.folders.push({ ...cloud.folders[0], id: 'download-only', name: 'Download only' });
      cloud.folderContents['download-only'] = [];
      expect(
        await repository.replaceData(cloud, undefined, (items) =>
          recordCloudSyncWrites(snapshot.id, [
            {
              area: 'local',
              key: repository.storageKey,
              kind: 'folders',
              value: items[repository.storageKey],
            },
          ]),
        ),
      ).toBe(true);
      const syncItems = { [UNDO_FAILURE_KEY]: 'downloaded' };
      await recordCloudSyncWrites(snapshot.id, [
        {
          area: 'sync',
          key: UNDO_FAILURE_KEY,
          kind: 'settings',
          value: syncItems[UNDO_FAILURE_KEY],
        },
      ]);
      await chrome.storage.sync.set(syncItems);
      await finishCloudSyncSnapshot(snapshot.id);
      await repository.session!.backup.finishPendingWrites();
      await settleReloads();
      repository.data.folders[0].isExpanded = false;
      repository.data.folders[0].updatedAt = 20;
      repository.data.folderContents.f[0].lastOpenedAt = 20;
      repository.scheduleSaveData();
      if (markerKind === 'undoing') {
        const set = memory.api.sync.set.bind(memory.api.sync) as (
          items: Record<string, unknown>,
        ) => Promise<void>;
        vi.spyOn(memory.api.sync, 'set').mockImplementation(
          async (items: Record<string, unknown>) => {
            if (items[UNDO_FAILURE_KEY] === 'before') throw new Error('Undo interrupted');
            await set(items);
          },
        );
      }

      expect(await undoCloudSyncSnapshot()).toMatchObject({
        status: markerKind === 'undone' ? 'restored' : 'failed',
      });
      await settleReloads();
      await repository.loadData();
      await settleReloads();
      expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)).toMatchObject({
        kind: markerKind,
      });
      const expected = folder('Before download');
      expected.folders[0].isExpanded = false;
      expected.folders[0].updatedAt = 20;
      expected.folderContents.f[0].lastOpenedAt = 20;
      expect(repository.data).toEqual(expected);
      await vi.advanceTimersByTimeAsync(300);
      await settleReloads();
      expect(memory.values.local.get(repository.storageKey)).toEqual(expected);
    },
  );
});
