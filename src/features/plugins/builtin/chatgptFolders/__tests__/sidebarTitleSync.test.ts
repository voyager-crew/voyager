// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { ConversationReference, FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { initI18n } from '@/utils/i18n';

import { activateChatGptFolders } from '../index';
import { exportChatGptFolders } from '../transfer';
import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import { type MemoryStorage, createMemoryStorage, settle } from './memoryStorage';
import { transfer } from './sectionHeaderDriver';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id' },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const ROWS = makeRows(10);
const FILED = ROWS[2];

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;

function reference(row: (typeof ROWS)[number], extra: Partial<ConversationReference> = {}) {
  return {
    conversationId: `chatgpt:conv:${row.id}`,
    title: row.title,
    url: `https://chatgpt.com/c/${row.id}`,
    addedAt: 1,
    ...extra,
  };
}

function store(conversations: ConversationReference[]): void {
  const data: FolderData = {
    folders: [
      { id: 'f1', name: 'Work', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
    ],
    folderContents: { f1: conversations, [ROOT_CONVERSATIONS_ID]: [] },
  };
  memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, data);
}

function stored(): ConversationReference[] {
  return (memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData).folderContents.f1;
}

function folderWrites(): number {
  return memory.writes.filter((write) => write.key === StorageKeys.FOLDER_DATA_CHATGPT).length;
}

/** Lets the sidebar observer fire and its frame run. */
async function nextPass(): Promise<void> {
  await settle(5);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(20);
}

beforeAll(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  await initI18n();
  globalThis.chrome.storage = originalStorage;
});

beforeEach(() => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  scope = new PluginScope();
  sidebar = mountSidebarFixture(ROWS);
});

afterEach(async () => {
  await scope.dispose();
  sidebar.destroy();
  document.body.replaceChildren();
  globalThis.chrome.storage = originalStorage;
  document.documentElement.lang = '';
  vi.restoreAllMocks();
});

/** Imports `data` the way a user does: the section's Import button and a chosen file. */
async function importFromSection(data: FolderData): Promise<void> {
  // The file picker is never attached to the page; keep its click from opening anything.
  const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  transfer('import');
  const json = JSON.stringify(exportChatGptFolders(data));
  const file = new File([json], 'folders.json', { type: 'application/json' });
  // jsdom's File has no text().
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(json) });
  const picker = pick.mock.contexts[0] as HTMLInputElement;
  Object.defineProperty(picker, 'files', { value: [file] });
  picker.dispatchEvent(new Event('change'));
  await settle(20);
}

async function activate(): Promise<void> {
  await activateChatGptFolders(scope);
  await nextPass();
}

describe('ChatGPT sidebar title sync', () => {
  it('takes a filed conversation title from the sidebar when the plugin starts', async () => {
    store([reference(FILED, { title: 'Old title' })]);
    await activate();
    expect(stored()[0].title).toBe(FILED.title);
  });

  it('follows a rename in the sidebar with one save', async () => {
    store([reference(FILED)]);
    await activate();
    const before = folderWrites();

    sidebar.rename(FILED.id, 'Renamed in ChatGPT');
    await nextPass();

    expect(stored()[0].title).toBe('Renamed in ChatGPT');
    expect(folderWrites()).toBe(before + 1);
  });

  it('does not save while unfiled pages of history load', async () => {
    store([reference(FILED)]);
    await activate();
    const before = folderWrites();

    sidebar.appendPage(makeRows(10, 10));
    await nextPass();
    sidebar.appendPage(makeRows(10, 20));
    await nextPass();

    expect(folderWrites()).toBe(before);
  });

  it('keeps a title when the sidebar shows a placeholder or nothing', async () => {
    store([reference(FILED)]);
    await activate();

    sidebar.rename(FILED.id, 'New chat');
    await nextPass();
    sidebar.rename(FILED.id, '  ');
    await nextPass();

    expect(stored()[0].title).toBe(FILED.title);
  });

  it('keeps a title when the sidebar shows a localized "New chat" placeholder', async () => {
    store([reference(FILED)]);
    await activate();
    const before = folderWrites();

    const placeholders = [
      ['zh-CN', '新聊天'],
      ['fr-FR', 'Nouvelle discussion'],
      ['de', 'Neuer Chat'],
      ['ko-KR', '새 채팅'],
      ['', 'New chat'],
    ];
    for (const [lang, placeholder] of placeholders) {
      document.documentElement.lang = lang;
      sidebar.rename(FILED.id, placeholder);
      await nextPass();
    }

    expect(stored()[0].title).toBe(FILED.title);
    expect(folderWrites()).toBe(before);
  });

  it("a chat renamed to another language's 'New chat' keeps that title", async () => {
    document.documentElement.lang = 'en-US';
    store([reference(FILED)]);
    await activate();

    sidebar.rename(FILED.id, '新聊天');
    await nextPass();
    expect(stored()[0].title).toBe('新聊天');

    sidebar.rename(FILED.id, 'Nuevo chat');
    await nextPass();
    expect(stored()[0].title).toBe('Nuevo chat');
  });

  it("keeps the user's own title", async () => {
    store([reference(FILED, { title: 'Mine', customTitle: true })]);
    await activate();
    const before = folderWrites();

    sidebar.rename(FILED.id, 'Renamed in ChatGPT');
    await nextPass();

    expect(stored()[0]).toMatchObject({ title: 'Mine', customTitle: true });
    expect(folderWrites()).toBe(before);
  });

  it('keeps following titles after ChatGPT remounts the sidebar', async () => {
    store([reference(FILED)]);
    await activate();

    sidebar.replaceSidebar();
    await nextPass();
    sidebar.rename(FILED.id, 'Renamed after remount');
    await nextPass();

    expect(stored()[0].title).toBe('Renamed after remount');
  });

  it('takes the title from a row that moved into a Project', async () => {
    store([reference(FILED)]);
    await activate();

    sidebar.move(FILED.id, `/g/g-p-67ab12cd34-trip/c/${FILED.id}`);
    sidebar.rename(FILED.id, 'In a Project');
    await nextPass();

    expect(stored()[0]).toMatchObject({
      title: 'In a Project',
      url: `https://chatgpt.com/c/${FILED.id}`,
    });
  });

  it('settles when another tab saves a title this sidebar still shows differently', async () => {
    store([reference(FILED)]);
    await activate();
    const before = folderWrites();

    // Another tab, whose sidebar shows a newer title, saves it.
    const fromOtherTab = structuredClone(
      memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT),
    ) as FolderData;
    fromOtherTab.folderContents.f1[0].title = 'Newer title in another tab';
    memory.external('local', StorageKeys.FOLDER_DATA_CHATGPT, fromOtherTab);
    await nextPass();
    await nextPass();

    // This tab's stale row must not answer with a write the other tab would undo.
    expect(folderWrites()).toBe(before);
    expect(stored()[0].title).toBe('Newer title in another tab');

    // A rename this tab sees is still saved.
    sidebar.rename(FILED.id, 'Renamed here');
    await nextPass();
    expect(stored()[0].title).toBe('Renamed here');
    expect(folderWrites()).toBe(before + 1);
  });

  it('gives an imported copy with an older title the title the sidebar shows', async () => {
    store([reference(FILED)]);
    await activate();
    const before = folderWrites();

    await importFromSection({
      folders: [
        { id: 'f2', name: 'Old', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
      ],
      folderContents: { f2: [reference(FILED, { title: 'Title from an old export' })] },
    });
    await nextPass();
    await nextPass();

    const data = memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData;
    expect(data.folderContents.f2).toEqual([expect.objectContaining({ title: FILED.title })]);
    expect(data.folderContents.f1[0].title).toBe(FILED.title);
    // The import, then one title write; nothing more after it.
    expect(folderWrites()).toBe(before + 2);
    await nextPass();
    expect(folderWrites()).toBe(before + 2);
  });

  it('stops following the sidebar when turned off', async () => {
    store([reference(FILED)]);
    await activate();
    await scope.dispose();
    const before = folderWrites();

    sidebar.rename(FILED.id, 'Renamed while off');
    await nextPass();

    expect(folderWrites()).toBe(before);
    expect(stored()[0].title).toBe(FILED.title);
  });
});
