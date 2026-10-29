import { describe, expect, it } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import {
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { parseCloudSyncSnapshot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import { getTimelineHierarchyStorageKey } from '@/pages/content/timeline/hierarchyStorage';

import { emptyFolders, folders, pageScope, setupTransferHarness } from './cloudSyncTransferHarness';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const folderKey = buildScopedStorageKey(StorageKeys.FOLDER_DATA, pageScope.accountKey);
const hierarchyKey = getTimelineHierarchyStorageKey(pageScope.accountKey);
const plugins = { local: { enabled: true, installedAt: 1 } };

describe('popup write-ahead download receipts', () => {
  const h = setupTransferHarness();

  it.each([
    { kind: 'folders', data: { folders: { data: emptyFolders } } },
    { kind: 'hierarchy', data: { timelineHierarchy: { data: { conversations: {} } } } },
    { kind: 'settings', data: { settings: { data: { [StorageKeys.CHAT_WIDTH]: 88 } } } },
    {
      kind: 'plugins',
      data: {
        plugins: {
          format: 'gemini-voyager.plugins.v1',
          data: { cloud: { enabled: false, installedAt: 2 } },
        },
      },
    },
  ])('leaves $kind unchanged when its receipt cannot be saved', async ({ kind, data }) => {
    h.stored[folderKey] = folders;
    h.stored[hierarchyKey] = {
      conversations: { prior: { levels: { turn: 2 }, collapsed: [], updatedAt: 1 } },
    };
    h.stored[StorageKeys.PLUGINS_STATE] = plugins;
    h.synced[StorageKeys.CHAT_WIDTH] = 70;
    const before = structuredClone({ local: h.stored, sync: h.synced });
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (parseCloudSyncSnapshot(items[SLOT])?.appliedHashes.length)
        throw new Error('receipt quota');
      await save(items);
    });
    await h.render();

    await expect(
      (await h.transfer.prepareDownload()).restore(data, 'overwrite', false),
    ).rejects.toMatchObject({
      restored: [],
      failed: [kind],
      message: 'receipt quota',
    });
    const { [SLOT]: _slot, ...local } = h.stored;
    expect({ local, sync: h.synced }).toEqual(before);
    expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
  });

  it('keeps undo usable when the canonical write consumes the remaining receipt quota', async () => {
    h.stored[folderKey] = folders;
    const save = h.localSet.getMockImplementation()!;
    let canonicalWritten = false;
    h.localSet.mockImplementation(async (items) => {
      if (canonicalWritten && parseCloudSyncSnapshot(items[SLOT])?.appliedHashes.length)
        throw new Error('receipt quota after canonical write');
      await save(items);
      if (folderKey in items) canonicalWritten = true;
    });
    await h.render();

    await expect(
      (await h.transfer.prepareDownload()).restore(
        { folders: { data: emptyFolders } },
        'overwrite',
        false,
      ),
    ).resolves.toMatchObject({ restored: ['folders'] });
    expect(h.stored[folderKey]).toEqual(emptyFolders);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: folderKey, existed: true, value: folders },
    ]);
    // Undo metadata can be saved again; the pre-apply data must still be available.
    h.localSet.mockImplementation(save);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(h.stored[folderKey]).toEqual(folders);
  });

  it('retains a prepared original when the subsequent canonical write fails', async () => {
    h.stored[folderKey] = folders;
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (folderKey in items) throw new Error('canonical quota');
      await save(items);
    });
    await h.render();

    await expect(
      (await h.transfer.prepareDownload()).restore(
        { folders: { data: emptyFolders } },
        'overwrite',
        false,
      ),
    ).rejects.toMatchObject({ failed: ['folders'] });
    expect(h.stored[folderKey]).toEqual(folders);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: folderKey, existed: true, value: folders },
    ]);
    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [],
    });
    expect(h.stored[folderKey]).toEqual(folders);
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: emptyFolders }),
    ).toBe(true);
  });

  it('reports the failed kind even when slot cleanup also fails', async () => {
    h.stored[folderKey] = folders;
    const save = h.localSet.getMockImplementation()!;
    let captured = false;
    h.localSet.mockImplementation(async (items) => {
      if (SLOT in items) {
        if (captured) throw new Error('storage unavailable');
        captured = true;
      }
      await save(items);
    });
    await h.render();
    await expect(
      (await h.transfer.prepareDownload()).restore(
        { folders: { data: emptyFolders } },
        'overwrite',
        false,
      ),
    ).rejects.toMatchObject({ restored: [], failed: ['folders'], message: 'storage unavailable' });
    expect(h.stored[folderKey]).toEqual(folders);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: folderKey, existed: true, value: folders },
    ]);
  });

  it.each([
    { existed: false, edited: false },
    { existed: true, edited: false },
    { existed: false, edited: true },
    { existed: true, edited: true },
  ])(
    'undo after cancellation reports only later edits (existed: $existed, edited: $edited)',
    async ({ existed, edited }) => {
      if (existed) h.stored[folderKey] = folders;
      const save = h.localSet.getMockImplementation()!;
      let entered!: () => void;
      let release!: () => void;
      const persisting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.localSet.mockImplementation(async (items) => {
        if (parseCloudSyncSnapshot(items[SLOT])?.appliedHashes.length) {
          entered();
          await held;
        }
        await save(items);
      });
      await h.render();
      const applying = (await h.transfer.prepareDownload())
        .restore({ folders: { data: emptyFolders } }, 'overwrite', false)
        .catch((error: unknown) => error);
      await persisting;
      await h.unmount();
      release();
      expect(await applying).toMatchObject({
        restored: [],
        failed: ['folders'],
        message: 'Download cancelled',
      });
      expect(h.stored[folderKey]).toEqual(existed ? folders : undefined);
      const later = {
        ...folders,
        folders: [{ ...folders.folders[0], name: 'Edited after cancellation' }],
      };
      if (edited) await chrome.storage.local.set({ [folderKey]: later });
      h.localSet.mockClear();

      expect(await undoCloudSyncSnapshot()).toMatchObject({
        status: 'restored',
        restoredKeys: 0,
        kept: edited
          ? [
              {
                kind: 'folders',
                keys: [{ area: 'local', key: folderKey }],
                reason: 'changed-since-download',
              },
            ]
          : [],
      });
      expect(Object.hasOwn(h.stored, folderKey)).toBe(existed || edited);
      expect(h.stored[folderKey]).toEqual(edited ? later : existed ? folders : undefined);
      expect(h.stored[SLOT]).toMatchObject({ kind: 'undone' });
      expect(
        await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: emptyFolders }),
      ).toBe(!edited);
      expect(h.localSet.mock.calls.every(([items]) => !(folderKey in items))).toBe(true);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    },
  );

  it('does not count a downloaded value already equal to the original as restored', async () => {
    h.stored[folderKey] = emptyFolders;
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore({ folders: { data: emptyFolders } }, 'overwrite', false);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toHaveLength(1);

    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [],
    });
    expect(h.stored[folderKey]).toEqual(emptyFolders);
    expect(h.stored[SLOT]).toMatchObject({ kind: 'undone' });
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: emptyFolders }),
    ).toBe(true);
  });

  it('does not report a key returned to its original value while undo publishes markers', async () => {
    h.stored[folderKey] = folders;
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore({ folders: { data: emptyFolders } }, 'overwrite', false);
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      await save(items);
      if (parseCloudSyncSnapshot(items[SLOT])?.kind === 'undoing')
        await save({ [folderKey]: folders });
    });

    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [],
    });
    expect(h.stored[folderKey]).toEqual(folders);
    expect(h.stored[SLOT]).toMatchObject({ kind: 'undone' });
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: emptyFolders }),
    ).toBe(true);
  });
});
