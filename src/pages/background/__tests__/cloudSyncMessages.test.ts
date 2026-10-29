import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import type { ForkNode } from '@/pages/content/fork/forkTypes';

import { createCloudSyncMessageHandler } from '../cloudSyncMessages';
import { createForkMessagesOwner } from '../forkMessages';

const mocks = vi.hoisted(() => ({
  drive: {
    confirmAccountScope: vi.fn(),
    runExclusive: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    downloadPromptsOnly: vi.fn(),
    uploadPromptsOnly: vi.fn(),
    getState: vi.fn(),
    authenticate: vi.fn(),
    signOut: vi.fn(),
    setMode: vi.fn(),
    setProvider: vi.fn(),
  },
  isolation: { isIsolationEnabled: vi.fn(), resolveAccountScope: vi.fn() },
  highlights: { push: vi.fn(), pull: vi.fn(), requested: vi.fn(), notify: vi.fn() },
}));
vi.mock('@/core/services/GoogleDriveSyncService', () => ({ googleDriveSyncService: mocks.drive }));
vi.mock('@/core/services/AccountIsolationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/services/AccountIsolationService')>()),
  accountIsolationService: mocks.isolation,
}));
vi.mock('@/core/services/HighlightDriveSyncCoordinator', () => ({
  HighlightDriveSyncCoordinator: class {
    preparePush = async () => ({ ok: true, commit: mocks.highlights.push });
    push = mocks.highlights.push;
    pull = mocks.highlights.pull;
  },
}));
vi.mock('@/core/services/HighlightAnnotationService', () => ({
  getHighlightAccountHash: () => 'highlight-hash',
}));
vi.mock('../highlightMessages', () => ({
  isHighlightCloudSyncRequested: mocks.highlights.requested,
  notifyHighlightChanged: mocks.highlights.notify,
}));
vi.mock('@/core/services/SettingsBackupService', () => ({
  exportBackupableSyncSettings: async () => ({ data: { gvTheme: 'dark' } }),
}));
vi.mock('../queueOwners', async () => {
  const { createPromptLibraryOwner } = await import('@/features/prompt/library/promptLibraryOwner');
  return {
    promptLibraryOwner: createPromptLibraryOwner({
      area: {
        get: (key: string) => chrome.storage.local.get(key),
        set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
      },
    }),
  };
});

let stored: Record<string, unknown>;
const scope: SyncAccountScope = { accountKey: 'me@example.com', accountId: 2, routeUserId: '2' };
const state = { isAuthenticated: true, mode: 'manual' };
const folder = (name: string): FolderData => ({
  folders: [{ id: 'folder', name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 2 }],
  folderContents: {
    folder: [
      {
        conversationId: 'saved',
        title: name,
        url: 'https://gemini.google.com/u/2/app/saved',
        addedAt: 1,
      },
    ],
  },
});
const prompt = (id: string, name = id): PromptItem => ({
  id,
  name,
  text: `${id} body`,
  tags: [],
  createdAt: 1,
});
const sender = (url = 'https://gemini.google.com/u/2/app'): chrome.runtime.MessageSender => ({
  id: chrome.runtime.id,
  url,
  tab: { id: 7, url } as chrome.tabs.Tab,
});
const readers = () => ({
  getAllStarredMessages: vi.fn(async () => ({ messages: {} })),
  getAllForkNodes: vi.fn(async () => ({ nodes: {}, groups: {} })),
});

beforeEach(() => {
  vi.clearAllMocks();
  stored = {
    [StorageKeys.PLUGINS_STATE]: { 'voyager.test': { enabled: true, installedAt: 1 } },
    [StorageKeys.FOLDER_DATA]: folder('Gemini'),
    [StorageKeys.PROMPT_ITEMS]: [prompt('local')],
  };
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys: unknown) => {
    const names =
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
    return Object.fromEntries(
      names.filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])]),
    );
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    Object.assign(stored, structuredClone(items));
  });
  mocks.isolation.isIsolationEnabled.mockResolvedValue(false);
  mocks.isolation.resolveAccountScope.mockResolvedValue(scope);
  mocks.highlights.requested.mockResolvedValue(false);
  mocks.drive.runExclusive.mockImplementation((run) => run(mocks.drive));
  mocks.drive.upload.mockResolvedValue({ kind: 'uploaded' });
  mocks.drive.download.mockResolvedValue({ folders: folder('Cloud') });
  mocks.drive.uploadPromptsOnly.mockResolvedValue(true);
  mocks.drive.getState.mockResolvedValue(state);
});

describe('cloud sync messages', () => {
  it('uploads the entire prompt union, including duplicate names, after merging it into durable local storage', async () => {
    stored[StorageKeys.PROMPT_ITEMS] = [prompt('first', 'Review'), prompt('second', 'Review')];
    mocks.drive.downloadPromptsOnly.mockResolvedValue({
      kind: 'found',
      value: PromptImportExportService.exportToPayload([prompt('cloud')]),
    });
    const handle = createCloudSyncMessageHandler(readers());
    await expect(
      handle({ type: 'gv.sync.pushPromptsMerge', payload: { interactive: false } }, sender()),
    ).resolves.toEqual({ ok: true, count: 3, nameConflicts: 2, state });
    const expected = [prompt('cloud'), prompt('first', 'Review'), prompt('second', 'Review')];
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual(expected);
    expect(mocks.drive.uploadPromptsOnly).toHaveBeenCalledWith(expected, null, false, undefined);
    expect(vi.mocked(chrome.storage.local.set).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.drive.uploadPromptsOnly.mock.invocationCallOrder[0],
    );
  });

  it.each(['gemini', 'aistudio'] as const)(
    'uploads authoritative %s folders and prompts instead of caller-supplied snapshots',
    async (platform) => {
      const key = FOLDER_PLATFORMS[platform].folderStorageKey;
      const localFolders = folder(platform);
      stored[key] = JSON.stringify(localFolders);
      const localPrompts = [prompt('latest')];
      stored[StorageKeys.PROMPT_ITEMS] = localPrompts;
      const snapshots = readers();
      const handle = createCloudSyncMessageHandler(snapshots);
      await expect(
        handle(
          {
            type: 'gv.sync.upload',
            payload: {
              platform,
              folders: folder('stale'),
              prompts: [prompt('stale')],
              interactive: false,
            },
          },
          sender(platform === 'gemini' ? undefined : 'https://aistudio.google.com/u/2/prompts'),
        ),
      ).resolves.toEqual({ ok: true, highlights: undefined, state });
      expect(chrome.storage.local.get).toHaveBeenCalledWith([key, StorageKeys.PROMPT_ITEMS]);
      expect(mocks.drive.upload).toHaveBeenCalledWith(
        localFolders,
        localPrompts,
        platform === 'gemini' ? { messages: {} } : null,
        false,
        platform,
        platform === 'gemini' ? { nodes: {}, groups: {} } : null,
        platform === 'gemini' ? { conversations: {} } : null,
        null,
        null,
        { gvTheme: 'dark' },
        { 'voyager.test': { enabled: true, installedAt: 1 } },
        undefined,
        { force: false },
        undefined,
      );
      if (platform === 'aistudio') {
        expect(snapshots.getAllStarredMessages).not.toHaveBeenCalled();
        expect(snapshots.getAllForkNodes).not.toHaveBeenCalled();
      }
    },
  );

  it('uses scoped folder and hierarchy keys and filters Gemini stars/forks to the account route without losing unscoped URLs', async () => {
    mocks.isolation.isIsolationEnabled.mockResolvedValue(true);
    const folderKey = buildScopedStorageKey(StorageKeys.FOLDER_DATA, scope.accountKey);
    const timelineKey = buildScopedStorageKey(StorageKeys.TIMELINE_HIERARCHY, scope.accountKey);
    stored[folderKey] = folder('Account 2');
    const hierarchy = {
      conversationUrl: 'https://gemini.google.com/u/2/app/ours',
      levels: { t: 2 },
      collapsed: [],
      updatedAt: 7,
    };
    stored[timelineKey] = { conversations: { ours: hierarchy } };
    stored[StorageKeys.TIMELINE_HIERARCHY] = {
      conversations: {
        stale: { ...hierarchy, conversationUrl: 'https://gemini.google.com/u/1/app/stale' },
      },
    };
    const makeStar = (id: string, route: string) => ({
      conversationId: id,
      turnId: 't',
      content: id,
      starredAt: 1,
      conversationUrl: `https://gemini.google.com${route}/app/${id}`,
    });
    const ours = makeStar('ours', '/u/2');
    const legacy = makeStar('legacy', '');
    const other = makeStar('other', '/u/1');
    const makeNode = (value: typeof ours) => ({
      ...value,
      forkGroupId: 'g',
      forkIndex: 0,
      createdAt: 1,
    });
    const snapshots = {
      getAllStarredMessages: async () => ({
        messages: { ours: [ours], legacy: [legacy], other: [other] },
      }),
      getAllForkNodes: async () => ({
        nodes: { ours: [makeNode(ours)], legacy: [makeNode(legacy)], other: [makeNode(other)] },
        groups: { g: ['ours:t', 'legacy:t', 'other:t'] },
      }),
    };
    await createCloudSyncMessageHandler(snapshots)(
      {
        type: 'gv.sync.upload',
        payload: {
          platform: 'gemini',
          accountScope: scope,
          timelineHierarchyAccountScope: scope,
        },
      },
      sender(),
    );
    expect(chrome.storage.local.get).toHaveBeenCalledWith([folderKey, StorageKeys.PROMPT_ITEMS]);
    expect(chrome.storage.local.get).toHaveBeenCalledWith([
      timelineKey,
      StorageKeys.TIMELINE_HIERARCHY,
    ]);
    expect(mocks.drive.upload).toHaveBeenCalledWith(
      folder('Account 2'),
      [prompt('local')],
      { messages: { ours: [ours], legacy: [legacy] } },
      true,
      'gemini',
      {
        nodes: { ours: [makeNode(ours)], legacy: [makeNode(legacy)] },
        groups: { g: ['ours:t', 'legacy:t'] },
      },
      { conversations: { ours: hierarchy } },
      scope,
      scope,
      { gvTheme: 'dark' },
      { 'voyager.test': { enabled: true, installedAt: 1 } },
      undefined,
      { force: false },
      undefined,
    );
    expect(mocks.isolation.resolveAccountScope).not.toHaveBeenCalled();
  });

  it('rejects wrong-host, wrong-extension and unknown-platform uploads before reading private storage or contacting Drive', async () => {
    const handle = createCloudSyncMessageHandler(readers());
    for (const [payload, origin] of [
      [{ platform: 'gemini' }, sender('https://chatgpt.com/c/one')],
      [{ platform: 'gemini' }, { ...sender(), id: 'foreign-extension' }],
      [{ platform: 'aistudio' }, sender()],
      [{ platform: 'unknown' }, sender()],
    ] as const) {
      await expect(handle({ type: 'gv.sync.upload', payload }, origin)).resolves.toEqual({
        ok: false,
        error: 'untrusted_sender',
      });
    }
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(mocks.drive.upload).not.toHaveBeenCalled();
  });

  it('stops before upload on invalid authoritative data, rather than replacing it with the caller snapshot', async () => {
    stored[StorageKeys.PROMPT_ITEMS] = { broken: true };
    await expect(
      createCloudSyncMessageHandler(readers())(
        {
          type: 'gv.sync.upload',
          payload: {
            platform: 'gemini',
            folders: folder('caller'),
            prompts: [],
          },
        },
        sender(),
      ),
    ).rejects.toThrow('Local prompt data is invalid');
    expect(mocks.drive.upload).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('reports a partial highlight upload only after the main payload lands and sends no success notification', async () => {
    mocks.highlights.requested.mockResolvedValue(true);
    mocks.highlights.push.mockResolvedValue({ ok: false, error: 'highlight_failed' });
    const handle = createCloudSyncMessageHandler(readers());
    await expect(
      handle(
        {
          type: 'gv.sync.upload',
          payload: { platform: 'gemini', highlightAccountScope: scope, includeHighlights: true },
        },
        sender(),
      ),
    ).resolves.toEqual({ ok: false, partial: true, error: 'highlight_failed', state });
    expect(mocks.drive.upload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.highlights.push.mock.invocationCallOrder[0],
    );
    expect(mocks.highlights.notify).not.toHaveBeenCalled();
  });

  it('returns downloaded data for the popup merge without writing storage, and blocks a cross-product sender URL fallback', async () => {
    const handle = createCloudSyncMessageHandler(readers());
    await expect(
      handle(
        { type: 'gv.sync.download', payload: { platform: 'gemini', interactive: false } },
        sender(),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { folders: folder('Cloud') },
      highlights: undefined,
      state,
    });
    expect(mocks.drive.download).toHaveBeenCalledWith(false, 'gemini', null, null);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    mocks.drive.download.mockClear();
    await expect(
      handle(
        { type: 'gv.sync.download', payload: { platform: 'gemini' } },
        { tab: {} as chrome.tabs.Tab, url: 'https://claude.ai/chat/one' },
      ),
    ).resolves.toEqual({ ok: false, error: 'unsupported_sync_platform' });
    expect(mocks.drive.download).not.toHaveBeenCalled();
  });
  it('a failed star download is reported as a failure instead of an empty backup', async () => {
    mocks.drive.download.mockResolvedValue(null);
    mocks.drive.getState.mockResolvedValue({ ...state, error: 'Invalid stars v2 envelope' });
    await expect(
      createCloudSyncMessageHandler(readers())(
        { type: 'gv.sync.download', payload: { platform: 'gemini' } },
        sender(),
      ),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid stars v2 envelope' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('a fork restored on a device where the same account has another /u/ index opens under that index', async () => {
    const fork = (conversationId: string, route: string, forkIndex: number): ForkNode => ({
      conversationId,
      turnId: 'turn',
      forkGroupId: 'group',
      forkIndex,
      createdAt: 1,
      conversationUrl: `https://gemini.google.com/u/${route}/app/${conversationId}?hl=en`,
    });
    mocks.isolation.isIsolationEnabled.mockResolvedValue(true);
    stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, scope.accountKey)] = folder('Gemini');
    const deviceA = createCloudSyncMessageHandler({
      ...readers(),
      getAllForkNodes: vi.fn(async () => ({
        nodes: { source: [fork('source', '0', 0)], branch: [fork('branch', '0', 1)] },
        groups: { group: ['source:turn', 'branch:turn'] },
      })),
    });
    const sameAccount = (routeUserId: string) => ({ ...scope, routeUserId });
    await deviceA(
      { type: 'gv.sync.upload', payload: { platform: 'gemini', accountScope: sameAccount('0') } },
      sender('https://gemini.google.com/u/0/app'),
    );
    const uploaded = mocks.drive.upload.mock.calls[0][5];
    mocks.drive.download.mockResolvedValue({
      forks: { format: 'gemini-voyager.forks.v1', exportedAt: '', data: uploaded },
    });

    const download = async (accountScope: SyncAccountScope) =>
      (await createCloudSyncMessageHandler(readers())(
        { type: 'gv.sync.download', payload: { platform: 'gemini', accountScope } },
        sender(`https://gemini.google.com/u/${accountScope.routeUserId}/app`),
      )) as { data: { forks: unknown } };
    let restored: unknown;
    const deviceB = createForkMessagesOwner({
      get: async () => ({}),
      set: async (items) => {
        restored = items[StorageKeys.FORK_NODES];
      },
    });
    await deviceB.handle({
      type: 'gv.fork.mergeCloud',
      payload: (await download(sameAccount('1'))).data.forks,
    });
    expect(restored).toEqual({
      nodes: { source: [fork('source', '1', 0)], branch: [fork('branch', '1', 1)] },
      groups: { group: ['source:turn', 'branch:turn'] },
    });

    // An unfiltered upload mixes accounts, so its routes cannot be attributed.
    const mixed = { nodes: { a: [fork('a', '0', 0)], b: [fork('b', '3', 1)] }, groups: {} };
    mocks.drive.download.mockResolvedValue({
      forks: { format: 'gemini-voyager.forks.v1', exportedAt: '', data: mixed },
    });
    expect((await download(sameAccount('1'))).data.forks).toMatchObject({ data: mixed });
  });
});
