import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { CloudSyncSnapshotService } from '../CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '../CloudSyncUndoMarkers';

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: async () => undefined } },
}));

const CONTEXT = { source: 'popup-restore', platform: 'aistudio', accountScope: null } as const;
const KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let service: CloudSyncSnapshotService;

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  service = new CloudSyncSnapshotService(() => memory.api);
});
afterEach(() => {
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

async function downloadAndUndo(value: unknown) {
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
  });
  await memory.api.local.set({ [KEY]: value });
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
}

it('keeps both undone values suppressed across repeated downloads and a no-op slot finish', async () => {
  const first = { folders: ['First undone download'] };
  const second = { folders: ['Second undone download'] };
  await downloadAndUndo(first);
  await downloadAndUndo(second);
  const next = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: 'other' }] });
  await service.finish(next.id);
  service = new CloudSyncSnapshotService(() => memory.api);

  expect(await service.read()).toBeNull();
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: first })).toBe(true);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: second })).toBe(true);
  expect(
    await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: { folders: ['Later edit'] } }),
  ).toBe(false);
  expect(memory.values.local.has(KEY)).toBe(false);
});

it('carries suppression published by another context while the new capture reads its targets', async () => {
  const value = { folders: ['Downloaded'] };
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
  });
  await memory.api.local.set({ [KEY]: value });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const get = memory.api.local.get.bind(memory.api.local);
  vi.spyOn(memory.api.local, 'get').mockImplementation(async (keys) => {
    const result = await get(keys);
    if (Array.isArray(keys) && keys.includes('other')) {
      entered.resolve();
      await release.promise;
    }
    return result;
  });
  const other = new CloudSyncSnapshotService(() => memory.api);
  const capturing = other.capture({ context: CONTEXT, keys: [{ area: 'local', key: 'other' }] });
  await entered.promise;
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored' });
  release.resolve();
  await capturing;

  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value })).toBe(true);
  expect(memory.values.local.has(KEY)).toBe(false);
});

it('quarantines an unreadable old slot and allows the next download to capture fresh data', async () => {
  const corrupt = { kind: 'undone', markers: [], retainedMarkers: [{ key: KEY }] };
  memory.values.local.set(SLOT, corrupt);
  memory.values.local.set(KEY, { folders: ['Keep'] });

  expect(await service.undo()).toMatchObject({ status: 'failed', error: 'Invalid cloud snapshot' });
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });

  expect(snapshot.entries).toEqual([
    { area: 'local', key: KEY, existed: true, value: { folders: ['Keep'] } },
  ]);
  expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE)).toEqual(corrupt);
  expect(memory.values.local.get(SLOT)).toEqual(snapshot);
  expect(memory.values.local.get(KEY)).toEqual({ folders: ['Keep'] });
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: {} })).toBe(false);
  await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value: { folders: ['Next download'] } }],
  });
  await memory.api.local.set({ [KEY]: { folders: ['Next download'] } });
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(memory.values.local.get(KEY)).toEqual({ folders: ['Keep'] });
  expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE)).toEqual(corrupt);

  const latestCorrupt = { unrecognized: 'newest old slot', raw: [1, 2, 3] };
  memory.values.local.set(SLOT, latestCorrupt);
  await service.capture({ context: CONTEXT, keys: [] });
  expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE)).toEqual(
    latestCorrupt,
  );
  expect(
    [...memory.values.local.keys()].filter((key) =>
      key.startsWith('gvCloudSyncSnapshotQuarantine'),
    ),
  ).toHaveLength(1);
});

it('preserves the unreadable slot, prior quarantine and canonical data when quarantine persistence fails', async () => {
  const corrupt = { unreadable: ['raw old snapshot'] };
  const quarantined = { previous: ['Keep this quarantine if replacement fails'] };
  const canonical = { folders: ['Keep canonical data'] };
  memory.values.local.set(SLOT, corrupt);
  memory.values.local.set(StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE, quarantined);
  memory.values.local.set(KEY, canonical);
  const failure = new Error('Quarantine unavailable');
  const set = memory.api.local.set.bind(memory.api.local);
  vi.spyOn(memory.api.local, 'set').mockImplementation(async (items) => {
    if (StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE in items) throw failure;
    await set(items);
  });

  await expect(
    service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] }),
  ).rejects.toBe(failure);
  expect(memory.values.local.get(SLOT)).toEqual(corrupt);
  expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE)).toEqual(quarantined);
  expect(memory.values.local.get(KEY)).toEqual(canonical);
});

it('retains completed suppression without carrying an interrupted undo into a different download', async () => {
  const completed = { folders: ['Earlier completed undo'] };
  await downloadAndUndo(completed);
  const applied = { folders: ['Still canonical during interrupted undo'] };
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value: applied }],
  });
  await memory.api.local.set({ [KEY]: applied });
  const remove = vi
    .spyOn(memory.api.local, 'remove')
    .mockRejectedValue(new Error('Undo interrupted'));
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
  remove.mockRestore();
  // Open recovery readers still need the current progress until another download replaces the slot.
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: applied })).toBe(true);

  await service.capture({ context: CONTEXT, keys: [] });
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: applied })).toBe(false);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: completed })).toBe(true);
  expect(memory.values.local.get(KEY)).toEqual(applied);
});

it('retains only already removed keys when a new capture replaces a partially completed Undo', async () => {
  const otherKey = StorageKeys.FOLDER_DATA;
  const value = { folders: ['Downloaded'] };
  const keys = [KEY, otherKey].map((key) => ({ area: 'local' as const, key }));
  const snapshot = await service.capture({ context: CONTEXT, keys });
  await service.extend(snapshot.id, keys, {
    applied: keys.map((target) => ({ ...target, kind: 'folders', value })),
  });
  await memory.api.local.set({ [KEY]: value, [otherKey]: value });
  const remove = memory.api.local.remove.bind(memory.api.local);
  const failure = vi
    .spyOn(memory.api.local, 'remove')
    .mockImplementation(async (keys: string | string[]) => {
      if ((Array.isArray(keys) ? keys : [keys]).includes(otherKey))
        throw new Error('Second removal failed');
      await remove(keys);
    });
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
  failure.mockRestore();
  expect(memory.values.local.has(KEY)).toBe(false);
  expect(memory.values.local.get(otherKey)).toEqual(value);

  await service.capture({ context: CONTEXT, keys: [] });

  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value })).toBe(true);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: otherKey, value })).toBe(false);
});

it.each(['canonical removal', 'another completed Undo'])(
  'rechecks capture suppression after a digest outlives %s',
  async (change) => {
    const value = { folders: ['Downloaded'] };
    const snapshot = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: KEY }],
    });
    await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
      applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
    });
    await memory.api.local.set({ [KEY]: value });
    const remove = vi
      .spyOn(memory.api.local, 'remove')
      .mockRejectedValue(new Error('Undo interrupted'));
    expect(await service.undo(snapshot.id)).toMatchObject({ status: 'failed' });
    remove.mockRestore();

    const otherKey = StorageKeys.FOLDER_DATA;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
      const result = await digest(...args);
      if (change === 'canonical removal') await memory.api.local.remove(KEY);
      else {
        const other = new CloudSyncSnapshotService(() => memory.api);
        const next = await other.capture({
          context: CONTEXT,
          keys: [{ area: 'local', key: otherKey }],
        });
        await other.extend(next.id, [{ area: 'local', key: otherKey }], {
          applied: [{ area: 'local', key: otherKey, kind: 'folders', value }],
        });
        await memory.api.local.set({ [otherKey]: value });
        expect(await other.undo(next.id)).toMatchObject({ status: 'restored' });
      }
      return result;
    });

    await service.capture({ context: CONTEXT, keys: [] });

    const removedKey = change === 'canonical removal' ? KEY : otherKey;
    expect(memory.values.local.has(removedKey)).toBe(false);
    expect(await isUndoneCloudSyncValue({ area: 'local', key: removedKey, value })).toBe(true);
    if (change === 'another completed Undo') {
      expect(memory.values.local.get(KEY)).toEqual(value);
      expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value })).toBe(false);
    }
  },
);

it('never suppresses the original value when a download receipts it alongside a different value', async () => {
  const original = { folders: ['Original local data'] };
  const different = { folders: ['Intermediate downloaded value'] };
  memory.values.local.set(KEY, original);
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  for (const value of [different, original]) {
    await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
      applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
    });
    await memory.api.local.set({ [KEY]: value });
  }

  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 0 });
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: original })).toBe(false);
  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value: different })).toBe(true);
  expect(memory.values.local.get(KEY)).toEqual(original);
});

it('a prepared but failed identical download cannot retire earlier backup suppression', async () => {
  const value = { folders: ['Undone download'] };
  await downloadAndUndo(value);
  const next = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  await service.extend(next.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value }],
  });
  // The owner failed before its physical write: a receipt cannot acknowledge a missing canonical key.
  await service.finish(next.id);
  await service.capture({ context: CONTEXT, keys: [] });

  expect(await isUndoneCloudSyncValue({ area: 'local', key: KEY, value })).toBe(true);
  expect(memory.values.local.has(KEY)).toBe(false);
});
