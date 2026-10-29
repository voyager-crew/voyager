import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { parseCloudSyncSnapshot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';

import { syncSiteFolders, uploadSiteFolders, type CloudSyncSite } from '../cloudSyncClient';
import { LocalStorageFolderAdapter } from '../storage/FolderStorageAdapter';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage },
    get storage() {
      return chrome.storage;
    },
  },
}));

const FOLDER_KEY = buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'email:test');
const empty = (): FolderData => ({ folders: [], folderContents: {} });
const cloud: FolderData = {
  folders: [
    { id: 'one', name: 'Cloud', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: { one: [] },
};
let disk: Record<string, unknown>;
let failFolders: boolean;

function site(): CloudSyncSite {
  return {
    platform: 'gemini',
    t: (key) => key,
    notify: () => {},
    begin: () => ({
      current: () => true,
      folders: empty(),
      folderStorageKey: FOLDER_KEY,
      data: empty,
      save: (folders, _prompts, beforeWrite) =>
        new LocalStorageFolderAdapter().saveData(FOLDER_KEY, folders, undefined, beforeWrite),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  failFolders = false;
  disk = { [StorageKeys.PROMPT_ITEMS]: [{ id: 'local', text: 'Local', tags: [], createdAt: 1 }] };
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    return Object.fromEntries(
      names
        .filter((key) => Object.hasOwn(disk, key))
        .map((key) => [key, structuredClone(disk[key])]),
    );
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items: Record<string, unknown>) => {
    if (failFolders && FOLDER_KEY in items) throw new Error('write failed');
    Object.assign(disk, structuredClone(items));
  });
  sendMessage.mockImplementation(async (message) => {
    if (message.type === 'gv.sync.download')
      return {
        ok: true,
        operationId: 'download-one',
        catalog: null,
        data: { folders: { data: cloud }, prompts: { items: [] } },
      };
    return { ok: true };
  });
});

describe('folder scope and successful apply acknowledgment', () => {
  it.each(['upload', 'download'] as const)(
    'skips an excluded site before %s contacts the background',
    async (direction) => {
      disk[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: true, sites: { gemini: false } };
      const before = structuredClone(disk);
      await (direction === 'upload' ? uploadSiteFolders(site()) : syncSiteFolders(site()));
      expect(sendMessage).not.toHaveBeenCalled();
      expect(disk).toEqual(before);
    },
  );

  it('sends one site upload with no shared data or separate catalog push', async () => {
    disk[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: false, sites: {} };
    await uploadSiteFolders(site());
    expect(sendMessage.mock.calls).toEqual([
      [
        {
          type: 'gv.sync.upload',
          payload: expect.objectContaining({ platform: 'gemini', selection: 'site' }),
        },
      ],
    ]);
    expect(disk[StorageKeys.PROMPT_ITEMS]).toEqual([
      { id: 'local', text: 'Local', tags: [], createdAt: 1 },
    ]);
  });

  it.each([false, true])(
    'acknowledges a completed apply only if its folder write succeeds (failure=%s)',
    async (failed) => {
      failFolders = failed;
      const prompts = structuredClone(disk[StorageKeys.PROMPT_ITEMS]);
      await syncSiteFolders(site());
      expect(sendMessage).toHaveBeenLastCalledWith({
        type: 'gv.sync.completeDownload',
        payload: { operationId: 'download-one', success: !failed },
      });
      expect(disk[FOLDER_KEY]).toEqual(failed ? undefined : cloud);
      expect(disk[StorageKeys.PROMPT_ITEMS]).toEqual(prompts);
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gv.sync.catalogTimeline.pull' }),
      );
    },
  );

  it('acknowledges false after a late successful canonical write was cancelled', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const set = vi.mocked(chrome.storage.local.set).getMockImplementation()!;
    vi.mocked(chrome.storage.local.set).mockImplementation(
      async (items: Record<string, unknown>) => {
        if (FOLDER_KEY in items) {
          entered.resolve();
          await release.promise;
        }
        await set(items, () => {});
      },
    );
    const syncing = syncSiteFolders(site());
    await entered.promise;
    window.dispatchEvent(new Event('pagehide'));
    release.resolve();
    await syncing;

    expect(disk[FOLDER_KEY]).toEqual(cloud);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'gv.sync.completeDownload',
      payload: { operationId: 'download-one', success: false },
    });
  });

  it('acknowledges false when owner preparation fails before the apply starts', async () => {
    const target = site();
    const run = target.begin()!;
    target.begin = () => ({
      ...run,
      prepareRestore: async () => {
        throw new Error('Owner preparation failed');
      },
    });
    const before = structuredClone(disk);
    await syncSiteFolders(target);

    expect(disk).toEqual(before);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'gv.sync.completeDownload',
      payload: { operationId: 'download-one', success: false },
    });
  });

  it('acknowledges false when the page leaves while snapshot finish is persisting', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const target = site();
    const run = target.begin()!;
    target.begin = () => ({
      ...run,
      prepareRestore: async () => ({
        keys: [{ area: 'local', key: StorageKeys.TIMELINE_HIERARCHY }],
        run: async () => true,
      }),
    });
    const set = vi.mocked(chrome.storage.local.set).getMockImplementation()!;
    vi.mocked(chrome.storage.local.set).mockImplementation(
      async (items: Record<string, unknown>) => {
        const snapshot = parseCloudSyncSnapshot(items[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]);
        if (snapshot?.entries.length === 1) {
          entered.resolve();
          await release.promise;
        }
        await set(items, () => {});
      },
    );
    const syncing = syncSiteFolders(target);
    await entered.promise;
    window.dispatchEvent(new Event('pagehide'));
    release.resolve();
    await syncing;

    expect(disk[FOLDER_KEY]).toEqual(cloud);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'gv.sync.completeDownload',
      payload: { operationId: 'download-one', success: false },
    });
  });
});
