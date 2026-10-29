import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataBackupService } from '@/core/services/DataBackupService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { validateFolderData } from '@/features/folder/model/folderData';
import { exportChatGptFolders } from '@/features/folder/sites/chatgptTransfer';
import { applyCloudRestore } from '@/pages/popup/components/cloudRestore';
import { useCloudSyncTransfer } from '@/pages/popup/components/useCloudSyncTransfer';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import type { SiteFoldersStore } from '../../types';
import { commandsOf, createChatGptStore } from './chatgptSite';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    get runtime() {
      return globalThis.chrome.runtime;
    },
  },
}));

function data(name: string): FolderData {
  return {
    folders: [
      {
        id: 'folder',
        name,
        parentId: null,
        isExpanded: true,
        sortIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folderContents: { folder: [] },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function restore(snapshot: FolderData, mode: 'merge' | 'overwrite' = 'overwrite') {
  await applyCloudRestore({
    mode,
    highlightsRestored: false,
    plugins: undefined,
    settings: undefined,
    storageUpdate: { [StorageKeys.FOLDER_DATA_CHATGPT]: snapshot },
    snapshot: { source: 'popup-restore', platform: 'chatgpt', accountScope: null },
  });
}

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let store: SiteFoldersStore | null;

beforeEach(() => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  localStorage.clear();
  memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, data('Initial'));
  memory.values.local.set(StorageKeys.FOLDER_DATA, data('Gemini'));
  memory.values.local.set(StorageKeys.FOLDER_DATA_AISTUDIO, data('AI Studio'));
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED, true);
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
});

afterEach(() => {
  store?.destroy();
  store = null;
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

async function ready() {
  store = createChatGptStore();
  await store.init();
  await settle();
  return commandsOf(store);
}

const stored = () => memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT);

function expectOtherPlatformsIntact() {
  expect(memory.values.local.get(StorageKeys.FOLDER_DATA)).toEqual(data('Gemini'));
  expect(memory.values.local.get(StorageKeys.FOLDER_DATA_AISTUDIO)).toEqual(data('AI Studio'));
  expect(memory.values.sync.has(StorageKeys.FOLDER_DATA_CHATGPT)).toBe(false);
}

describe('ChatGPT popup restore and the open folder store', () => {
  it.each(['merge', 'overwrite'] as const)(
    'picks up a popup %s through storage changes without a tab reload',
    async (mode) => {
      const commands = await ready();
      const views: string[] = [];
      store!.subscribe(() => views.push(commands.view().folders[0].name));

      await restore(data('From Drive'), mode);
      await settle(30);

      expect(commands.view()).toEqual(data('From Drive'));
      expect(views).toContain('From Drive');
      expect(stored()).toEqual(data('From Drive'));
      expectOtherPlatformsIntact();
    },
  );

  it('keeps queued edits visible during restores and reconciles after the save chain settles', async () => {
    const commands = await ready();
    const first = deferred();
    const queued = deferred();
    const write = memory.api.local.set.bind(memory.api.local);
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items) => {
      await write(items);
      const snapshot = (items as Record<string, unknown>)[StorageKeys.FOLDER_DATA_CHATGPT] as
        | FolderData
        | undefined;
      if (snapshot?.folders[0].name === 'Local first') await first.promise;
      if (snapshot?.folders[0].name === 'Local queued') await queued.promise;
    });

    await commands.run({ kind: 'renameFolder', folderId: 'folder', name: 'Local first' });
    await commands.run({ kind: 'renameFolder', folderId: 'folder', name: 'Local queued' });
    await restore(data('Cloud during first save'));
    await settle(30);
    expect(commands.view().folders[0].name).toBe('Local queued');

    first.resolve();
    await settle(30);
    expect((stored() as FolderData).folders[0].name).toBe('Local queued');
    await restore(data('Cloud during queued save'));
    await settle(30);
    expect(commands.view().folders[0].name).toBe('Local queued');

    queued.resolve();
    await settle(40);
    expect(commands.view()).toEqual(data('Cloud during queued save'));
    expect(stored()).toEqual(data('Cloud during queued save'));
    expectOtherPlatformsIntact();
  });

  it('a stale external read cannot replace an edit made while that read was pending', async () => {
    const commands = await ready();
    const readPending = deferred();
    const get = memory.api.local.get.bind(memory.api.local);
    let held = false;
    vi.spyOn(memory.api.local, 'get').mockImplementation((async (
      keys: string | string[] | Record<string, unknown> | null,
    ) => {
      const result = await get(keys);
      if (keys === StorageKeys.FOLDER_DATA_CHATGPT && !held) {
        held = true;
        await readPending.promise;
      }
      return result;
    }) as typeof memory.api.local.get);

    await restore(data('Older cloud snapshot'));
    await settle(20);
    await commands.run({ kind: 'renameFolder', folderId: 'folder', name: 'Newer local edit' });
    await settle(20);
    readPending.resolve();
    await settle(40);

    expect(commands.view().folders[0].name).toBe('Newer local edit');
    expect((stored() as FolderData).folders[0].name).toBe('Newer local edit');
    expectOtherPlatformsIntact();
  });

  it.each([
    {
      symptom: 'rename',
      edit: { kind: 'renameFolder' as const, folderId: 'folder', name: 'Unsaved name' },
      localNames: ['Unsaved name'],
    },
    {
      symptom: 'last-folder removal',
      edit: { kind: 'removeFolder' as const, folderId: 'folder' },
      localNames: [],
    },
  ])(
    'a cloud merge preserves an unsaved $symptom after its local save fails',
    async ({ edit, localNames }) => {
      type Receiver = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
      const receivers = new Set<Receiver>();
      vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) => {
        receivers.add(listener);
      });
      vi.spyOn(chrome.runtime.onMessage, 'removeListener').mockImplementation((listener) => {
        receivers.delete(listener);
      });
      vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((async (
        _id: number,
        message: unknown,
      ) => {
        let response: unknown;
        for (const receiver of receivers) {
          receiver(message, { id: chrome.runtime.id }, (value: unknown) => {
            response = structuredClone(value);
          });
        }
        return response;
      }) as typeof chrome.tabs.sendMessage);
      const commands = await ready();
      vi.spyOn(memory.api.local, 'set').mockRejectedValueOnce(new Error('Transient write failure'));
      await commands.run(edit);
      await settle(30);
      expect(commands.view().folders.map((folder) => folder.name)).toEqual(localNames);
      expect((stored() as FolderData).folders[0].name).toBe('Initial');

      let transfer!: ReturnType<typeof useCloudSyncTransfer>;
      function TransferHarness() {
        const current = useCloudSyncTransfer(
          'chatgpt',
          false,
          async () =>
            ({
              id: 3,
              url: 'https://chatgpt.com/',
            }) as chrome.tabs.Tab,
        );
        useEffect(() => {
          transfer = current;
        }, [current]);
        return null;
      }
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(TransferHarness)));
        const cloud = data('Cloud folder');
        cloud.folders[0].id = 'cloud';
        cloud.folderContents = { cloud: [] };
        const download = await transfer.prepareDownload();
        await download.restore({ folders: exportChatGptFolders(cloud) }, 'merge', false);
        await settle(30);

        expect(commands.view().folders.map((folder) => folder.name)).toEqual([
          ...localNames,
          'Cloud folder',
        ]);
        expect(stored()).toEqual(commands.view());
        expectOtherPlatformsIntact();
      } finally {
        await act(async () => root.unmount());
      }
    },
  );

  it('recovers a corrupted ChatGPT bucket from its own backup without changing other sites', async () => {
    const chatgpt = new DataBackupService<FolderData>('chatgpt-folders', validateFolderData);
    const gemini = new DataBackupService<FolderData>('gemini-folders', validateFolderData);
    const aiStudio = new DataBackupService<FolderData>('aistudio-folders', validateFolderData);
    await chatgpt.createPrimaryBackup(data('Recovered ChatGPT'));
    await gemini.createPrimaryBackup(data('Gemini backup'));
    await aiStudio.createPrimaryBackup(data('AI Studio backup'));
    const geminiBackup = localStorage.getItem('gvBackup_gemini-folders_primary');
    const aiStudioBackup = localStorage.getItem('gvBackup_aistudio-folders_primary');
    memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, {
      folders: data('Corrupted').folders,
      folderContents: { folder: 'invalid' },
    });

    const commands = await ready();
    await settle(30);

    expect(commands.view()).toEqual(data('Recovered ChatGPT'));
    expect(stored()).toEqual(data('Recovered ChatGPT'));
    expect(localStorage.getItem('gvBackup_gemini-folders_primary')).toBe(geminiBackup);
    expect(localStorage.getItem('gvBackup_aistudio-folders_primary')).toBe(aiStudioBackup);
    expectOtherPlatformsIntact();
  });
});
