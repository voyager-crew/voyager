import { describe, expect, it } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { CloudRestoreError } from '@/core/services/CloudSyncApplyService';
import {
  captureCloudSyncSnapshot,
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { parseCloudSyncSnapshot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';

import {
  emptyFolders,
  folders,
  pageScope,
  setupTransferHarness,
  tabScope,
} from './cloudSyncTransferHarness';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const key = buildScopedStorageKey(StorageKeys.FOLDER_DATA, pageScope.accountKey);

describe('popup download settlement', () => {
  const h = setupTransferHarness();

  it('reports a canonical write completed after cancellation and leaves later owners unstarted', async () => {
    h.stored[key] = folders;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (key in items) {
        entered.resolve();
        await release.promise;
      }
      await save(items);
    });
    await h.render();
    const applying = (await h.transfer.prepareDownload())
      .restore(
        { folders: { data: emptyFolders }, prompts: { items: [] } },
        'overwrite',
        false,
        undefined,
        null,
      )
      .catch((error: unknown) => error);
    await entered.promise;
    await h.unmount();
    release.resolve();

    const snapshot = await readCloudSyncSnapshot();
    expect(await applying).toMatchObject({
      restored: ['folders'],
      failed: ['prompts'],
      message: 'Download cancelled',
      snapshotId: snapshot?.id,
    });
    expect(h.stored[key]).toEqual(emptyFolders);
    expect(Object.hasOwn(h.stored, StorageKeys.PROMPT_ITEMS)).toBe(false);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(h.stored[key]).toEqual(folders);
  });

  it('keeps the owner failure and snapshot id when finalization also fails', async () => {
    h.stored[key] = folders;
    const first = new Error('canonical owner quota');
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (key in items) throw first;
      const slot = parseCloudSyncSnapshot(items[SLOT]);
      if (slot?.appliedHashes.length && slot.entries.length === 1) throw new Error('finish quota');
      await save(items);
    });
    await h.render();
    const error = await (
      await h.transfer.prepareDownload()
    )
      .restore(
        { folders: { data: emptyFolders }, prompts: { items: [] } },
        'overwrite',
        false,
        undefined,
        null,
      )
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(CloudRestoreError);
    expect(error).toMatchObject({
      message: first.message,
      cause: first,
      restored: [],
      failed: ['folders', 'prompts'],
      snapshotId: (await readCloudSyncSnapshot())?.id,
    });
    expect(h.stored[key]).toEqual(folders);
    expect(Object.hasOwn(h.stored, StorageKeys.PROMPT_ITEMS)).toBe(false);
  });

  it('includes completed parts and the snapshot id on a finish-only failure', async () => {
    h.stored[key] = folders;
    const save = h.localSet.getMockImplementation()!;
    const read = h.localGet.getMockImplementation()!;
    let committed = false;
    const first = new Error('finish read unavailable');
    h.localSet.mockImplementation(async (items) => {
      await save(items);
      if (key in items) committed = true;
    });
    h.localGet.mockImplementation(async (keys) => {
      if (committed && Array.isArray(keys) && keys.includes(SLOT)) throw first;
      return read(keys);
    });
    await h.render();
    const error = await (
      await h.transfer.prepareDownload()
    )
      .restore({ folders: { data: emptyFolders } }, 'overwrite', false, undefined, null)
      .catch((error: unknown) => error);
    h.localGet.mockImplementation(read);

    expect(error).toMatchObject({
      message: first.message,
      cause: first,
      restored: ['folders'],
      failed: [],
      snapshotId: (await readCloudSyncSnapshot())?.id,
    });
    expect(h.stored[key]).toEqual(emptyFolders);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(h.stored[key]).toEqual(folders);
  });

  it('keeps the background snapshot id when an account change refuses the apply', async () => {
    h.stored[key] = folders;
    await h.render();
    const download = await h.transfer.prepareDownload();
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: pageScope },
      keys: [],
    });
    h.tabMessage.mockResolvedValue({ ok: true, data: emptyFolders, accountScope: tabScope });

    await expect(
      download.restore({ folders: { data: emptyFolders } }, 'overwrite', false, snapshot.id, null),
    ).rejects.toMatchObject({ restored: [], failed: ['folders'], snapshotId: snapshot.id });
    expect(h.stored[key]).toEqual(folders);
  });

  it('reports cancellation even when only the background highlights applied', async () => {
    await h.render();
    const download = await h.transfer.prepareDownload();
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: pageScope },
      keys: [],
    });
    await h.unmount();

    await expect(
      download.restore(
        { selection: { site: false, shared: false } },
        'overwrite',
        true,
        snapshot.id,
        null,
      ),
    ).rejects.toMatchObject({
      restored: ['highlights'],
      failed: [],
      snapshotId: snapshot.id,
      message: 'Download cancelled',
    });
  });

  it('retains cancellation while the snapshot finish is pending', async () => {
    h.stored[key] = folders;
    const save = h.localSet.getMockImplementation()!;
    const read = h.localGet.getMockImplementation()!;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let committed = false;
    h.localSet.mockImplementation(async (items) => {
      await save(items);
      if (key in items) committed = true;
    });
    h.localGet.mockImplementation(async (keys) => {
      if (committed && Array.isArray(keys) && keys.includes(SLOT)) {
        entered.resolve();
        await release.promise;
      }
      return read(keys);
    });
    await h.render();
    const applying = (await h.transfer.prepareDownload())
      .restore({ folders: { data: emptyFolders } }, 'overwrite', false, undefined, null)
      .catch((error: unknown) => error);
    await entered.promise;
    await h.unmount();
    release.resolve();

    expect(await applying).toMatchObject({
      restored: ['folders'],
      failed: [],
      message: 'Download cancelled',
      snapshotId: (await readCloudSyncSnapshot())?.id,
    });
    expect(h.stored[key]).toEqual(emptyFolders);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(h.stored[key]).toEqual(folders);
  });

  it('reports the last committed owner when its account changes before settlement', async () => {
    h.stored[key] = folders;
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      await save(items);
      if (key in items)
        h.tabMessage.mockResolvedValue({ ok: true, data: emptyFolders, accountScope: tabScope });
    });
    await h.render();

    await expect(
      (await h.transfer.prepareDownload()).restore(
        { folders: { data: emptyFolders } },
        'overwrite',
        false,
        undefined,
        null,
      ),
    ).rejects.toMatchObject({ restored: ['folders'], failed: [], message: 'Download cancelled' });
    expect(h.stored[key]).toEqual(emptyFolders);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', restoredKeys: 1 });
    expect(h.stored[key]).toEqual(folders);
  });
});
