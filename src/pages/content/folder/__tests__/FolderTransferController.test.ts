import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { createStarStore, type StarStore } from '@/features/savedLibrary/starStore';
import { createForkMessagesOwner } from '@/pages/background/forkMessages';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';
import type { ForkNode } from '@/pages/content/fork/forkTypes';
import { confirmDriver } from '@/tests/confirmDriver';

import { FolderDataSession } from '../FolderDataSession';
import { FolderTransferController } from '../FolderTransferController';
import type { ImportSource } from '../folderTransferHost';
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
      ? 'Restored: {restored}. Not restored: {failed} ({error})'
      : key === 'syncRestoreListSeparator'
        ? '、'
        : key,
}));

const emptyData = (): FolderData => ({ folders: [], folderContents: {} });
/** The pre-import snapshot an import keeps for this tab (`.github/docs/IMPORT_EXPORT_GUIDE.md`). */
const preImportSnapshot = () => sessionStorage.getItem('gvFolderBackup');
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

/** Runs an overwrite import from the page, answering its confirm with `answer`. */
async function overwrite(
  h: ReturnType<typeof harness>,
  source: ImportSource,
  answer = 'folder_import_overwrite',
): Promise<boolean> {
  const run = h.transfer.import(source, 'overwrite', document.body);
  expect(confirmDriver.message()).toBe('folder_import_confirm_overwrite');
  confirmDriver.answer(answer);
  return run;
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

describe('folder transfer commands', () => {
  it.each(['file', 'text'] as const)(
    'imports %s through the same merge and keeps a restorable backup',
    async (kind) => {
      const local = importedData();
      local.folders[0].id = 'local';
      local.folderContents = { local: [] };
      const h = harness(local);
      const text = JSON.stringify(FolderImportExportService.exportToPayload(importedData()));
      const file = new File([text], 'folders.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: async () => text });
      await h.transfer.import(kind === 'text' ? { text } : { file }, 'merge', document.body);

      expect(h.session.data.folders.map((folder) => folder.id)).toEqual(['local', 'coding']);
      expect(h.session.data.folders[1].instructions).toBe('Use TypeScript.');
      expect(h.session.data.folderContents.coding[0].url).toBe(
        'https://gemini.google.com/u/1/app/abc',
      );
      expect(local.folders).toHaveLength(1);
      expect(h.applyData).toHaveBeenCalledOnce();
      expect(h.refresh).toHaveBeenCalledOnce();
      expect(JSON.parse(preImportSnapshot()!)).toEqual(local);
    },
  );

  it('undoes an overwrite when its pre-import snapshot is pasted back, as the import guide shows', async () => {
    const h = harness(importedData());
    const replacement = JSON.stringify(FolderImportExportService.exportToPayload(emptyData()));
    expect(await overwrite(h, { text: replacement })).toBe(true);
    expect(h.session.data).toEqual(emptyData());

    // The guide's console step: wrap the snapshot as a folder file and paste it with Overwrite.
    const text = JSON.stringify({
      format: 'gemini-voyager.folders.v1',
      data: JSON.parse(preImportSnapshot()!),
    });
    expect(await overwrite(h, { text })).toBe(true);

    expect(h.session.data).toEqual(importedData());
  });

  it.each(['merge', 'overwrite'] as const)(
    'refuses to %s a folder file ChatGPT exported',
    async (strategy) => {
      const h = harness(importedData());
      const chatgpt = {
        conversationId: 'chatgpt:conv:abc',
        title: 'Trip plan',
        url: 'https://chatgpt.com/c/abc',
        addedAt: 1,
      };
      const text = JSON.stringify({
        ...FolderImportExportService.exportToPayload({
          folders: [],
          folderContents: { __root_conversations__: [chatgpt] },
        }),
        platform: 'chatgpt',
      });

      const imported =
        strategy === 'overwrite'
          ? overwrite(h, { text })
          : h.transfer.import({ text }, strategy, document.body);
      expect(await imported).toBe(false);

      expect(h.notify).toHaveBeenCalledWith('folder_import_wrong_site', 'error');
      expect(h.session.data).toEqual(importedData());
      expect(h.applyData).not.toHaveBeenCalled();
      expect(preImportSnapshot()).toBeNull();
    },
  );

  it('refuses a folder whose id every object inherits', async () => {
    const h = harness(importedData());
    const text = JSON.stringify(
      FolderImportExportService.exportToPayload({
        folders: [{ ...importedData().folders[0], id: '__proto__' }],
        folderContents: {},
      }),
    );

    expect(await h.transfer.import({ text }, 'merge', document.body)).toBe(false);

    expect(h.session.data).toEqual(importedData());
    expect(h.applyData).not.toHaveBeenCalled();
  });

  /** Folders on a parent cycle, each with a conversation of its own. */
  function cyclic(links: readonly (readonly [string, string])[]): FolderData {
    const [template] = importedData().folders;
    const [chat] = importedData().folderContents.coding;
    return {
      folders: links.map(([id, parentId]) => ({ ...template, id, name: id, parentId })),
      folderContents: Object.fromEntries(
        links.map(([id]) => [id, [{ ...chat, conversationId: `c_${id}`, title: id }]]),
      ),
    };
  }
  const cut = (data: FolderData, id: string): FolderData => ({
    ...data,
    folders: data.folders.map((folder) =>
      folder.id === id ? { ...folder, parentId: null } : folder,
    ),
  });

  it.each([
    ['its own parent', [['a', 'a']], 'a'],
    [
      'a pair of folders',
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
      'a',
    ],
  ] as const)(
    'imports a file where a folder is inside itself through %s, with that folder at the root',
    async (_kind, links, cutId) => {
      const file = cyclic(links);
      const text = JSON.stringify(FolderImportExportService.exportToPayload(file));

      const merging = harness(importedData());
      expect(await merging.transfer.import({ text }, 'merge', document.body)).toBe(true);
      expect(merging.session.data).toEqual({
        folders: [...importedData().folders, ...cut(file, cutId).folders],
        folderContents: { ...importedData().folderContents, ...file.folderContents },
      });

      const replacing = harness(importedData());
      expect(await overwrite(replacing, { text })).toBe(true);
      expect(replacing.session.data).toEqual(cut(file, cutId));
    },
  );

  it('imports its own export of stored data whose parents form a cycle', async () => {
    const stored = cyclic([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const h = harness(structuredClone(stored));
    const download = vi
      .spyOn(FolderImportExportService, 'downloadJSON')
      .mockImplementation(() => undefined);

    h.transfer.exportFolders();
    const [exported] = download.mock.calls[0];
    expect(await overwrite(h, { text: JSON.stringify(exported) })).toBe(true);

    expect(h.session.data).toEqual(cut(stored, 'a'));
  });

  it('cancels an overwrite without changing the current data or backup', async () => {
    const h = harness(importedData());
    const text = JSON.stringify(FolderImportExportService.exportToPayload(emptyData()));
    expect(confirmDriver.isOpen()).toBe(false);
    expect(await overwrite(h, { text }, 'pm_cancel')).toBe(false);
    expect(h.session.data).toEqual(importedData());
    expect(h.applyData).not.toHaveBeenCalled();
    expect(preImportSnapshot()).toBeNull();
  });

  it('asks beside the Import button before an overwrite, and keeps the dialog open on Cancel', async () => {
    const h = harness(importedData());
    h.transfer.showImportDialog();
    document.querySelector<HTMLInputElement>('input[value="overwrite"]')!.checked = true;
    document.querySelector<HTMLTextAreaElement>('.gv-folder-import-paste-area')!.value =
      JSON.stringify(FolderImportExportService.exportToPayload(emptyData()));
    const save = document.querySelector<HTMLButtonElement>('.gv-folder-dialog-btn-primary')!;
    save.click();

    expect(confirmDriver.message()).toBe('folder_import_confirm_overwrite');
    expect(confirmDriver.focusedLabel()).toBe('pm_cancel');
    confirmDriver.answer('pm_cancel');
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(h.applyData).not.toHaveBeenCalled();

    save.click();
    confirmDriver.answer('folder_import_overwrite');
    await vi.waitFor(() => expect(h.applyData).toHaveBeenCalledOnce());
    expect(h.session.data).toEqual(emptyData());
    expect(document.querySelector('.gv-folder-dialog-overlay')).toBeNull();
  });

  it('drops an overwrite whose account changed while it asked', async () => {
    const h = harness(importedData());
    const text = JSON.stringify(FolderImportExportService.exportToPayload(emptyData()));
    const run = h.transfer.import({ text }, 'overwrite', document.body);
    h.leaveAndReturn();
    confirmDriver.answer('folder_import_overwrite');

    expect(await run).toBe(false);
    expect(h.applyData).not.toHaveBeenCalled();
    expect(preImportSnapshot()).toBeNull();
  });

  it('submits pasted JSON from the import dialog and closes its overlay', async () => {
    const h = harness();
    h.transfer.showImportDialog();
    document.querySelector<HTMLButtonElement>('.gv-folder-import-paste-toggle')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('.gv-folder-import-paste-area')!;
    expect(input.style.display).toBe('block');
    input.value = JSON.stringify(FolderImportExportService.exportToPayload(importedData()));
    document.querySelector<HTMLButtonElement>('.gv-folder-dialog-btn-primary')!.click();
    await vi.waitFor(() => expect(h.applyData).toHaveBeenCalledOnce());
    expect(h.session.data).toEqual(importedData());
    expect(document.querySelector('.gv-folder-dialog-overlay')).toBeNull();
  });

  it('shares the in-flight import guard between file and text sources, then releases it', async () => {
    const h = harness();
    const text = JSON.stringify(FolderImportExportService.exportToPayload(importedData()));
    const pending = deferred<string>();
    const file = new File([], 'folders.json');
    Object.defineProperty(file, 'text', { value: () => pending.promise });
    const first = h.transfer.import({ file }, 'merge', document.body);
    await h.transfer.import({ text }, 'merge', document.body);
    expect(h.applyData).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith('folder_import_in_progress', 'info');
    pending.resolve(text);
    await first;
    await h.transfer.import({ text }, 'merge', document.body);
    expect(h.applyData).toHaveBeenCalledTimes(2);
    expect(h.session.data.folderContents.coding).toHaveLength(1);
  });

  it('keeps the import draft until persistence succeeds and allows retry after failure', async () => {
    const h = harness();
    const pending = deferred<boolean>();
    h.applyData.mockReturnValueOnce(pending.promise);
    h.transfer.showImportDialog();
    const input = document.querySelector<HTMLTextAreaElement>('.gv-folder-import-paste-area')!;
    const text = JSON.stringify(FolderImportExportService.exportToPayload(importedData()));
    input.value = text;
    const save = document.querySelector<HTMLButtonElement>('.gv-folder-dialog-btn-primary')!;
    save.click();
    save.click();
    await vi.waitFor(() => expect(h.applyData).toHaveBeenCalledOnce());
    expect(save.disabled).toBe(true);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    pending.resolve(false);
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe(text);
    expect(h.notify).toHaveBeenLastCalledWith('folder_save_error', 'error');
    save.click();
    await vi.waitFor(() => expect(input.isConnected).toBe(false));
    expect(h.applyData).toHaveBeenCalledTimes(2);
    expect(h.notify).toHaveBeenLastCalledWith('folder_import_success', 'success');
  });

  it('does not report an old import save or close the next account dialog', async () => {
    const h = harness();
    const pending = deferred<boolean>();
    h.applyData.mockReturnValueOnce(pending.promise);
    h.transfer.showImportDialog();
    document.querySelector<HTMLTextAreaElement>('.gv-folder-import-paste-area')!.value =
      JSON.stringify(FolderImportExportService.exportToPayload(importedData()));
    document.querySelector<HTMLButtonElement>('.gv-folder-dialog-btn-primary')!.click();
    await vi.waitFor(() => expect(h.applyData).toHaveBeenCalledOnce());
    h.leaveAndReturn();
    h.transfer.closeImportDialog();
    h.transfer.showImportDialog();
    const next = document.querySelector('.gv-folder-dialog-overlay')!;
    pending.resolve(true);
    await pending.promise;
    await Promise.resolve();
    expect(next.isConnected).toBe(true);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each(['folders', 'other data'] as const)(
    'does not report a cloud merge when saving %s fails',
    async (part) => {
      const h = harness();
      sendMessage.mockResolvedValue({ ok: true, data: { folders: { data: importedData() } } });
      if (part === 'folders') h.applyData.mockResolvedValue(false);
      else vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Quota exceeded'));

      await h.transfer.sync();

      expect(h.notify).toHaveBeenLastCalledWith(
        part === 'folders' ? 'folder_save_error' : 'syncError',
        'error',
      );
      expect(h.notify).not.toHaveBeenCalledWith('downloadMergeSuccess', 'success');
      expect(h.refresh).not.toHaveBeenCalled();
    },
  );

  it('uploads the captured folder snapshot even when live data changes before prompt loading finishes', async () => {
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
        payload: expect.objectContaining({ folders: importedData() }),
      }),
    );
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

  it('merges downloaded folders, legacy prompts and tolerant starred messages through the real command', async () => {
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
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([{ ...cloudPrompt, name: 'Keep local name' }]);
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
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(h.notify).toHaveBeenLastCalledWith(
      'Restored: folder_title、promptDataMigration. Not restored: savedLibraryStars (stars write failed)',
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
      'Restored: folder_title、promptDataMigration、savedLibraryStars. ' +
        'Not restored: syncRestoreForks (forks write failed)',
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
