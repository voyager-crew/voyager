import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { CloudSyncSnapshotService } from '../CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '../CloudSyncUndoMarkers';
import { parseCloudSyncSnapshotSlot } from '../cloudSyncSnapshotTypes';

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: async () => undefined } },
}));

const CONTEXT = { source: 'popup-restore', platform: 'gemini', accountScope: null } as const;
const KEY = StorageKeys.FOLDER_DATA;
const BASELINE = {
  folders: [
    { id: 'f', name: 'Existing', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: { f: [] },
};
const NORMALIZED = {
  ...BASELINE,
  folders: BASELINE.folders.map((folder) => ({ ...folder, sortIndex: 0 })),
};
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let service: CloudSyncSnapshotService;

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  service = new CloudSyncSnapshotService(() => memory.api);
  memory.values.local.set(KEY, BASELINE);
});

afterEach(() => {
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

it('restores and counts a normalization-only key after undo resumes without suppressing its baseline', async () => {
  memory.values.sync.set('enabled', false);
  const snapshot = await service.capture({
    context: CONTEXT,
    keys: [
      { area: 'local', key: KEY },
      { area: 'sync', key: 'enabled' },
    ],
  });
  await service.extend(snapshot.id, [], {
    applied: [
      { area: 'local', key: KEY, kind: 'folders', value: NORMALIZED },
      { area: 'sync', key: 'enabled', kind: 'settings', value: true },
    ],
  });
  await memory.api.local.set({ [KEY]: NORMALIZED });
  await memory.api.sync.set({ enabled: true });
  const failure = vi.spyOn(memory.api.sync, 'set').mockRejectedValue(new Error('Sync unavailable'));

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
  expect(memory.values.local.get(KEY)).toEqual(BASELINE);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: NORMALIZED })).toBe(false);
  failure.mockRestore();
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 2 });
  expect(memory.values.local.get(KEY)).toEqual(BASELINE);
  expect(memory.values.sync.get('enabled')).toBe(false);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: NORMALIZED })).toBe(false);
});

it('does not reinsert a normalized baseline hash when undo replaces the last of several receipts', async () => {
  const different = {
    ...NORMALIZED,
    folders: NORMALIZED.folders.map((folder) => ({ ...folder, name: 'Actually downloaded' })),
  };
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  for (const value of [different, NORMALIZED]) {
    await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
      applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
    });
    await memory.api.local.set({ [KEY]: value });
  }

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(memory.values.local.get(KEY)).toEqual(BASELINE);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: NORMALIZED })).toBe(false);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: different })).toBe(true);
});

it('rejects restore progress for a key outside the captured snapshot', async () => {
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  memory.values.local.set(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT, {
    ...snapshot,
    kind: 'undoing',
    markers: [],
    restoreKeys: [{ area: 'local', key: 'uncaptured' }],
  });

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
  expect(memory.values.local.get(KEY)).toEqual(BASELINE);
});

it('retains restored-key counts when resuming a legacy interrupted slot without restoreKeys', async () => {
  const different = {
    ...NORMALIZED,
    folders: NORMALIZED.folders.map((folder) => ({ ...folder, name: 'Downloaded' })),
  };
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value: different }],
  });
  await memory.api.local.set({ [KEY]: different });
  const set = memory.api.local.set.bind(memory.api.local);
  const failure = vi
    .spyOn(memory.api.local, 'set')
    .mockImplementation(async (items: Record<string, unknown>) => {
      if (
        parseCloudSyncSnapshotSlot(items[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT])?.kind ===
        'undone'
      )
        throw new Error('Final progress persistence unavailable');
      await set(items);
    });
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
  failure.mockRestore();
  const current = parseCloudSyncSnapshotSlot(
    memory.values.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT),
  );
  if (!current || current.kind !== 'undoing') throw new Error('Expected interrupted undo');
  const { restoreKeys: _restoreKeys, ...legacy } = current;
  memory.values.local.set(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT, legacy);

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(memory.values.local.get(KEY)).toEqual(BASELINE);
});

it('protects an unchanged timeline projection without exempting a changed sibling with the same content', async () => {
  const key = StorageKeys.TIMELINE_HIERARCHY;
  const first = { levels: { turn: 1 }, collapsed: [] };
  const second = { levels: { turn: 2 }, collapsed: [] };
  const baseline = { conversations: { first, second } };
  const downloaded = { conversations: { first, second: first } };
  memory.values.local.set(key, baseline);
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key }] });
  await service.extend(snapshot.id, [{ area: 'local', key }], {
    applied: [{ area: 'local', key, kind: 'hierarchy', value: downloaded }],
  });
  await memory.api.local.set({ [key]: downloaded });

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(
    await isUndoneCloudSyncValue({
      area: 'local',
      key,
      projection: 'timeline:first',
      value: first,
    }),
  ).toBe(false);
  expect(
    await isUndoneCloudSyncValue({
      area: 'local',
      key,
      projection: 'timeline:second',
      value: first,
    }),
  ).toBe(true);
  expect(memory.values.local.get(key)).toEqual(baseline);
});
