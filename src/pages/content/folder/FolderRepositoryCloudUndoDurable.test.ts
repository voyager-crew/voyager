import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import { budgetCopyBridge } from '@/features/storage/__tests__/budgetCopyBridge';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { FolderRepository } from './FolderRepository';
import {
  AISTUDIO_FOLDER_CONFIG,
  GEMINI_FOLDER_CONFIG,
  type PlatformFolderConfig,
} from './platformFolderConfig';
import { AIStudioFolderStorageAdapter } from './storage/AIStudioFolderStorageAdapter';
import { type IFolderStorageAdapter, SafariFolderAdapter } from './storage/FolderStorageAdapter';
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
vi.mock('@/core/utils/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/utils/browser')>()),
  isSafari: () => true,
}));

const KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
const PRIMARY = 'gvBackup_aistudio-folders_primary';
const CLOUD: FolderData = {
  folders: [
    {
      id: 'cloud',
      name: 'From Drive',
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: { cloud: [] },
};
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repository: FolderRepository | undefined;
let reloads: Promise<void>[];
let backupWork: Promise<unknown>[];

function createRepository(
  config: PlatformFolderConfig = AISTUDIO_FOLDER_CONFIG,
  adapter: IFolderStorageAdapter = new AIStudioFolderStorageAdapter(),
): FolderRepository {
  const created = new FolderRepository(config, adapter, {
    onChange: () => {},
    onRecovery: () => {},
    onAccountReleased: () => {},
    onExternalChange: () => reloads.push(created.loadData()),
    isEnabled: () => true,
  });
  repository = created;
  return created;
}

async function finishReloads(): Promise<void> {
  await settle();
  while (reloads.length || backupWork.length) {
    await Promise.all([...reloads.splice(0), ...backupWork.splice(0)]);
    await settle();
  }
}

async function download(): Promise<string> {
  await createRepository().init();
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'folder-panel-download', platform: 'aistudio', accountScope: null },
    keys: [{ area: 'local', key: KEY }],
  });
  expect(
    await repository!.replaceData(CLOUD, undefined, (items) =>
      recordCloudSyncWrites(snapshot.id, [
        { area: 'local', key: KEY, kind: 'folders', value: items[KEY] },
      ]),
    ),
  ).toBe(true);
  await finishCloudSyncSnapshot(snapshot.id);
  await repository!.session!.backup.finishPendingWrites();
  await finishReloads();
  expect(JSON.parse(String(memory.values.local.get(PRIMARY))).data).toEqual(CLOUD);
  return snapshot.id;
}

async function replaceSnapshot(): Promise<void> {
  const next = await captureCloudSyncSnapshot({
    context: {
      source: 'popup-restore',
      platform: 'gemini',
      accountScope: null,
      selection: 'shared',
    },
    keys: [{ area: 'local', key: StorageKeys.PROMPT_ITEMS }],
  });
  await recordCloudSyncWrites(next.id, [
    { area: 'local', key: StorageKeys.PROMPT_ITEMS, kind: 'prompts', value: [] },
  ]);
  await chrome.storage.local.set({ [StorageKeys.PROMPT_ITEMS]: [] });
  await finishCloudSyncSnapshot(next.id);
  await finishReloads();
}

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  reloads = [];
  backupWork = [];
  localStorage.clear();
  vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(false);
  const bridge = budgetCopyBridge((items) => chrome.storage.local.set(items));
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => {
    const work = bridge(message);
    backupWork.push(work);
    return work;
  }) as typeof chrome.runtime.sendMessage);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await repository?.destroy();
  await finishReloads();
  repository = undefined;
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
  localStorage.clear();
});

it('keeps AI Studio folders undone after another row replaces the snapshot and the page reloads', async () => {
  const snapshotId = await download();
  expect(await undoCloudSyncSnapshot(snapshotId)).toMatchObject({ status: 'restored' });
  await finishReloads();
  await repository!.destroy();
  repository = undefined;
  expect(memory.values.local.has(KEY)).toBe(false);

  await replaceSnapshot();
  await createRepository().init();
  await finishReloads();

  expect(repository!.data).toEqual({ folders: [], folderContents: {} });
  expect(memory.values.local.has(KEY)).toBe(false);
});

it.each(['before removal', 'after removal'])(
  'keeps the correct folders when Undo is interrupted %s and another row replaces its slot',
  async (interruption) => {
    const snapshotId = await download();
    await repository!.destroy();
    repository = undefined;
    const set = memory.api.local.set.bind(memory.api.local);
    const failure =
      interruption === 'before removal'
        ? vi.spyOn(memory.api.local, 'remove').mockRejectedValue(new Error('Removal unavailable'))
        : vi
            .spyOn(memory.api.local, 'set')
            .mockImplementation(async (items: Record<string, unknown>) => {
              if (
                parseCloudSyncSnapshotSlot(items[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT])
                  ?.kind === 'undone'
              )
                throw new Error('Final Undo persistence unavailable');
              await set(items);
            });

    expect(await undoCloudSyncSnapshot(snapshotId)).toMatchObject({ status: 'failed' });
    failure.mockRestore();
    await finishReloads();
    expect(memory.values.local.has(KEY)).toBe(interruption === 'before removal');
    expect(memory.values.local.has(PRIMARY)).toBe(true);

    await replaceSnapshot();
    await createRepository().init();
    await finishReloads();

    expect(repository!.data).toEqual(
      interruption === 'before removal' ? CLOUD : { folders: [], folderContents: {} },
    );
    expect(memory.values.local.has(KEY)).toBe(interruption === 'before removal');
    expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: CLOUD })).toBe(
      interruption === 'after removal',
    );
  },
);

it('keeps a parked page copy suppressed after the durable copy is cleared and another snapshot starts', async () => {
  const snapshotId = await download();
  await repository!.destroy();
  repository = undefined;
  expect(localStorage.getItem(PRIMARY)).toBeTruthy();

  expect(await undoCloudSyncSnapshot(snapshotId)).toMatchObject({ status: 'restored' });
  await finishReloads();
  expect(memory.values.local.has(PRIMARY)).toBe(false);
  expect(localStorage.getItem(PRIMARY)).toBeTruthy();
  await replaceSnapshot();
  await createRepository().init();
  await finishReloads();

  expect(repository!.data).toEqual({ folders: [], folderContents: {} });
  expect(memory.values.local.has(KEY)).toBe(false);
});

it('preserves a different newer backup as recoverable while removing only undone copies', async () => {
  const snapshotId = await download();
  const newer: FolderData = {
    ...CLOUD,
    folders: CLOUD.folders.map((folder) => ({ ...folder, name: 'Newer edit' })),
  };
  await repository!.session!.backup.createPrimaryBackup(newer);
  await repository!.session!.backup.finishPendingWrites();
  const primary = memory.values.local.get(PRIMARY);
  await repository!.destroy();
  repository = undefined;

  expect(await undoCloudSyncSnapshot(snapshotId)).toMatchObject({ status: 'restored' });
  await replaceSnapshot();
  expect(memory.values.local.get(PRIMARY)).toBe(primary);
  await createRepository().init();
  await finishReloads();

  expect(repository!.data).toEqual(newer);
  expect(memory.values.local.get(KEY)).toEqual(newer);
});

it('keeps suppression through cleanup failure and retries cleanup on a later capture', async () => {
  const snapshotId = await download();
  const primary = memory.values.local.get(PRIMARY);
  const remove = chrome.storage.local.remove.bind(chrome.storage.local);
  const failure = vi.spyOn(chrome.storage.local, 'remove').mockImplementation(async (keys) => {
    if ((Array.isArray(keys) ? keys : [keys]).some((key) => key === PRIMARY))
      throw new Error('Backup removal unavailable');
    return remove(keys);
  });
  expect(await undoCloudSyncSnapshot(snapshotId)).toMatchObject({ status: 'restored' });
  await finishReloads();
  await repository!.destroy();
  repository = undefined;
  await replaceSnapshot();
  expect(memory.values.local.get(PRIMARY)).toBe(primary);

  await createRepository().init();
  await finishReloads();
  expect(repository!.data).toEqual({ folders: [], folderContents: {} });
  expect(memory.values.local.has(KEY)).toBe(false);

  failure.mockRestore();
  await replaceSnapshot();
  expect(memory.values.local.has(PRIMARY)).toBe(false);
  await repository!.loadData();
  expect(repository!.data).toEqual({ folders: [], folderContents: {} });
  expect(memory.values.local.has(KEY)).toBe(false);
});

it('keeps a later intentional download of the same content recoverable from its new durable backup', async () => {
  const first = await download();
  expect(await undoCloudSyncSnapshot(first)).toMatchObject({ status: 'restored' });
  await finishReloads();
  await repository!.destroy();
  repository = undefined;

  await download();
  await repository!.destroy();
  repository = undefined;
  await replaceSnapshot();
  localStorage.clear();
  await chrome.storage.local.remove(KEY);
  await createRepository().init();
  await finishReloads();

  expect(repository!.data).toEqual(CLOUD);
  expect(memory.values.local.get(KEY)).toEqual(CLOUD);
});

it('recovers existing folders after undoing an identical download and replacing its snapshot', async () => {
  await download();
  await repository!.destroy();
  repository = undefined;
  const identical = await download();

  expect(await undoCloudSyncSnapshot(identical)).toMatchObject({
    status: 'restored',
    restoredKeys: 0,
  });
  await finishReloads();
  expect(memory.values.local.get(KEY)).toEqual(CLOUD);
  await repository!.destroy();
  repository = undefined;
  await replaceSnapshot();

  // A no-op download must leave the existing durable copy usable after canonical loss.
  localStorage.clear();
  await chrome.storage.local.remove(KEY);
  await createRepository().init();
  await finishReloads();

  expect(repository!.data).toEqual(CLOUD);
  expect(memory.values.local.get(KEY)).toEqual(CLOUD);
});

it('recovers a normalized legacy Gemini baseline after undo and snapshot replacement', async () => {
  const key = StorageKeys.FOLDER_DATA;
  const normalized: FolderData = {
    ...CLOUD,
    folders: CLOUD.folders.map((folder) => ({ ...folder, sortIndex: 0 })),
  };
  const config = { ...GEMINI_FOLDER_CONFIG, recoverMissingData: true };
  memory.values.local.set(key, CLOUD);
  await createRepository(config, new SafariFolderAdapter()).init();
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'folder-panel-download', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key }],
  });
  expect(
    await repository!.replaceData(normalized, undefined, (items) =>
      recordCloudSyncWrites(snapshot.id, [
        { area: 'local', key, kind: 'folders', value: items[key] },
      ]),
    ),
  ).toBe(true);
  await finishCloudSyncSnapshot(snapshot.id);
  await repository!.session!.backup.finishPendingWrites();
  await finishReloads();

  expect(await undoCloudSyncSnapshot(snapshot.id)).toMatchObject({
    status: 'restored',
    restoredKeys: 1,
  });
  await finishReloads();
  expect(memory.values.local.get(key)).toEqual(CLOUD);
  await repository!.destroy();
  repository = undefined;
  await replaceSnapshot();
  localStorage.clear();
  await chrome.storage.local.remove(key);
  await createRepository(config, new SafariFolderAdapter()).init();
  await finishReloads();

  expect(repository!.data).toEqual(normalized);
  expect(memory.values.local.get(key)).toEqual(normalized);
});
