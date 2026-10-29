import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';
import { createStarStore, type StarStore } from '@/features/savedLibrary/starStore';
import { createForkMessagesOwner } from '@/pages/background/forkMessages';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';
import type { ForkNode } from '@/pages/content/fork/forkTypes';

import { FolderDataSession } from '../FolderDataSession';
import { FolderTransferController } from '../FolderTransferController';
import type { FolderData } from '../types';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
let stored: Record<string, unknown>;
let owner: StarStore;
let forkOwner: ReturnType<typeof createForkMessagesOwner>;
let localGet: ReturnType<typeof vi.fn<(keys: unknown) => Promise<Record<string, unknown>>>>;
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendMessage } } }));
vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) =>
    key === 'syncRestorePartial'
      ? 'Restored: {restored}. Not restored: {failed}'
      : key === 'syncRestoreListSeparator'
        ? '、'
        : key,
}));

const emptyData = (): FolderData => ({ folders: [], folderContents: {} });
const importedData = (): FolderData => ({
  folders: [
    {
      id: 'coding',
      name: 'Coding',
      instructions: 'Use TypeScript.',
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: {
    coding: [
      {
        conversationId: 'c_abc',
        title: 'Code review',
        url: 'https://gemini.google.com/u/1/app/abc',
        addedAt: 1,
      },
    ],
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(data = emptyData()) {
  const session = new FolderDataSession('gvFolderData', 'transfer-test', null, () => true);
  session.data = data;
  session.ready = true;
  let activation = 1;
  const applyData = vi.fn(async (next: FolderData) => {
    session.data = next;
    return true;
  });
  const refresh = vi.fn();
  const notify = vi.fn();
  const transfer = new FolderTransferController({
    getContext: () => ({ session, activation, data: session.data }),
    applyData,
    refresh,
    notify,
  });
  return {
    session,
    transfer,
    applyData,
    refresh,
    notify,
    leaveAndReturn: () => {
      activation += 2;
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  sendMessage.mockReset();
  stored = {};
  localGet = vi.fn(async (keys: unknown) => {
    const names = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      names.map((name) => [String(name), structuredClone(stored[String(name)])]),
    );
  });
  chrome.storage.local.get = localGet as typeof chrome.storage.local.get;
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    Object.assign(stored, structuredClone(items));
  });
  owner = createStarStore({
    get: (keys) => localGet(keys),
    set: (items) => chrome.storage.local.set(items),
  });
  forkOwner = createForkMessagesOwner({
    get: (keys) => localGet(keys),
    set: (items) => chrome.storage.local.set(items),
  });
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: { type: string; payload?: unknown },
    reply: (response: unknown) => void,
  ) => {
    void (
      forkOwner.handle(message) ??
      createStarredMessagesHandler(owner)(message, {
        id: chrome.runtime.id,
        tab: { url: 'https://gemini.google.com/app/abc' } as chrome.tabs.Tab,
      })
    )?.then(
      (result) => reply({ ok: true, ...result }),
      (error: Error) => reply({ ok: false, error: error.message }),
    );
  }) as typeof chrome.runtime.sendMessage);
});

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('folder cloud transfer commands', () => {
  it.each(['folders', 'other data'] as const)(
    'does not report a cloud merge when saving %s fails',
    async (part) => {
      const h = harness();
      sendMessage.mockResolvedValue({ ok: true, data: { folders: { data: importedData() } } });
      if (part === 'folders') h.applyData.mockResolvedValue(false);
      else vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Quota exceeded'));

      await h.transfer.sync();

      const [message, tone] = h.notify.mock.lastCall!;
      expect(tone).toBe('error');
      // The generic failure (with a reason line when one is known), never the raw diagnostic.
      expect(message).toMatch(part === 'folders' ? /^folder_save_error$/ : /^syncDownloadFailed/);
      expect(message).not.toContain('Quota exceeded');
      expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
      expect(h.refresh).not.toHaveBeenCalled();
    },
  );

  it('keeps a pending local edit intact while requesting a site-only upload', async () => {
    const h = harness(importedData());
    const pending = deferred<Record<string, unknown>>();
    localGet.mockReturnValueOnce(pending.promise);
    sendMessage.mockResolvedValue({ ok: true });
    const uploading = h.transfer.upload();
    h.session.data.folders[0].name = 'Edited during upload';
    pending.resolve({ gvPromptItems: [] });
    await uploading;
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
        payload: expect.objectContaining({ platform: 'gemini', selection: 'site' }),
      }),
    );
    expect(h.session.data.folders[0].name).toBe('Edited during upload');
  });

  it('does not upload after leaving and returning to the same account session', async () => {
    const h = harness(importedData());
    const pending = deferred<Record<string, unknown>>();
    const started = deferred<void>();
    localGet.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const uploading = h.transfer.upload();
    await started.promise;
    h.leaveAndReturn();
    pending.resolve({ gvPromptItems: [] });
    await uploading;
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('merges downloaded folders and stars while leaving shared prompts untouched', async () => {
    const h = harness();
    const localPrompt = {
      id: 'p1',
      name: 'Keep local name',
      text: 'local',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const cloudPrompt = { id: 'p1', text: 'cloud update', tags: [], createdAt: 1, updatedAt: 2 };
    const localStar = { turnId: 'turn1', title: 'Local tie winner' };
    stored[StorageKeys.PROMPT_ITEMS] = [localPrompt];
    stored[StorageKeys.TIMELINE_STARRED_MESSAGES] = { messages: { abc: [null, {}, localStar] } };
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        prompts: { items: [cloudPrompt] },
        starred: {
          format: 'gemini-voyager.starred.v1',
          data: {
            messages: {
              abc: [
                { turnId: 'turn1', title: 'Cloud' },
                { turnId: 'turn2', starredAt: 3 },
              ],
            },
          },
        },
      },
    });
    await h.transfer.sync();
    expect(h.session.data).toEqual(importedData());
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([localPrompt]);
    const stars = await owner.getAll();
    expect(stars.messages.abc).toEqual([
      expect.objectContaining(localStar),
      expect.objectContaining({ turnId: 'turn2', starredAt: 3 }),
    ]);
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenLastCalledWith('downloadMergeSuccess', 'success');
  });

  it('a v2-only in-page download restores full text and applies cloud deletions', async () => {
    const h = harness();
    const deleted = {
      conversationId: 'gemini:conv:old',
      turnId: 'old',
      content: 'Old',
      conversationUrl: 'https://gemini.google.com/app/old',
      starredAt: 5,
    };
    const cloud = {
      ...deleted,
      conversationId: 'gemini:conv:new',
      turnId: 'new',
      conversationUrl: 'https://gemini.google.com/app/new',
      text: 'Full\ntext',
    };
    stored[StorageKeys.SAVED_LIBRARY_STARS] = { messages: { [deleted.conversationId]: [deleted] } };
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        stars: {
          format: 'gemini-voyager.stars.v2',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          items: [cloud],
          tombstones: [
            {
              conversationId: deleted.conversationId,
              turnId: deleted.turnId,
              conversationUrl: deleted.conversationUrl,
              starredAt: deleted.starredAt,
              deletedAt: Date.now(),
            },
          ],
        },
      },
    });
    await h.transfer.sync();
    expect((await owner.getAll()).messages).toEqual({ [cloud.conversationId]: [cloud] });
    expect(h.notify).toHaveBeenLastCalledWith('downloadMergeSuccess', 'success');
  });

  it('a scoped old-version re-star survives in-page restore from another account slot', async () => {
    const h = harness();
    h.session.accountScope = {
      accountKey: 'person',
      accountId: 1,
      routeUserId: '1',
      emailHash: null,
    };
    const cloud = {
      conversationId: 'gemini:conv:peer',
      turnId: 'turn',
      content: 'Peer',
      conversationUrl: 'https://gemini.google.com/u/0/app/peer',
      starredAt: 60,
    };
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        starred: {
          format: 'gemini-voyager.starred.v1',
          data: { messages: { [cloud.conversationId]: [cloud] } },
        },
        starredAccountHash: hashString('person'),
        stars: {
          format: 'gemini-voyager.stars.v2',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          accountScope: { accountHash: hashString('person') },
          items: [],
          tombstones: [
            {
              conversationId: cloud.conversationId,
              turnId: cloud.turnId,
              conversationUrl: cloud.conversationUrl,
              starredAt: 50,
              deletedAt: Date.now(),
            },
          ],
        },
      },
    });
    await h.transfer.sync();
    expect((await owner.getAll()).messages).toEqual({
      [cloud.conversationId]: [
        {
          ...cloud,
          conversationUrl: 'https://gemini.google.com/u/1/app/peer',
        },
      ],
    });
    expect(h.notify).toHaveBeenLastCalledWith('downloadMergeSuccess', 'success');
  });

  it('reports the completed folder merge when the star owner cannot persist', async () => {
    const h = harness();
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      },
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.TIMELINE_STARRED_MESSAGES in items) throw new Error('stars write failed');
      Object.assign(stored, items);
    });
    await h.transfer.sync();
    expect(h.session.data).toEqual(importedData());
    expect(stored[StorageKeys.PROMPT_ITEMS]).toBeUndefined();
    expect(h.notify).toHaveBeenLastCalledWith(
      'Restored: folder_title. Not restored: savedLibraryStars',
      'error',
    );
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('a fork uploaded on one device is restored by the in-page sync on another', async () => {
    const h = harness();
    const fork = (conversationId: string, forkIndex: number): ForkNode => ({
      conversationId,
      turnId: 'turn',
      forkGroupId: 'group',
      forkIndex,
      createdAt: 1,
      conversationUrl: `https://gemini.google.com/u/1/app/${conversationId}`,
    });
    const local = fork('local', 0);
    const cloud = fork('cloud', 1);
    stored[StorageKeys.FORK_NODES] = {
      nodes: { local: [local] },
      groups: { group: ['local:turn'] },
    };
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        forks: {
          format: 'gemini-voyager.forks.v1',
          data: { nodes: { cloud: [cloud] }, groups: { group: ['cloud:turn'] } },
        },
      },
    });
    await h.transfer.sync();
    expect(await forkOwner.getAllForkNodes()).toEqual({
      nodes: { local: [local], cloud: [cloud] },
      groups: { group: ['local:turn', 'cloud:turn'] },
    });
    expect(h.notify).toHaveBeenLastCalledWith('downloadMergeSuccess', 'success');
  });

  it('names forks as not restored when the fork owner cannot persist', async () => {
    const h = harness();
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
        forks: {
          format: 'gemini-voyager.forks.v1',
          data: {
            nodes: {
              c: [
                {
                  conversationId: 'c',
                  turnId: 't',
                  forkGroupId: 'g',
                  forkIndex: 0,
                  createdAt: 1,
                  conversationUrl: 'https://gemini.google.com/app/c',
                },
              ],
            },
            groups: {},
          },
        },
      },
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.FORK_NODES in items) throw new Error('forks write failed');
      Object.assign(stored, items);
    });
    await h.transfer.sync();
    expect(h.notify).toHaveBeenLastCalledWith(
      'Restored: folder_title、savedLibraryStars. Not restored: syncRestoreForks',
      'error',
    );
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('leaves stars untouched when the account changes while folders save', async () => {
    const h = harness();
    stored[StorageKeys.TIMELINE_STARRED_MESSAGES] = { messages: {} };
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        folders: { data: importedData() },
        starred: {
          format: 'gemini-voyager.starred.v1',
          data: { messages: { abc: [{ turnId: 'new' }] } },
        },
      },
    });
    h.applyData.mockImplementation(async () => {
      h.leaveAndReturn();
      return true;
    });
    await h.transfer.sync();
    expect((await owner.getAll()).messages).toEqual({});
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
  });
});
