import { describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import {
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { getTimelineHierarchyStorageKey } from '@/pages/content/timeline/hierarchyStorage';

import { emptyFolders, folders, pageScope, setupTransferHarness } from './cloudSyncTransferHarness';

const prompt = { id: 'local', text: 'Keep me', tags: ['local'], createdAt: 1 };
const hierarchy = {
  conversations: {
    local: {
      conversationUrl: 'https://gemini.google.com/u/1/app/local',
      levels: { turn: 2 as const },
      collapsed: [],
      updatedAt: 1,
    },
  },
};
const folderKey = buildScopedStorageKey(StorageKeys.FOLDER_DATA, pageScope.accountKey);
const hierarchyKey = getTimelineHierarchyStorageKey(pageScope.accountKey);

describe('popup download apply snapshot and overwrite policy', () => {
  const h = setupTransferHarness();

  it('keeps missing prompts and hierarchy byte-for-byte while applying present folders', async () => {
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    h.stored[hierarchyKey] = hierarchy;
    h.stored[folderKey] = folders;
    await h.render();
    const result = await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: { data: emptyFolders },
        prompts: null,
        timelineHierarchy: null,
      },
      'overwrite',
      false,
    );
    expect(h.stored[folderKey]).toEqual(emptyFolders);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
    expect(h.stored[hierarchyKey]).toEqual(hierarchy);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'prompts', reason: 'missing' },
        { kind: 'timelineHierarchy', reason: 'missing' },
      ]),
    );
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: folderKey, existed: true, value: folders },
    ]);
  });

  it('skips missing folders and applies a recognized empty prompt list', async () => {
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    await h.render();
    const result = await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: null,
        prompts: { items: [] },
      },
      'overwrite',
      false,
    );
    expect(h.stored[folderKey]).toEqual(folders);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(result.skipped).toContainEqual({ kind: 'folders', reason: 'missing' });
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: StorageKeys.PROMPT_ITEMS, existed: true, value: [prompt] },
    ]);
  });

  it('skips explicit unrecognized payloads even when their raw value looks usable', async () => {
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    h.stored[hierarchyKey] = hierarchy;
    await h.render();
    const result = await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: { data: emptyFolders },
        prompts: { items: [] },
        timelineHierarchy: { format: 'future-format', data: { conversations: {} } },
        kindStatus: { folders: 'unrecognized', prompts: 'unrecognized' },
        settings: { data: { [StorageKeys.CHAT_WIDTH]: 88 } },
      },
      'overwrite',
      false,
    );
    expect(h.stored[folderKey]).toEqual(folders);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
    expect(h.stored[hierarchyKey]).toEqual(hierarchy);
    expect((await chrome.storage.sync.get(StorageKeys.CHAT_WIDTH))[StorageKeys.CHAT_WIDTH]).toBe(
      88,
    );
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'folders', reason: 'unrecognized' },
        { kind: 'prompts', reason: 'unrecognized' },
        { kind: 'timelineHierarchy', reason: 'unrecognized' },
      ]),
    );
  });

  it('never overwrites plugins with an empty map but applies a nonempty map', async () => {
    const original = { local: { enabled: true, installedAt: 1 } };
    h.stored[StorageKeys.PLUGINS_STATE] = original;
    await h.render();
    const download = await h.transfer.prepareDownload();
    const result = await download.restore(
      { plugins: { format: 'gemini-voyager.plugins.v1', data: {} }, prompts: { items: [] } },
      'overwrite',
      false,
    );
    expect(h.stored[StorageKeys.PLUGINS_STATE]).toEqual(original);
    expect(result.skipped).toContainEqual({ kind: 'plugins', reason: 'empty-plugin-map' });
    expect((await readCloudSyncSnapshot())?.entries.map((entry) => entry.key)).not.toContain(
      StorageKeys.PLUGINS_STATE,
    );
    const cloud = { cloud: { enabled: false, installedAt: 2 } };
    await download.restore(
      { plugins: { format: 'gemini-voyager.plugins.v1', data: cloud } },
      'overwrite',
      false,
    );
    expect(h.stored[StorageKeys.PLUGINS_STATE]).toEqual(cloud);
  });

  it('captures all actual owner targets and their existence before the first apply write', async () => {
    const plugins = { local: { enabled: true, installedAt: 1 } };
    h.stored[StorageKeys.PLUGINS_STATE] = plugins;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    h.stored[folderKey] = JSON.stringify(folders);
    h.stored[StorageKeys.TIMELINE_STARRED_MESSAGES] = { messages: {} };
    await chrome.storage.sync.set({ [StorageKeys.CHAT_WIDTH]: 70 });
    const originalLocal = h.localSet.getMockImplementation()!;
    const originalSync = vi.mocked(chrome.storage.sync.set).getMockImplementation()!;
    const expected = [
      { area: 'local', key: StorageKeys.PLUGINS_STATE, existed: true, value: plugins },
      { area: 'local', key: folderKey, existed: true, value: JSON.stringify(folders) },
      { area: 'local', key: hierarchyKey, existed: false },
      { area: 'local', key: StorageKeys.PROMPT_ITEMS, existed: true, value: [prompt] },
      { area: 'local', key: StorageKeys.SAVED_LIBRARY_STARS, existed: false },
      {
        area: 'local',
        key: StorageKeys.TIMELINE_STARRED_MESSAGES,
        existed: true,
        value: { messages: {} },
      },
      { area: 'local', key: StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES, existed: false },
      { area: 'sync', key: StorageKeys.CHAT_WIDTH, existed: true, value: 70 },
      { area: 'sync', key: StorageKeys.CONTEXT_SYNC_PORT, existed: false },
    ];
    const checkDurable = () => {
      expect(h.stored[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]).toMatchObject({
        context: { source: 'popup-restore', platform: 'gemini', accountScope: pageScope },
        timestamp: expect.any(Number),
        entries: expect.arrayContaining(expected),
      });
    };
    h.localSet.mockImplementation(async (items) => {
      if (!(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items)) checkDurable();
      await originalLocal(items);
    });
    vi.mocked(chrome.storage.sync.set).mockImplementation(async (items) => {
      checkDurable();
      await originalSync(items, () => undefined);
    });
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: { data: emptyFolders },
        prompts: { items: [] },
        timelineHierarchy: { data: { conversations: {} } },
        plugins: {
          format: 'gemini-voyager.plugins.v1',
          data: { cloud: { enabled: false, installedAt: 2 } },
        },
        settings: {
          data: {
            [StorageKeys.CHAT_WIDTH]: 88,
            [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
            [StorageKeys.TIMELINE_POSITION]: null,
            unknown: true,
          },
        },
        starred: { data: { messages: {} } },
      },
      'overwrite',
      false,
    );
    const snapshot = await readCloudSyncSnapshot();
    expect(snapshot?.entries).toHaveLength(expected.length);
    expect(snapshot?.entries).toEqual(expect.arrayContaining(expected));
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(h.stored[folderKey]).toEqual(emptyFolders);
    expect(h.stored[hierarchyKey]).toEqual({ conversations: {} });
    expect((await chrome.storage.sync.get(StorageKeys.CHAT_WIDTH))[StorageKeys.CHAT_WIDTH]).toBe(
      88,
    );
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({ status: 'restored' });
    expect(h.stored[StorageKeys.PLUGINS_STATE]).toEqual(plugins);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
    expect(h.stored[folderKey]).toBe(JSON.stringify(folders));
    expect(h.stored).not.toHaveProperty(hierarchyKey);
    expect(h.stored).not.toHaveProperty(StorageKeys.SAVED_LIBRARY_STARS);
    expect(h.stored).not.toHaveProperty(StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES);
    expect(
      await chrome.storage.sync.get([StorageKeys.CHAT_WIDTH, StorageKeys.CONTEXT_SYNC_PORT]),
    ).toEqual({ [StorageKeys.CHAT_WIDTH]: 70 });
    expect(h.stored[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]).toMatchObject({
      kind: 'undone',
      markers: expect.any(Array),
    });
    expect(h.stored[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]).not.toHaveProperty('entries');
    expect(h.stored[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]).not.toHaveProperty('appliedHashes');
    expect(await readCloudSyncSnapshot()).toBeNull();
    h.stored[StorageKeys.PROMPT_ITEMS] = ['a later edit'];
    const beforeSecondUndo = structuredClone(h.stored);
    const writes = h.localSet.mock.calls.length;
    await expect(undoCloudSyncSnapshot()).resolves.toEqual({ status: 'absent' });
    expect(h.stored).toEqual(beforeSecondUndo);
    expect(h.localSet.mock.calls).toHaveLength(writes);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual(['a later edit']);
  });

  it('leaves all user storage untouched when snapshot persistence fails', async () => {
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    await chrome.storage.sync.set({ [StorageKeys.CHAT_WIDTH]: 70 });
    const prior = structuredClone(h.stored);
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items) throw new Error('snapshot quota');
      await save(items);
    });
    await h.render();
    await expect(
      (await h.transfer.prepareDownload()).restore(
        {
          folders: { data: emptyFolders },
          prompts: { items: [] },
          plugins: {
            format: 'gemini-voyager.plugins.v1',
            data: { cloud: { enabled: false, installedAt: 2 } },
          },
          settings: { data: { [StorageKeys.CHAT_WIDTH]: 88 } },
        },
        'overwrite',
        false,
      ),
    ).rejects.toMatchObject({ restored: [], message: 'snapshot quota' });
    expect(h.stored).toEqual(prior);
    expect(await chrome.storage.sync.get(StorageKeys.CHAT_WIDTH)).toEqual({
      [StorageKeys.CHAT_WIDTH]: 70,
    });
  });

  it('merge still keeps local prompts, folders and plugins when the cloud sources are empty', async () => {
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    h.stored[hierarchyKey] = hierarchy;
    const plugins = { local: { enabled: true, installedAt: 1 } };
    h.stored[StorageKeys.PLUGINS_STATE] = plugins;
    await h.render();
    const result = await (
      await h.transfer.prepareDownload()
    ).restore({ plugins: { format: 'gemini-voyager.plugins.v1', data: {} } }, 'merge', false);
    expect(h.stored[folderKey]).toMatchObject({ folders: folders.folders });
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
    expect(h.stored[hierarchyKey]).toEqual(hierarchy);
    expect(h.stored[StorageKeys.PLUGINS_STATE]).toEqual(plugins);
    expect(result.skipped).toEqual([]);
  });

  it('skips a cloud prompt the real owner cannot recognize, while applying valid folders', async () => {
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    await h.render();
    const result = await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: { data: emptyFolders },
        prompts: { items: [{ ...prompt, text: '' }] },
      },
      'overwrite',
      false,
    );
    expect(h.stored[folderKey]).toEqual(emptyFolders);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([prompt]);
    expect(result.skipped).toContainEqual({ kind: 'prompts', reason: 'unrecognized' });
  });

  it('keeps untagged plugin JSON out of both restore modes', async () => {
    const plugins = { local: { enabled: true, installedAt: 1 } };
    h.stored[StorageKeys.PLUGINS_STATE] = plugins;
    await h.render();
    const download = await h.transfer.prepareDownload();
    for (const mode of ['merge', 'overwrite'] as const) {
      await download.restore(
        { plugins: { data: { cloud: { enabled: false, installedAt: 2 } } } },
        mode,
        false,
      );
      expect(h.stored[StorageKeys.PLUGINS_STATE]).toEqual(plugins);
    }
  });

  it('keeps corrupt local forks untouched and reports the kind as failed', async () => {
    const localNode = {
      conversationId: 'local-only',
      turnId: 'local-turn',
      conversationUrl: 'https://gemini.google.com/app/local-only',
      forkGroupId: 'local-group',
      forkIndex: 0,
      createdAt: 1,
    };
    const cloudNode = {
      ...localNode,
      conversationId: 'cloud',
      turnId: 'cloud-turn',
      conversationUrl: 'https://gemini.google.com/app/cloud',
      forkGroupId: 'cloud-group',
    };
    const corrupt = { nodes: { 'local-only': [localNode] }, groups: null };
    h.stored[StorageKeys.FORK_NODES] = corrupt;
    await h.render();
    await expect(
      (await h.transfer.prepareDownload()).restore(
        {
          forks: {
            format: 'gemini-voyager.forks.v1',
            data: { nodes: { cloud: [cloudNode] }, groups: {} },
          },
        },
        'overwrite',
        false,
      ),
    ).rejects.toMatchObject({ restored: [], failed: ['forks'] });
    expect(h.stored[StorageKeys.FORK_NODES]).toEqual(corrupt);
    expect((await readCloudSyncSnapshot())?.appliedHashes ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'forks' })]),
    );
    await expect(undoCloudSyncSnapshot()).resolves.toEqual({ status: 'absent' });
    expect(h.stored[StorageKeys.FORK_NODES]).toEqual(corrupt);
  });

  it('does not turn a planned fork no-op into an unsnapshotted write after a local edit', async () => {
    const node = {
      conversationId: 'cloud',
      turnId: 'turn',
      conversationUrl: 'https://gemini.google.com/app/cloud',
      forkGroupId: 'group',
      forkIndex: 0,
      createdAt: 1,
    };
    h.stored[StorageKeys.FORK_NODES] = {
      nodes: { cloud: [node] },
      groups: { group: ['cloud:turn'] },
    };
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items) {
        await h.forkOwner.handle({
          type: 'gv.fork.remove',
          payload: { conversationId: 'cloud', turnId: 'turn', forkGroupId: 'group' },
        });
      }
      await save(items);
    });
    await h.render();
    await (
      await h.transfer.prepareDownload()
    ).restore(
      {
        folders: { data: emptyFolders },
        forks: {
          format: 'gemini-voyager.forks.v1',
          data: { nodes: { cloud: [node] }, groups: {} },
        },
      },
      'overwrite',
      false,
    );
    expect(h.stored[StorageKeys.FORK_NODES]).toEqual({ nodes: {}, groups: {} });
    expect((await readCloudSyncSnapshot())?.entries.map((entry) => entry.key)).not.toContain(
      StorageKeys.FORK_NODES,
    );
  });

  it('does not apply a late snapshot after the popup closes', async () => {
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [prompt];
    const prior = structuredClone(h.stored);
    let entered!: () => void;
    const capturing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = h.localSet.getMockImplementation()!;
    h.localSet.mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items) {
        entered();
        await held;
      }
      await save(items);
    });
    await h.render();
    const download = await h.transfer.prepareDownload();
    const applying = download
      .restore({ folders: { data: emptyFolders }, prompts: { items: [] } }, 'overwrite', false)
      .catch((error: unknown) => error);
    await capturing;
    await h.unmount();
    release();
    expect(await applying).toMatchObject({
      restored: [],
      message: 'Download cancelled',
      snapshotId: expect.any(String),
    });
    await readCloudSyncSnapshot();
    const { [StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]: _slot, ...stored } = h.stored;
    expect(stored).toEqual(prior);
  });
});
