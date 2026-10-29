import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { createStarStore, type StarStore } from '@/features/savedLibrary/starStore';
import { createForkMessagesOwner } from '@/pages/background/forkMessages';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';
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
});
