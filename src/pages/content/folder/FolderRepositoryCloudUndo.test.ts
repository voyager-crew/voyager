import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { StorageKeys } from '@/core/types/common';
import { isWriteCopyMessage } from '@/features/storage/budgetCopyMessage';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { FolderRepository } from './FolderRepository';
import { GEMINI_FOLDER_CONFIG, type PlatformFolderConfig } from './platformFolderConfig';
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

const EMPTY: FolderData = { folders: [], folderContents: {} };
function folder(name: string): FolderData {
  return {
    folders: [
      { id: 'f', name, parentId: null, isExpanded: true, sortIndex: 0, createdAt: 1, updatedAt: 1 },
    ],
    folderContents: { f: [] },
  };
}
const CLOUD = folder('From Drive');
const adapters = [
  { name: 'localStorage', create: () => new LocalStorageFolderAdapter() },
  { name: 'Safari', create: () => new SafariFolderAdapter() },
];

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repositories: Set<FolderRepository>;
let reloads: Promise<void>[];

function createRepository(
  adapter: IFolderStorageAdapter,
  recoverMissingData: boolean,
): FolderRepository {
  const config: PlatformFolderConfig = { ...GEMINI_FOLDER_CONFIG, recoverMissingData };
  const repository = new FolderRepository(config, adapter, {
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

async function download(repository: FolderRepository): Promise<void> {
  expect(memory.values.local.has(repository.storageKey)).toBe(false);
  const snapshot = await captureCloudSyncSnapshot({
    context: {
      source: 'folder-panel-download',
      platform: 'gemini',
      accountScope: repository.accountScope,
    },
    keys: [{ area: 'local', key: repository.storageKey }],
  });
  expect(
    await repository.replaceData(CLOUD, undefined, (items) =>
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
  await finishCloudSyncSnapshot(snapshot.id);
  await repository.session!.backup.finishPendingWrites();
  await settleReloads();
  expect(repository.data).toEqual(CLOUD);
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

describe.each(adapters)('first-download undo through $name folders', ({ name, create }) => {
  it('does not resurrect removed data from a page mirror in an open or reopened repository', async () => {
    const repository = createRepository(create(), false);
    await repository.init();
    await download(repository);
    repository.data.folders[0].isExpanded = false;
    repository.scheduleSaveData();
    // Old Safari contexts can leave this legacy page copy; current non-Safari saves make it.
    if (name === 'Safari') {
      localStorage.setItem(repository.storageKey, JSON.stringify(CLOUD));
      await chrome.storage.local.remove(`${repository.storageKey}_migrated`);
    }
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    await settleReloads();
    await repository.loadData();
    const openView = structuredClone(repository.data);
    await repository.destroy();
    repositories.delete(repository);
    const reopened = createRepository(create(), false);
    await reopened.init();
    await settleReloads();

    expect(openView).toEqual(EMPTY);
    expect(reopened.data).toEqual(EMPTY);
    expect(memory.values.local.has(reopened.storageKey)).toBe(false);
  });

  it.each(['page', 'durable'] as const)(
    'recoverMissingData does not restore the undone download from %s recovery copies',
    async (source) => {
      const repository = createRepository(create(), true);
      await repository.init();
      if (source === 'durable') {
        const setPage = localStorage.setItem.bind(localStorage);
        vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
          if (key.startsWith('gvBackup_')) throw new DOMException('Full', 'QuotaExceededError');
          setPage(key, value);
        });
      }
      await download(repository);
      const primary = `gvBackup_${GEMINI_FOLDER_CONFIG.backupNamespace}_primary`;
      expect(
        source === 'page' ? localStorage.getItem(primary) : memory.values.local.get(primary),
      ).toBeTruthy();
      localStorage.removeItem(repository.storageKey);
      expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
      await settleReloads();
      await repository.loadData();
      const openView = structuredClone(repository.data);
      await repository.destroy();
      repositories.delete(repository);
      const reopened = createRepository(create(), true);
      await reopened.init();
      await settleReloads();

      expect(openView).toEqual(EMPTY);
      expect(reopened.data).toEqual(EMPTY);
      expect(memory.values.local.has(reopened.storageKey)).toBe(false);
    },
  );

  it('can still recover a differing older backup after skipping the undone primary copy', async () => {
    const repository = createRepository(create(), true);
    await repository.init();
    const older = folder('Real older recovery');
    await repository.session!.backup.createEmergencyBackup(older);
    await download(repository);
    localStorage.removeItem(repository.storageKey);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    await settleReloads();
    await repository.loadData();

    expect(repository.data).toEqual(older);
    expect(memory.values.local.get(repository.storageKey)).toEqual(older);
  });

  it('does not migrate the undone cloud copy from the legacy bucket into its removed scoped destination', async () => {
    memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
    const repository = createRepository(create(), false);
    await repository.init();
    expect(repository.storageKey).not.toBe(GEMINI_FOLDER_CONFIG.storageKey);
    await download(repository);
    await chrome.storage.local.set({ [GEMINI_FOLDER_CONFIG.storageKey]: CLOUD });
    localStorage.removeItem(repository.storageKey);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    await settleReloads();
    await repository.loadData();

    expect(repository.data).toEqual(EMPTY);
    expect(memory.values.local.has(repository.storageKey)).toBe(false);
    expect(memory.values.local.get(GEMINI_FOLDER_CONFIG.storageKey)).toEqual(CLOUD);
  });

  it('can migrate a differing older page mirror after undo while the marker remains active', async () => {
    const repository = createRepository(create(), false);
    await repository.init();
    await download(repository);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    await settleReloads();
    await repository.destroy();
    repositories.delete(repository);
    const older = folder('Older real page mirror');
    localStorage.setItem(repository.storageKey, JSON.stringify(older));
    // A legacy Safari context may not have written its one-time migration receipt.
    if (name === 'Safari') await chrome.storage.local.remove(`${repository.storageKey}_migrated`);
    const reopened = createRepository(create(), false);
    await reopened.init();
    await settleReloads();

    expect(reopened.data).toEqual(older);
    const canonical = memory.values.local.get(reopened.storageKey);
    expect(typeof canonical === 'string' ? JSON.parse(canonical) : canonical).toEqual(older);
  });

  it('keeps canonical edits made after download and does not mark them as undone', async () => {
    const repository = createRepository(create(), false);
    await repository.init();
    await download(repository);
    const edited = folder('Edited canonical after download');
    await chrome.storage.local.set({ [repository.storageKey]: edited });
    await settleReloads();
    // This stale page copy still reflects the successful apply, rather than the later edit.
    localStorage.setItem(repository.storageKey, JSON.stringify(CLOUD));
    if (name === 'Safari') await chrome.storage.local.remove(`${repository.storageKey}_migrated`);
    // Q7 refines Q5: a later canonical edit belongs to its writer and is never undone.
    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'folders', reason: 'changed-since-download' }],
    });
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: repository.storageKey, value: edited }),
    ).toBe(false);
    await settleReloads();
    await repository.destroy();
    repositories.delete(repository);
    const reopened = createRepository(create(), false);
    await reopened.init();
    await settleReloads();

    expect(reopened.data).toEqual(edited);
    expect(memory.values.local.get(reopened.storageKey)).toEqual(edited);
  });

  it('keeps the bucket read-only while undo metadata is unreadable instead of recovering a stale copy', async () => {
    const repository = createRepository(create(), true);
    await repository.init();
    await download(repository);
    localStorage.removeItem(repository.storageKey);
    const get = memory.api.local.get.bind(memory.api.local) as (
      keys: unknown,
    ) => Promise<Record<string, unknown>>;
    const unavailable = vi
      .spyOn(memory.api.local, 'get')
      .mockImplementation(async (keys: unknown) => {
        if (keys === StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)
          throw new Error('Metadata unavailable');
        return get(keys);
      });
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    await settleReloads();
    await repository.loadData();
    expect(repository.canEdit).toBe(false);
    expect(memory.values.local.has(repository.storageKey)).toBe(false);

    unavailable.mockRestore();
    await repository.loadData();
    await settleReloads();
    expect(repository.canEdit).toBe(true);
    expect(repository.data).toEqual(EMPTY);
    expect(memory.values.local.has(repository.storageKey)).toBe(false);
  });

  it.each([false, true])(
    'after a failed save, an unchanged undone copy is discarded but a differing local edit survives (edited=%s)',
    async (edited) => {
      const repository = createRepository(create(), true);
      await repository.init();
      await download(repository);
      if (edited) repository.data.folders[0].name = 'Unsaved user edit';
      const expected = edited ? structuredClone(repository.data) : EMPTY;
      const set = memory.api.local.set.bind(memory.api.local);
      const get = memory.api.local.get.bind(memory.api.local) as (
        keys: unknown,
      ) => Promise<Record<string, unknown>>;
      const unreadable = vi
        .spyOn(memory.api.local, 'get')
        .mockImplementation(async (keys: unknown) => {
          if (name === 'Safari' && keys === repository.storageKey)
            throw new Error('Folder verification unavailable');
          return get(keys);
        });
      const unavailable = vi.spyOn(memory.api.local, 'set').mockImplementation(async (items) => {
        if (repository.storageKey in items) throw new Error('Folder save unavailable');
        await set(items);
      });
      expect(await repository.saveData()).toBe(false);
      unavailable.mockRestore();
      unreadable.mockRestore();
      localStorage.removeItem(repository.storageKey);
      expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
      await settleReloads();
      await repository.loadData();
      expect(repository.data).toEqual(expected);
      if (edited) expect(memory.values.local.get(repository.storageKey)).toEqual(expected);
      else expect(memory.values.local.has(repository.storageKey)).toBe(false);
    },
  );
});
