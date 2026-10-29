import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import {
  captureCloudSyncSnapshot,
  recordCloudSyncWrites,
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { applyFolderCloudDownload } from '@/features/folder/services/cloudDownloadApply';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { restoreCatalogOutlineBucket } from '@/features/timeline/catalogOutlineWriter';
import { createForkMessagesOwner } from '@/pages/background/forkMessages';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

import { FolderDataSession } from '../FolderDataSession';
import { FolderTransferController } from '../FolderTransferController';
import { syncSiteFolders } from '../cloudSyncClient';
import { AIStudioFolderStorageAdapter } from '../storage/AIStudioFolderStorageAdapter';
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
vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const CATALOG_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
const FOLDER_KEY = buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'email:person');
const scope = { accountKey: 'email:person', accountId: 1, routeUserId: null };
const emptyFolders = (): FolderData => ({ folders: [], folderContents: {} });
const cloudFolders = (): FolderData => ({
  folders: [
    { id: 'cloud', name: 'Cloud', isExpanded: true, parentId: null, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: { cloud: [] },
});
const catalog = {
  conversations: {
    'chatgpt:conv:test': {
      conversationUrl: 'https://chatgpt.com/c/test',
      levels: { turn: 2 },
      collapsed: [],
      updatedAt: 2,
    },
  },
};
let disk: Record<string, unknown>;
let blockSnapshot: (() => Promise<void>) | undefined;
let blockRead: ((keys: unknown) => Promise<void>) | undefined;
let download: Record<string, unknown> | null;
let pulled: Record<string, unknown>;

function storedWithoutSnapshot(): Record<string, unknown> {
  const { [SLOT]: _snapshot, ...stored } = disk;
  return structuredClone(stored);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function harness() {
  const session = new FolderDataSession(FOLDER_KEY, 'cloud-snapshot-test', null, () => true);
  session.accountScope = { ...scope, emailHash: 'person' };
  session.data = emptyFolders();
  session.ready = true;
  let activation = 1;
  const notify = vi.fn();
  const transfer = new FolderTransferController({
    getContext: () => ({ session, activation, data: session.data }),
    applyData: async (data, onWritten) => {
      const saved = await new LocalStorageFolderAdapter().saveData(
        session.storageKey,
        data,
        undefined,
        onWritten,
      );
      session.data = data;
      return saved;
    },
    refresh: () => {},
    notify,
  });
  return { transfer, notify, leave: () => (activation += 1) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  disk = {
    [FOLDER_KEY]: emptyFolders(),
    [StorageKeys.FOLDER_DATA]: { untouchedOtherScope: true },
    [StorageKeys.PROMPT_ITEMS]: [{ id: 'local', text: 'Local', tags: [], createdAt: 1 }],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
  };
  blockSnapshot = undefined;
  blockRead = undefined;
  download = {
    folders: { data: cloudFolders() },
    timelineHierarchy: { data: { conversations: {} } },
    prompts: { items: [] },
  };
  pulled = {};
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
    await blockRead?.(keys);
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    return structuredClone(
      Object.fromEntries(
        names.filter((key) => Object.hasOwn(disk, key)).map((key) => [key, disk[key]]),
      ),
    );
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    if (SLOT in items) await blockSnapshot?.();
    // A real apply without a prior durable slot must fail, regardless of which owner writes it.
    if (!(SLOT in items) && !disk[SLOT]) throw new Error('Apply started without a snapshot');
    Object.assign(disk, structuredClone(items));
  });
  vi.mocked(chrome.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete disk[key];
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({}));
  vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);
  vi.mocked(chrome.storage.sync.remove).mockResolvedValue(undefined);
  const area = {
    get: (keys: string[]) => chrome.storage.local.get(keys),
    set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
  };
  const stars = createStarredMessagesHandler(createStarStore(area));
  const forks = createForkMessagesOwner(area);
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, respond) => {
    const result =
      stars(message, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') }) ??
      forks.handle(message);
    if (result && typeof respond === 'function') {
      void result.then(
        (value) => respond(value),
        (error: unknown) => respond({ ok: false, error: String(error) }),
      );
    }
    return undefined;
  });
  sendMessage.mockImplementation(async (message) => {
    if (message.type === 'gv.sync.download') return { ok: true, data: download };
    if (message.type === 'gv.sync.catalogTimeline.pull') return { ok: true, ...pulled };
    if (message.type === 'gv.timeline.catalogOutline.write') {
      let restored = 0;
      for (const [key, value] of Object.entries(message.payload.buckets)) {
        if (await restoreCatalogOutlineBucket(key, value)) restored += 1;
      }
      return { ok: true, restored, failed: 0 };
    }
    return { ok: false, error: 'Unexpected message' };
  });
});

describe('folder panel pre-apply snapshot', () => {
  it('captures every canonical owner write before applying and undoes the exact prior storage', async () => {
    const prior = structuredClone(disk);
    download = {
      ...download,
      starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      forks: {
        format: 'gemini-voyager.forks.v1',
        data: {
          nodes: {
            cloud: [
              {
                conversationId: 'cloud',
                turnId: 'turn',
                conversationUrl: 'https://gemini.google.com/app/cloud',
                forkGroupId: 'group',
                forkIndex: 0,
                createdAt: 1,
              },
            ],
          },
          groups: {},
        },
      },
    };
    pulled = { buckets: { [CATALOG_KEY]: catalog } };
    const h = harness();

    await h.transfer.sync();

    expect(disk[FOLDER_KEY]).toEqual(cloudFolders());
    expect(disk[StorageKeys.FORK_NODES]).toMatchObject({ nodes: { cloud: [{ turnId: 'turn' }] } });
    const snapshot = await readCloudSyncSnapshot();
    expect(snapshot?.context).toEqual({
      source: 'folder-panel-download',
      platform: 'gemini',
      accountScope: scope,
    });
    expect(snapshot?.entries).toEqual(
      expect.arrayContaining([
        { area: 'local', key: FOLDER_KEY, existed: true, value: prior[FOLDER_KEY] },
        {
          area: 'local',
          key: StorageKeys.FORK_NODES,
          existed: true,
          value: prior[StorageKeys.FORK_NODES],
        },
        { area: 'local', key: StorageKeys.TIMELINE_HIERARCHY, existed: false },
        { area: 'local', key: StorageKeys.SAVED_LIBRARY_STARS, existed: false },
        { area: 'local', key: StorageKeys.TIMELINE_STARRED_MESSAGES, existed: false },
        { area: 'local', key: StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES, existed: false },
        { area: 'local', key: CATALOG_KEY, existed: false },
      ]),
    );
    expect(snapshot?.entries).toHaveLength(7);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(disk[SLOT]).toMatchObject({ kind: 'undone', markers: expect.any(Array) });
    expect(disk[SLOT]).not.toHaveProperty('entries');
    expect(disk[SLOT]).not.toHaveProperty('appliedHashes');
    expect(await readCloudSyncSnapshot()).toBeNull();
    const beforeSecondUndo = structuredClone(disk);
    const writes = vi.mocked(chrome.storage.local.set).mock.calls.length;
    expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
    expect(vi.mocked(chrome.storage.local.set).mock.calls).toHaveLength(writes);
    expect(disk).toEqual(beforeSecondUndo);
  });

  it('does not apply anything if the snapshot cannot be persisted', async () => {
    const prior = structuredClone(disk);
    blockSnapshot = () => Promise.reject(new Error('Snapshot quota exceeded'));
    const h = harness();

    await h.transfer.sync();

    expect(disk).toEqual(prior);
    expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
  });

  it('keeps hierarchy when its receipt fails after folders were applied', async () => {
    const prior = structuredClone(disk);
    download = {
      ...download,
      prompts: { items: [{ id: 'cloud', text: 'Downloaded prompt', tags: [], createdAt: 2 }] },
    };
    let failed = false;
    blockSnapshot = async () => {
      const slot = parseCloudSyncSnapshotSlot(disk[SLOT]);
      if (
        !failed &&
        slot?.kind === 'snapshot' &&
        slot.appliedHashes.some(({ kind }) => kind === 'folders')
      ) {
        failed = true;
        throw new Error('Hierarchy receipt quota exceeded');
      }
    };
    const h = harness();

    await h.transfer.sync();

    expect(failed).toBe(true);
    expect(disk[FOLDER_KEY]).toEqual(cloudFolders());
    expect(disk[StorageKeys.PROMPT_ITEMS]).toEqual(prior[StorageKeys.PROMPT_ITEMS]);
    expect(disk[StorageKeys.TIMELINE_HIERARCHY]).toBeUndefined();
    expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(storedWithoutSnapshot()).toEqual(prior);
  });

  it('does not write folders after the account leaves while the snapshot is persisting', async () => {
    const started = deferred();
    const release = deferred();
    blockSnapshot = () => {
      started.resolve();
      return release.promise;
    };
    const prior = structuredClone(disk);
    const h = harness();
    const syncing = h.transfer.sync();
    await started.promise;
    h.leave();
    release.resolve();
    await syncing;

    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
  });

  it('does not start a late apply after the page leaves during snapshot persistence', async () => {
    const started = deferred();
    const release = deferred();
    blockSnapshot = () => {
      started.resolve();
      return release.promise;
    };
    const prior = structuredClone(disk);
    const h = harness();
    const syncing = h.transfer.sync();
    await started.promise;
    window.dispatchEvent(new Event('pagehide'));
    release.resolve();
    await syncing;
    await readCloudSyncSnapshot();

    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
  });

  it('snapshots a catalog-only restore without inventing a missing folder write', async () => {
    const prior = structuredClone(disk);
    download = null;
    pulled = { buckets: { [CATALOG_KEY]: catalog } };
    const h = harness();

    await h.transfer.sync();

    expect(disk[CATALOG_KEY]).toEqual(catalog);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: CATALOG_KEY, existed: false },
    ]);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(disk[SLOT]).toMatchObject({ kind: 'undone', markers: expect.any(Array) });
    expect(disk[SLOT]).not.toHaveProperty('entries');
    expect(await readCloudSyncSnapshot()).toBeNull();
  });

  it('keeps AI Studio shared prompts untouched by its cloud folder save', async () => {
    const key = StorageKeys.FOLDER_DATA_AISTUDIO;
    const prior = structuredClone(disk);
    await syncSiteFolders({
      platform: 'aistudio',
      t: (value) => value,
      notify: () => {},
      begin: () => ({
        current: () => true,
        folders: emptyFolders(),
        data: emptyFolders,
        save: async (folders, prompts, onWritten) => {
          await new AIStudioFolderStorageAdapter().saveData(
            key,
            folders,
            prompts ? { [StorageKeys.PROMPT_ITEMS]: prompts } : undefined,
            onWritten,
          );
          return true;
        },
      }),
    });

    expect(disk[key]).toEqual(cloudFolders());
    expect(disk[StorageKeys.PROMPT_ITEMS]).toEqual(prior[StorageKeys.PROMPT_ITEMS]);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key, existed: false },
    ]);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(disk[SLOT]).toMatchObject({ kind: 'undone', markers: expect.any(Array) });
    expect(disk[SLOT]).not.toHaveProperty('entries');
    expect(await readCloudSyncSnapshot()).toBeNull();
  });

  it('extends a background-started slot without replacing its earlier originals', async () => {
    const prior = structuredClone(disk);
    const context = {
      source: 'folder-panel-download' as const,
      platform: 'gemini' as const,
      accountScope: scope,
    };
    const background = await captureCloudSyncSnapshot({
      context,
      keys: [{ area: 'local', key: StorageKeys.FOLDER_DATA }],
    });
    await recordCloudSyncWrites(background.id, [
      {
        area: 'local',
        key: StorageKeys.FOLDER_DATA,
        kind: 'folders',
        value: { backgroundApplied: true },
      },
    ]);
    await chrome.storage.local.set({ [StorageKeys.FOLDER_DATA]: { backgroundApplied: true } });

    await applyFolderCloudDownload({
      context,
      snapshotId: background.id,
      keys: [{ area: 'local', key: FOLDER_KEY }],
      current: () => true,
      saveFolders: async (snapshotId) => {
        const value = cloudFolders();
        await recordCloudSyncWrites(snapshotId, [
          { area: 'local', key: FOLDER_KEY, kind: 'folders', value },
        ]);
        await chrome.storage.local.set({ [FOLDER_KEY]: value });
        return true;
      },
    });

    const snapshot = await readCloudSyncSnapshot();
    expect(snapshot?.id).toBe(background.id);
    expect(snapshot?.entries).toEqual([
      {
        area: 'local',
        key: StorageKeys.FOLDER_DATA,
        existed: true,
        value: prior[StorageKeys.FOLDER_DATA],
      },
      { area: 'local', key: FOLDER_KEY, existed: true, value: prior[FOLDER_KEY] },
    ]);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(storedWithoutSnapshot()).toEqual(prior);
    expect(disk[SLOT]).toMatchObject({ kind: 'undone', markers: expect.any(Array) });
    expect(disk[SLOT]).not.toHaveProperty('entries');
    expect(await readCloudSyncSnapshot()).toBeNull();
  });

  it('stops later owners when another download replaces the snapshot slot', async () => {
    const priorPrompts = structuredClone(disk[StorageKeys.PROMPT_ITEMS]);
    let newestId: string | undefined;

    await expect(
      applyFolderCloudDownload({
        context: { source: 'folder-panel-download', platform: 'gemini', accountScope: scope },
        keys: [
          { area: 'local', key: FOLDER_KEY },
          { area: 'local', key: StorageKeys.PROMPT_ITEMS },
        ],
        current: () => true,
        saveFolders: async (snapshotId) => {
          const value = cloudFolders();
          await recordCloudSyncWrites(snapshotId, [
            { area: 'local', key: FOLDER_KEY, kind: 'folders', value },
          ]);
          await chrome.storage.local.set({ [FOLDER_KEY]: value });
          const newer = await captureCloudSyncSnapshot({
            context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
            keys: [{ area: 'local', key: StorageKeys.FOLDER_DATA }],
          });
          newestId = newer.id;
          return true;
        },
        restoreExtras: async (snapshotId) => {
          await recordCloudSyncWrites(snapshotId, [
            { area: 'local', key: StorageKeys.PROMPT_ITEMS, kind: 'prompts', value: [] },
          ]);
          await chrome.storage.local.set({ [StorageKeys.PROMPT_ITEMS]: [] });
          return true;
        },
      }),
    ).rejects.toThrow('Cloud snapshot is no longer current');

    expect(disk[FOLDER_KEY]).toEqual(cloudFolders());
    expect(disk[StorageKeys.PROMPT_ITEMS]).toEqual(priorPrompts);
    expect((await readCloudSyncSnapshot())?.id).toBe(newestId);
  });

  it('does not write after the account changes during the snapshot ownership read', async () => {
    const prior = structuredClone(disk);
    const started = deferred();
    const release = deferred();
    let current = true;
    blockRead = async (keys) => {
      if (Array.isArray(keys) && keys.includes(SLOT)) {
        started.resolve();
        await release.promise;
      }
    };
    const applying = applyFolderCloudDownload({
      context: { source: 'folder-panel-download', platform: 'gemini', accountScope: scope },
      keys: [{ area: 'local', key: FOLDER_KEY }],
      current: () => current,
      saveFolders: async (snapshotId) => {
        const value = cloudFolders();
        await recordCloudSyncWrites(snapshotId, [
          { area: 'local', key: FOLDER_KEY, kind: 'folders', value },
        ]);
        await chrome.storage.local.set({ [FOLDER_KEY]: value });
        return true;
      },
    });
    await started.promise;
    current = false;
    release.resolve();

    expect(await applying).toMatchObject({
      status: 'cancelled',
      restored: [],
      snapshotId: expect.any(String),
    });
    expect(storedWithoutSnapshot()).toEqual(prior);
  });
});
