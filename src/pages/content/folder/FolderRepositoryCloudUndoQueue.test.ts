import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
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
    folderContents: { f: [] },
  };
}

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repositories: Set<FolderRepository>;
let reloads: Promise<void>[];

function createRepository(
  adapter: IFolderStorageAdapter,
  onAvailability?: (canEdit: boolean) => void,
): FolderRepository {
  const repository = new FolderRepository(GEMINI_FOLDER_CONFIG, adapter, {
    onChange: (reason) => {
      if (reason === 'availability') onAvailability?.(repository.canEdit);
    },
    onRecovery: () => {},
    onAccountReleased: () => {},
    isEnabled: () => true,
    onExternalChange: () => reloads.push(repository.loadData()),
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
  const snapshot = await captureCloudSyncSnapshot({
    context: {
      source: 'folder-panel-download',
      platform: 'gemini',
      accountScope: repository.accountScope,
    },
    keys: [{ area: 'local', key: repository.storageKey }],
  });
  expect(
    await repository.replaceData(folder('From Drive'), undefined, (items) =>
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
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  localStorage.clear();
});

describe.each([
  { name: 'localStorage', create: () => new LocalStorageFolderAdapter() },
  { name: 'Safari', create: () => new SafariFolderAdapter() },
])('queued cloud undo through $name folders', ({ name, create }) => {
  it('checks canonical only after the active and queued user saves have drained', async () => {
    memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, folder('Before download'));
    const admitted = deferred();
    let watchingUndo = false;
    const repository = createRepository(create(), (canEdit) => {
      if (watchingUndo && !canEdit) admitted.resolve();
    });
    await repository.init();
    await download(repository);
    const started = deferred();
    const release = deferred();
    const set = memory.api.local.set.bind(memory.api.local) as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    let held = false;
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      if (!held && repository.storageKey in items) {
        held = true;
        started.resolve();
        await release.promise;
      }
      await set(items);
    });
    repository.data = folder('Active user edit');
    const active = repository.saveData();
    await started.promise;
    repository.data = folder('Queued user edit');
    const queued = repository.saveData();
    watchingUndo = true;
    const undoing = undoCloudSyncSnapshot();
    const first = await Promise.race([
      admitted.promise.then(() => 'admitted'),
      undoing.then(() => 'completed'),
    ]);
    release.resolve();
    expect(await active).toBe(true);
    expect(await queued).toBe(true);

    expect(await undoing).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'folders', reason: 'changed-since-download' }],
    });
    expect(first).toBe('admitted');
    await settleReloads();
    expect(memory.values.local.get(repository.storageKey)).toEqual(folder('Queued user edit'));
    expect(repository.data).toEqual(folder('Queued user edit'));
  });

  it('waits for a first undo that is still checking authority before returning absent', async () => {
    memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, folder('Before download'));
    let watchingUndo = false;
    let admitted = false;
    const repository = createRepository(create(), (canEdit) => {
      if (watchingUndo && !canEdit) admitted = true;
    });
    await repository.init();
    await download(repository);
    const waiting = deferred();
    const release = deferred();
    const get = memory.api.local.get.bind(memory.api.local) as (
      keys: unknown,
    ) => Promise<Record<string, unknown>>;
    let held = false;
    vi.spyOn(memory.api.local, 'get').mockImplementation(async (keys: unknown) => {
      const captured = await get(keys);
      if (admitted && !held && keys === AUTHORITY_FENCE_KEY) {
        held = true;
        waiting.resolve();
        await release.promise;
      }
      return captured;
    });
    watchingUndo = true;
    const first = undoCloudSyncSnapshot();
    await waiting.promise;
    const second = undoCloudSyncSnapshot();
    // The storage response arrives next task, after both undo requests have been admitted.
    window.setTimeout(release.resolve, 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(await first).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(await second).toEqual({ status: 'absent' });
    expect(memory.values.local.get(repository.storageKey)).toEqual(folder('Before download'));
  });

  it('leaves canonical untouched when the owner fence arrives while undo persists its slot', async () => {
    memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, folder('Before download'));
    const repository = createRepository(create());
    await repository.init();
    await download(repository);
    const waiting = deferred();
    const release = deferred();
    const set = memory.api.local.set.bind(memory.api.local) as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      const slot = items[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT];
      if (typeof slot === 'object' && slot !== null && 'kind' in slot && slot.kind === 'undoing') {
        waiting.resolve();
        await release.promise;
      }
      await set(items);
    });
    const undoing = undoCloudSyncSnapshot();
    await waiting.promise;
    memory.external('local', AUTHORITY_FENCE_KEY, {
      build: 'q8-owner-event',
      sites: { gemini: 'owner' },
    });
    await settle();
    release.resolve();

    expect(await undoing).toMatchObject({ status: 'failed' });
    expect(memory.values.local.get(repository.storageKey)).toEqual(folder('From Drive'));
    expect(repository.canEdit).toBe(false);
  });

  it('releases the owner on destroy so undo can restore the exact original stored value', async () => {
    const before = folder('Before download');
    const stored = name === 'Safari' ? JSON.stringify(before) : before;
    memory.values.local.set(GEMINI_FOLDER_CONFIG.storageKey, stored);
    const repository = createRepository(create());
    await repository.init();
    await download(repository);
    const key = repository.storageKey;
    await repository.destroy();
    repositories.delete(repository);

    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(memory.values.local.get(key)).toEqual(stored);
  });
});
