import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { hashCloudSyncContent } from '@/core/services/cloudSyncSnapshotHash';
import { StorageKeys } from '@/core/types/common';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import {
  CLEAN_UNDONE_COPIES_MESSAGE,
  requestBudgetCopy,
  requestUndoneBackupCleanup,
} from '@/features/storage/budgetCopyMessage';
import { createStorageBudget } from '@/features/storage/storageBudget';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { startBudgetCopies } from '../budgetCopies';

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

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const PRIMARY = 'gvBackup_aistudio-folders_primary';
const EMERGENCY = 'gvBackup_aistudio-folders_emergency';
const CLOUD = { folders: ['Undone download'], folderContents: {} };
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let listener: Listener;

const serialized = (data: unknown) =>
  JSON.stringify({
    data,
    metadata: { timestamp: new Date().toISOString() },
  });

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  const budget = createStorageBudget({
    measure: async () => ({
      bytesInUse: 0,
      keyBytes: 0,
      limitBytes: 25 * 1024 * 1024,
      quotaBytes: null,
    }),
    quota: async () => null,
    barrier: async () => undefined,
  });
  vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((next) => {
    listener = next;
  });
  startBudgetCopies({ budget, write: (items) => chrome.storage.local.set(items) });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    (async (message: unknown) =>
      new Promise((resolve) => {
        listener(message, { id: chrome.runtime.id }, resolve);
      })) as typeof chrome.runtime.sendMessage,
  );
});

afterEach(() => {
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

async function markUndone(value: unknown = CLOUD, key: string = StorageKeys.FOLDER_DATA_AISTUDIO) {
  memory.values.local.set(SLOT, {
    kind: 'undone',
    markers: [
      {
        area: 'local',
        key,
        replacedHash: await hashCloudSyncContent(value),
        projections: [],
      },
    ],
  });
}

it('cleans matching copies without deleting other content, accounts or metadata', async () => {
  await markUndone();
  const earlier = serialized({ folders: ['Local edit'], folderContents: {} });
  const otherAccount = 'gvBackup_aistudio-folders:acct:abc123_primary';
  const metadata = 'gvBackup_aistudio-folders_metadata';
  await chrome.storage.local.set({
    [PRIMARY]: serialized(CLOUD),
    [EMERGENCY]: earlier,
    [otherAccount]: serialized(CLOUD),
    [metadata]: 'Keep metadata',
  });

  expect(await requestUndoneBackupCleanup()).toBe(true);
  expect(memory.values.local.has(PRIMARY)).toBe(false);
  expect(memory.values.local.get(EMERGENCY)).toBe(earlier);
  expect(memory.values.local.has(otherAccount)).toBe(true);
  expect(memory.values.local.get(metadata)).toBe('Keep metadata');
});

it('never deletes a newer durable copy that replaced the observed value while hashing', async () => {
  await markUndone();
  await chrome.storage.local.set({ [PRIMARY]: serialized(CLOUD) });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return digest(...args);
  });
  const cleanup = requestUndoneBackupCleanup();
  await entered.promise;
  const newer = serialized({ folders: ['Newer backup'], folderContents: {} });
  await chrome.storage.local.set({ [PRIMARY]: newer });
  release.resolve();

  expect(await cleanup).toBe(true);
  expect(memory.values.local.get(PRIMARY)).toBe(newer);
});

it('rejects a late matching backup while allowing a different newer value in the same owner queue', async () => {
  await markUndone();
  expect(await requestUndoneBackupCleanup()).toBe(true);
  expect(await requestBudgetCopy(PRIMARY, serialized(CLOUD))).toBe(false);
  expect(memory.values.local.has(PRIMARY)).toBe(false);
  const newer = serialized({ folders: ['Newer backup'], folderContents: {} });
  expect(await requestBudgetCopy(PRIMARY, newer)).toBe(true);
  expect(memory.values.local.get(PRIMARY)).toBe(newer);
});

it('preserves and admits a copy equal to canonical data even when an old marker suppresses it', async () => {
  await markUndone();
  const value = serialized(CLOUD);
  await chrome.storage.local.set({
    [StorageKeys.FOLDER_DATA_AISTUDIO]: CLOUD,
    [PRIMARY]: value,
  });

  expect(await requestUndoneBackupCleanup()).toBe(true);
  expect(memory.values.local.get(PRIMARY)).toBe(value);
  expect(await requestBudgetCopy(EMERGENCY, value)).toBe(true);
  expect(memory.values.local.get(EMERGENCY)).toBe(value);
});

it.each(['normalized', 'loaded'] as const)(
  'preserves and admits the %s owner form of legacy canonical data despite an old marker',
  async (form) => {
    const key = StorageKeys.FOLDER_DATA;
    const primary = 'gvBackup_gemini-folders_primary';
    const emergency = 'gvBackup_gemini-folders_emergency';
    const legacy = {
      folders: [
        { id: 'f', name: 'Existing', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
      ],
      folderContents: { f: [], orphan: [] },
    };
    const copy = {
      folders: legacy.folders.map((folder) => ({ ...folder, sortIndex: 0 })),
      folderContents: form === 'loaded' ? { f: [] } : legacy.folderContents,
    };
    await markUndone(copy, key);
    const value = serialized(copy);
    await chrome.storage.local.set({ [key]: legacy, [primary]: value });

    expect(await requestUndoneBackupCleanup()).toBe(true);
    expect(memory.values.local.get(primary)).toBe(value);
    expect(await requestBudgetCopy(emergency, value)).toBe(true);
    expect(memory.values.local.get(emergency)).toBe(value);
  },
);

it('leaves owner recovery data untouched after authority changes', async () => {
  await markUndone();
  const value = serialized(CLOUD);
  await chrome.storage.local.set({
    [PRIMARY]: value,
    [AUTHORITY_FENCE_KEY]: { sites: { aistudio: 'owner' } },
  });

  expect(await requestUndoneBackupCleanup()).toBe(false);
  expect(memory.values.local.get(PRIMARY)).toBe(value);
});

it('does not let another extension request backup deletion', async () => {
  await markUndone();
  const value = serialized(CLOUD);
  await chrome.storage.local.set({ [PRIMARY]: value });
  const result = await new Promise((resolve) => {
    listener({ type: CLEAN_UNDONE_COPIES_MESSAGE }, { id: 'other-extension' }, resolve);
  });
  expect(result).toEqual({ status: 'failed' });
  expect(memory.values.local.get(PRIMARY)).toBe(value);
});
