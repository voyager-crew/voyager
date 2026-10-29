import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createMemoryStorage, type MemoryStorage } from '@/tests/memoryStorage';

import { applyCloudRestore, CloudRestoreError } from '../CloudSyncApplyService';
import { applyPopupCloudDownload, applyPopupCatalogDownload } from '../CloudSyncDownloadService';
import { cloudSyncFailureCode } from '../CloudSyncFailure';
import { captureCloudSyncSnapshot, readCloudSyncSnapshot } from '../CloudSyncSnapshotService';

const context = { source: 'popup-restore', platform: 'gemini', accountScope: null } as const;
const catalogKey = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
let memory: MemoryStorage;
let previous: typeof chrome.storage;

beforeEach(() => {
  previous = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
});
afterEach(() => {
  chrome.storage = previous;
  vi.restoreAllMocks();
});

it.each(['forks', 'outlines'] as const)(
  'keeps applied highlights and their undo target when %s planning cannot read local data',
  async (part) => {
    const started = await applyCloudRestore({
      mode: 'merge',
      highlightsRestored: false,
      snapshot: context,
      storageUpdate: { highlight: { note: 'from cloud' } },
      storageParts: ['highlights'],
    });
    const failure = new Error('storage unavailable during planning');
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      if (keys === StorageKeys.FORK_NODES || (Array.isArray(keys) && keys.includes(catalogKey)))
        throw failure;
      return originalGet<Record<string, unknown>>(
        typeof keys === 'string'
          ? keys
          : Array.isArray(keys)
            ? keys.filter((key): key is string => typeof key === 'string')
            : null,
      );
    });
    let thrown: unknown;
    try {
      await applyPopupCloudDownload({
        context: {
          payload: { platform: 'gemini', accountScope: null },
          timelineHierarchyStorageKey: StorageKeys.TIMELINE_HIERARCHY,
        },
        local: {
          folders: { folders: [], folderContents: {} },
          timelineHierarchy: { conversations: {} },
          folderStorageKey: StorageKeys.FOLDER_DATA,
          accountChanged: false,
        },
        data: {
          snapshotId: started.snapshotId,
          ...(part === 'forks'
            ? { forks: { format: 'gemini-voyager.forks.v1', data: { groups: {}, nodes: {} } } }
            : {}),
        },
        mode: 'overwrite',
        highlightsRestored: true,
        catalog: {
          status: 'pulled',
          value:
            part === 'outlines'
              ? { outlines: { [catalogKey]: { conversations: {} } }, stars: {} }
              : null,
        },
        send: async () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CloudRestoreError);
    expect(thrown).toMatchObject({
      restored: ['highlights'],
      failed: [part],
      cause: failure,
      snapshotId: started.snapshotId,
    });
    expect(memory.values.local.get('highlight')).toEqual({ note: 'from cloud' });
    expect((await readCloudSyncSnapshot())?.id).toBe(started.snapshotId);
  },
);

it('returns the undo target from a catalog-only apply', async () => {
  const result = await applyPopupCatalogDownload({
    snapshot: context,
    catalog: { outlines: { [catalogKey]: { conversations: {} } }, stars: {} },
    send: async () => undefined,
  });
  expect(result).toEqual({ restored: true, snapshotId: expect.any(String) });
});

it('codes a snapshot capture failure while retaining its diagnostic and first cause', async () => {
  const failure = new Error('snapshot storage quota exceeded');
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(failure);
  const result = await applyCloudRestore({
    mode: 'merge',
    highlightsRestored: false,
    snapshot: context,
    storageUpdate: { example: 'new' },
  }).catch((error: unknown) => error);
  expect(cloudSyncFailureCode(result)).toBe('snapshot_failed');
  expect(result).toMatchObject({ message: failure.message, cause: { cause: failure } });
  expect(memory.values.local.has('example')).toBe(false);
});

it('codes cancellation without changing its existing message', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await applyCloudRestore({
    mode: 'merge',
    highlightsRestored: false,
    snapshot: context,
    storageUpdate: { example: 'new' },
    signal: controller.signal,
  }).catch((error: unknown) => error);
  expect(cloudSyncFailureCode(result)).toBe('download_cancelled');
  expect(result).toMatchObject({ message: 'Download cancelled' });
});

it('preserves the superseded reason when extending a replaced background snapshot', async () => {
  const first = await captureCloudSyncSnapshot({ context, keys: [] });
  const latest = await captureCloudSyncSnapshot({ context, keys: [] });
  const result = await applyCloudRestore({
    mode: 'merge',
    highlightsRestored: false,
    snapshot: context,
    snapshotId: first.id,
    storageUpdate: { example: 'new' },
  }).catch((error: unknown) => error);
  expect(cloudSyncFailureCode(result)).toBe('snapshot_superseded');
  expect((await readCloudSyncSnapshot())?.id).toBe(latest.id);
  expect(memory.values.local.has('example')).toBe(false);
});

it('keeps background highlights partial when catalog-only planning fails', async () => {
  const started = await applyCloudRestore({
    mode: 'merge',
    highlightsRestored: false,
    snapshot: context,
    storageUpdate: { highlight: 'applied' },
    storageParts: ['highlights'],
  });
  const failure = new Error('cannot read catalog');
  vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(failure);
  await expect(
    applyPopupCatalogDownload({
      snapshot: context,
      snapshotId: started.snapshotId,
      highlightsRestored: true,
      catalog: { outlines: { [catalogKey]: { conversations: {} } }, stars: {} },
      send: async () => undefined,
    }),
  ).rejects.toMatchObject({
    restored: ['highlights'],
    failed: ['outlines'],
    snapshotId: started.snapshotId,
    cause: failure,
  });
});
