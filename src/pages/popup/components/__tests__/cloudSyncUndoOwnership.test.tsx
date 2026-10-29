import { describe, expect, it } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import {
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { StorageKeys } from '@/core/types/common';

import { emptyFolders, folders, pageScope, setupTransferHarness } from './cloudSyncTransferHarness';

const folderKey = buildScopedStorageKey(StorageKeys.FOLDER_DATA, pageScope.accountKey);
const node = {
  conversationId: 'cloud',
  turnId: 'turn',
  conversationUrl: 'https://gemini.google.com/app/cloud',
  forkGroupId: 'group',
  forkIndex: 0,
  createdAt: 1,
};

describe('download undo owns only the values the download wrote', () => {
  const h = setupTransferHarness();

  it('keeps a new fork when prompts failed before the download reached the fork owner', async () => {
    h.stored[folderKey] = folders;
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (StorageKeys.PROMPT_ITEMS in items) throw new Error('prompt quota');
      await save(items);
    });
    await h.render();
    await expect(
      (await h.transfer.prepareDownload()).restore(
        {
          folders: { data: emptyFolders },
          prompts: { items: [] },
          forks: { data: { nodes: { cloud: [node] }, groups: {} } },
        },
        'overwrite',
        false,
      ),
    ).rejects.toMatchObject({ message: 'Prompt library update failed: prompt quota' });
    expect(h.stored).not.toHaveProperty(StorageKeys.FORK_NODES);
    await h.forkOwner.handle({ type: 'gv.fork.add', payload: node });
    const userFork = structuredClone(h.stored[StorageKeys.FORK_NODES]);

    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({ status: 'restored' });
    expect(h.stored[folderKey]).toEqual(folders);
    expect(h.stored[StorageKeys.FORK_NODES]).toEqual(userFork);
    expect(await readCloudSyncSnapshot()).toBeNull();
  });

  it('keeps and reports folders edited after the download while undoing unchanged prompts', async () => {
    h.stored[folderKey] = folders;
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore({ folders: { data: emptyFolders }, prompts: { items: [] } }, 'overwrite', false);
    const later = {
      ...folders,
      folders: folders.folders.map((f) => ({ ...f, name: 'Later edit' })),
    };
    await chrome.storage.local.set({ [folderKey]: later });

    const result = await undoCloudSyncSnapshot();
    expect(h.stored[folderKey]).toEqual(later);
    expect(h.stored).not.toHaveProperty(StorageKeys.PROMPT_ITEMS);
    expect(result).toMatchObject({
      status: 'restored',
      restoredKeys: 1,
      kept: [
        {
          kind: 'folders',
          keys: [{ area: 'local', key: folderKey }],
          reason: 'changed-since-download',
        },
      ],
    });
  });

  it('records the written folders, never the other tab value present when the write resolves', async () => {
    const otherTab = {
      ...folders,
      folders: folders.folders.map((f) => ({ ...f, name: 'Other tab' })),
    };
    const save = h.localSet.getMockImplementation()!;
    let interleave = true;
    h.localSet.mockImplementation(async (items) => {
      await save(items);
      if (interleave && folderKey in items) {
        interleave = false;
        await save({ [folderKey]: otherTab });
      }
    });
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore({ folders: { data: emptyFolders } }, 'overwrite', false);
    expect(h.stored[folderKey]).toEqual(otherTab);
    // Returning to the actual downloaded content makes the key eligible for undo again.
    await chrome.storage.local.set({ [folderKey]: emptyFolders });
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({
      status: 'restored',
      restoredKeys: 1,
    });
    expect(h.stored).not.toHaveProperty(folderKey);
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: emptyFolders }),
    ).toBe(true);
    expect(await isUndoneCloudSyncValue({ area: 'local', key: folderKey, value: otherTab })).toBe(
      false,
    );
  });
});
