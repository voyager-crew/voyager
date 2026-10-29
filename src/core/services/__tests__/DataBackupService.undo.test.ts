import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import {
  captureCloudSyncSnapshot,
  extendCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '../CloudSyncSnapshotService';
import { DataBackupService } from '../DataBackupService';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: (keys: string | string[]) => chrome.storage.local.get(keys),
        remove: (keys: string | string[]) => chrome.storage.local.remove(keys),
      },
    },
  },
}));
vi.mock('@/core/utils/browser', () => ({ isSafari: () => false }));

const KEY = StorageKeys.FOLDER_DATA;
const PRIMARY = 'gvBackup_undo-recovery_primary';
const EMERGENCY = 'gvBackup_undo-recovery_emergency';
const METADATA = 'gvBackup_undo-recovery_metadata';
const applied = { folders: ['From Drive'] };
const older = { folders: ['Older local data'] };
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;

function serialized(data: unknown, age = 0): string {
  return JSON.stringify({
    data,
    metadata: { timestamp: new Date(Date.now() - age).toISOString() },
  });
}

async function undoApplied() {
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'folder-panel-download', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key: KEY }],
  });
  await chrome.storage.local.set({ [KEY]: applied });
  await extendCloudSyncSnapshot(snapshot.id, [{ area: 'local', key: KEY }], {
    applied: [{ area: 'local', key: KEY, kind: 'folders', value: applied }],
  });
  expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
  expect(memory.values.local.has(KEY)).toBe(false);
}

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  localStorage.clear();
});
afterEach(() => {
  chrome.storage = originalStorage;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('backup recovery after cloud undo', () => {
  it('keeps an older durable copy beside a rejected newer page copy in the same slot', async () => {
    await undoApplied();
    const rejected = serialized(applied);
    const previous = serialized(older, 1000);
    const metadata = 'metadata is unrelated to folder content';
    localStorage.setItem(PRIMARY, rejected);
    localStorage.setItem(METADATA, metadata);
    memory.values.local.set(PRIMARY, previous);
    const service = new DataBackupService<typeof applied>('undo-recovery');
    await service.ensureHydrated();

    expect(await service.recoverFromBackupForKey(KEY)).toEqual(older);
    expect(localStorage.getItem(PRIMARY)).toBeNull();
    expect(memory.values.local.get(PRIMARY)).toBe(previous);
    expect(localStorage.getItem(METADATA)).toBe(metadata);
  });

  it('retains original slot priority when different older content remains recoverable', async () => {
    await undoApplied();
    const previous = serialized(older, 2000);
    const emergency = serialized({ folders: ['Newer emergency'] }, 1000);
    const rejected = serialized(applied);
    localStorage.setItem(PRIMARY, previous);
    localStorage.setItem(EMERGENCY, emergency);
    memory.values.local.set(PRIMARY, rejected);
    const service = new DataBackupService<typeof applied>('undo-recovery');
    await service.ensureHydrated();

    expect(await service.recoverFromBackupForKey(KEY)).toEqual(older);
    expect(localStorage.getItem(PRIMARY)).toBe(previous);
    expect(localStorage.getItem(EMERGENCY)).toBe(emergency);
    expect(memory.values.local.get(PRIMARY)).toBe(rejected);
  });

  it('preserves different page and durable copies written while cleanup waits for authorization', async () => {
    await undoApplied();
    const rejected = serialized(applied);
    localStorage.setItem(PRIMARY, rejected);
    memory.values.local.set(PRIMARY, rejected);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const service = new DataBackupService<typeof applied>(
      'undo-recovery',
      () => true,
      () => true,
      async (operation) => {
        entered.resolve();
        await release.promise;
        return operation();
      },
    );
    await service.ensureHydrated();
    const recovering = service.recoverFromBackupForKey(KEY);
    await entered.promise;
    const previous = serialized(older, 1000);
    localStorage.setItem(PRIMARY, previous);
    await chrome.storage.local.set({ [PRIMARY]: previous });
    release.resolve();

    expect(await recovering).toEqual(older);
    expect(localStorage.getItem(PRIMARY)).toBe(previous);
    expect(memory.values.local.get(PRIMARY)).toBe(previous);
  });

  it('preserves a newer durable backup written after cleanup reads an undone copy', async () => {
    await undoApplied();
    memory.values.local.set(PRIMARY, serialized(applied));
    const service = new DataBackupService<typeof applied>('undo-recovery');
    await service.ensureHydrated();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const get = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys) => {
      const stored = await get(keys);
      if (Array.isArray(keys) && keys.includes(PRIMARY)) {
        entered.resolve();
        await release.promise;
      }
      return stored;
    });
    const recovering = service.recoverFromBackupForKey(KEY);
    await Promise.race([entered.promise, recovering]);
    const newer = { folders: ['New backup from another tab'] };
    const nextCopy = serialized(newer);
    await chrome.storage.local.set({ [PRIMARY]: nextCopy });
    release.resolve();

    expect(await recovering).toEqual(newer);
    expect(memory.values.local.get(PRIMARY)).toBe(nextCopy);
    const reader = new DataBackupService<typeof applied>('undo-recovery');
    await reader.ensureHydrated();
    expect(await reader.recoverFromBackupForKey(KEY)).toEqual(newer);
  });

  it('keeps cleanup behind the owner fence even though matching content cannot recover', async () => {
    await undoApplied();
    const rejected = serialized(applied);
    localStorage.setItem(PRIMARY, rejected);
    memory.values.local.set(PRIMARY, rejected);
    let allowed = true;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const service = new DataBackupService<typeof applied>(
      'undo-recovery',
      () => true,
      () => allowed,
      async (operation) => {
        entered.resolve();
        await release.promise;
        return operation();
      },
    );
    await service.ensureHydrated();
    const recovering = service.recoverFromBackupForKey(KEY);
    await entered.promise;
    allowed = false;
    release.resolve();

    expect(await recovering).toBeNull();
    expect(localStorage.getItem(PRIMARY)).toBe(rejected);
    expect(memory.values.local.get(PRIMARY)).toBe(rejected);
  });

  it('does not recover a retained matching durable copy across repeated hydration', async () => {
    await undoApplied();
    const rejected = serialized(applied);
    memory.values.local.set(PRIMARY, rejected);
    const service = new DataBackupService<typeof applied>('undo-recovery');
    await service.ensureHydrated();
    expect(await service.recoverFromBackupForKey(KEY)).toBeNull();
    expect(memory.values.local.get(PRIMARY)).toBe(rejected);

    await service.ensureHydrated();
    expect(await service.recoverFromBackupForKey(KEY)).toBeNull();
    expect(memory.values.local.get(PRIMARY)).toBe(rejected);
    expect(memory.values.local.has(KEY)).toBe(false);
  });
});
