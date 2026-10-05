import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderEditBody } from '@/features/folder/commands/folderCommands';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import type { FolderData } from '@/pages/content/folder/types';

import { ChatGptFolderStore } from '../ChatGptFolderStore';
import { CHATGPT_FOLDER_CONFIG } from '../config';
import { createLegacyChatGptCommands } from '../legacyChatGptCommands';
import { exportChatGptFolders, importChatGptFolders } from '../transfer';
import { type MemoryStorage, createMemoryStorage, settle } from './memoryStorage';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id' },
  },
}));

const GEMINI_DATA: FolderData = {
  folders: [
    { id: 'g1', name: 'Gemini', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: { g1: [], [ROOT_CONVERSATIONS_ID]: [] },
};

function conversation(id: string, title = id) {
  return {
    conversationId: `chatgpt:conv:${id}`,
    title,
    url: `https://chatgpt.com/c/${id}`,
    addedAt: 1,
  };
}

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let store: ChatGptFolderStore | null = null;

beforeEach(() => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  localStorage.clear();
  // Everything that could pull ChatGPT into Gemini's buckets is switched on.
  memory.values.local.set(StorageKeys.FOLDER_DATA, structuredClone(GEMINI_DATA));
  memory.values.local.set(StorageKeys.FOLDER_DATA_AISTUDIO, structuredClone(GEMINI_DATA));
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED, true);
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
});

afterEach(() => {
  store?.destroy();
  store = null;
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

function add(target: string, id: string, title = id): FolderEditBody {
  const { conversationId, url } = conversation(id);
  return {
    kind: 'addConversations',
    target,
    seeds: [{ conversationId, title, url }],
    via: 'picker',
  };
}

async function ready(): Promise<ChatGptFolderStore> {
  store = new ChatGptFolderStore();
  await store.init();
  await settle();
  return store;
}

describe('ChatGptFolderStore', () => {
  it('writes only the ChatGPT bucket, whatever Gemini and the legacy switch hold', async () => {
    const migrate = vi.spyOn(CHATGPT_FOLDER_CONFIG, 'migrateLegacyData');
    const pageWrites = vi.spyOn(localStorage, 'setItem');
    const s = await ready();
    const c = createLegacyChatGptCommands(s);

    await c.run({ kind: 'createFolder', folderId: 'x', name: 'Work', parentId: null });
    const folderId = s.data.folders[0].id;
    await c.run(add(folderId, 'a'));
    await c.run(add(ROOT_CONVERSATIONS_ID, 'b'));
    await c.run({ kind: 'renameFolder', folderId, name: 'Projects' });
    await c.run({ kind: 'setFolderColor', folderId, color: 'blue' });
    await c.run({ kind: 'setFolderPinned', folderId, pinned: true });
    await c.run({ kind: 'setFolderExpanded', folderId, expanded: false });
    await c.run({
      kind: 'moveConversations',
      ids: ['chatgpt:conv:b'],
      from: ROOT_CONVERSATIONS_ID,
      target: folderId,
      via: 'panel-menu',
    });
    await c.run({ kind: 'removeConversations', folderId, ids: ['chatgpt:conv:a'] });
    await settle();
    const imported = await importChatGptFolders(
      exportChatGptFolders({
        folders: [
          {
            id: 'f9',
            name: 'Imported',
            parentId: null,
            isExpanded: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        folderContents: { f9: [conversation('c')] },
      }),
      s.data,
    );
    expect(imported.ok).toBe(true);
    if (imported.ok) await s.replaceData(imported.data);
    await settle();
    expect(s.data.folders.map((f) => f.name)).toEqual(['Projects', 'Imported']);
    await s.replaceData({ folders: [], folderContents: {} });
    await settle();

    expect(migrate).not.toHaveBeenCalled();
    expect(new Set(memory.writes.map((w) => `${w.area}:${w.key}`))).toEqual(
      new Set([`local:${StorageKeys.FOLDER_DATA_CHATGPT}`]),
    );
    expect(memory.values.local.get(StorageKeys.FOLDER_DATA)).toEqual(GEMINI_DATA);
    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_AISTUDIO)).toEqual(GEMINI_DATA);
    expect(sessionStorage.length).toBe(0);
    // The repository's recovery slots live in this page's localStorage, under the
    // ChatGPT namespace only.
    const pageKeys = new Set(pageWrites.mock.calls.map(([key]) => key));
    expect(pageKeys.size).toBeGreaterThan(0);
    for (const key of pageKeys) expect(key).toMatch(/^gvBackup_chatgpt-folders_/);
  });

  it('files edits in the stored bucket', async () => {
    const s = await ready();
    const c = createLegacyChatGptCommands(s);
    await c.run({ kind: 'createFolder', folderId: 'x', name: 'Work', parentId: null });
    const folderId = s.data.folders[0].id;
    expect(folderId).toMatch(/^folder_\d+_[0-9a-z]+$/);
    expect(await c.run(add(folderId, 'a', 'Trip plan'))).toEqual({ kind: 'unconfirmed' });
    expect(await c.run(add(folderId, 'a', 'Again'))).toMatchObject({
      kind: 'unchanged',
      reason: 'present',
    });
    await settle();

    const stored = memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData;
    expect(stored.folders.map((f) => f.name)).toEqual(['Work']);
    expect(stored.folderContents[folderId].map((c) => c.title)).toEqual(['Trip plan']);
  });

  it('files nothing into a folder that no longer exists', async () => {
    const s = await ready();
    const c = createLegacyChatGptCommands(s);
    await c.run({ kind: 'createFolder', folderId: 'x', name: 'Work', parentId: null });
    await c.run({ kind: 'createFolder', folderId: 'y', name: 'Gone', parentId: null });
    const [work, gone] = s.data.folders.map((folder) => folder.id);
    await c.run(add(work, 'a'));
    await c.run({ kind: 'removeFolder', folderId: gone });
    await settle();
    const writes = memory.writes.length;

    expect(await c.run(add(gone, 'b'))).toMatchObject({ reason: 'target_missing' });
    expect(
      await c.run({
        kind: 'moveConversations',
        ids: ['chatgpt:conv:a'],
        from: work,
        target: gone,
        via: 'panel-menu',
      }),
    ).toMatchObject({ reason: 'target_missing' });
    expect(await c.run(add(ROOT_CONVERSATIONS_ID, 'c'))).toEqual({ kind: 'unconfirmed' });
    await settle();

    const stored = memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData;
    expect(Object.keys(stored.folderContents).sort()).toEqual([ROOT_CONVERSATIONS_ID, work].sort());
    expect(stored.folderContents[work].map((c) => c.conversationId)).toEqual(['chatgpt:conv:a']);
    // Only the root filing was saved.
    expect(memory.writes.length).toBe(writes + 1);
  });

  it('recovers a backup when a folder owns a malformed bucket', async () => {
    const healthy: FolderData = {
      folders: [
        {
          id: 'f',
          name: 'Work',
          parentId: null,
          isExpanded: true,
          createdAt: 1,
          updatedAt: 1,
          sortIndex: 0,
        },
      ],
      folderContents: { f: [{ ...conversation('a'), sortIndex: 0 }] },
    };
    memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, structuredClone(healthy));
    (await ready()).destroy(); // a healthy load writes the primary backup
    store = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, {
      ...structuredClone(healthy),
      folderContents: { f: 'garbage' },
    });

    const s = await ready();

    expect(s.data.folderContents.f.map((c) => c.conversationId)).toEqual(['chatgpt:conv:a']);
    await settle();
    expect(
      (memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData).folderContents.f,
    ).toHaveLength(1);
  });

  it('reloads a write from another tab', async () => {
    const s = await ready();
    const seen = vi.fn();
    s.subscribe(seen);
    memory.external('local', StorageKeys.FOLDER_DATA_CHATGPT, {
      folders: [
        {
          id: 'f',
          name: 'Other tab',
          parentId: null,
          isExpanded: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folderContents: { f: [] },
    });
    await settle(30);

    expect(s.data.folders.map((f) => f.name)).toEqual(['Other tab']);
    expect(seen).toHaveBeenCalled();
  });

  it('ignores edits until its bucket has loaded', async () => {
    store = new ChatGptFolderStore();
    const outcome = await createLegacyChatGptCommands(store).run({
      kind: 'createFolder',
      folderId: 'x',
      name: 'Too early',
      parentId: null,
    });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'read_only' });
    expect(store.data.folders).toEqual([]);
    expect(memory.writes).toEqual([]);
  });

  it('stops listening for storage changes on destroy', async () => {
    const before = memory.listeners.size;
    const s = await ready();
    expect(memory.listeners.size).toBe(before + 1);
    s.destroy();
    store = null;
    expect(memory.listeners.size).toBe(before);
  });
});
