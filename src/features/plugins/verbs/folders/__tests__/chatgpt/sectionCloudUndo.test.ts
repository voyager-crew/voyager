// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * A catalog folder site's cloud transfers, as Gemini's: a refused upload asks
 * first, and a download's result offers Undo that puts the folders back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { exportChatGptFolders } from '@/features/folder/sites/chatgptTransfer';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { confirmDriver } from '@/tests/confirmDriver';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';
import { toastDriver } from '@/tests/toastDriver';
import { initI18n, getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import { activateChatGptFolders } from './chatgptSite';

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', sendMessage },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const ROWS = makeRows(2);
const folders = (id: string, name: string, row: (typeof ROWS)[number]): FolderData => ({
  folders: [{ id, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
  folderContents: {
    [id]: [
      {
        conversationId: `chatgpt:conv:${row.id}`,
        title: row.title,
        url: `https://chatgpt.com/c/${row.id}`,
        addedAt: 1,
      },
    ],
    [ROOT_CONVERSATIONS_ID]: [],
  },
});
const LOCAL = folders('f1', 'Work', ROWS[0]);
const CLOUD = folders('f2', 'Trips', ROWS[1]);
const KEY = StorageKeys.FOLDER_DATA_CHATGPT;

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;

const names = () => (memory.values.local.get(KEY) as FolderData).folders.map(({ name }) => name);

async function choose(label: string): Promise<void> {
  const section = document.querySelector<HTMLElement>('.gv-chatgpt-folder-section')!;
  section
    .shadowRoot!.querySelector<HTMLButtonElement>(`button[aria-label="${t('folder_cloud')}"]`)!
    .click();
  [...document.querySelectorAll<HTMLElement>('[data-gv-layer="popover"]')]
    .flatMap((host) => [
      ...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ])
    .find((item) => item.textContent === label)!
    .click();
}

beforeAll(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  await initI18n();
  globalThis.chrome.storage = originalStorage;
});

beforeEach(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  memory.values.local.set(KEY, structuredClone(LOCAL));
  sendMessage.mockReset();
  scope = new PluginScope();
  sidebar = mountSidebarFixture(ROWS);
  await activateChatGptFolders(scope);
  await settle(5);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(20);
});

afterEach(async () => {
  confirmDriver.pressEscape();
  await scope.dispose();
  sidebar.destroy();
  document.body.replaceChildren();
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

describe('ChatGPT folder section: guard and Undo', () => {
  it('asks before a shrinking upload and resends it with its token on Upload anyway', async () => {
    sendMessage.mockImplementation(async ({ type, payload }) => {
      if (type !== 'gv.sync.upload') return { ok: true };
      return (payload as { guardToken?: string }).guardToken === 'guard-1'
        ? { ok: true }
        : {
            ok: false,
            error: 'upload_guard_refused',
            guardToken: 'guard-1',
            refusedFiles: [{ kind: 'folders', localCount: 1, cloudCount: 9, reason: 'large_drop' }],
          };
    });

    await choose(t('folder_cloud_upload'));
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    expect(confirmDriver.labels()).toContain(t('syncGuardMerge'));
    confirmDriver.answer(t('syncGuardForce'));
    await vi.waitFor(() => expect(toastDriver.find(t('uploadSuccess'))).toBeDefined());

    const uploads = sendMessage.mock.calls.filter(([message]) => message.type === 'gv.sync.upload');
    expect(uploads.map(([message]) => message.payload.guardToken)).toEqual([undefined, 'guard-1']);
    expect(uploads[1][0].payload).toMatchObject({ platform: 'chatgpt', force: true });
  });

  it('offers Undo after a download, and Undo brings the ChatGPT folders back', async () => {
    sendMessage.mockImplementation(async ({ type }) =>
      type === 'gv.sync.download'
        ? { ok: true, operationId: 'op', data: { folders: exportChatGptFolders(CLOUD) } }
        : type === 'gv.sync.catalogTimeline.pull'
          ? { ok: true, data: null }
          : { ok: true },
    );

    await choose(t('folder_cloud_sync'));
    await vi.waitFor(() => expect(toastDriver.find(t('downloadMergeSuccess'))).toBeDefined());
    expect(names().sort()).toEqual(['Trips', 'Work']);
    const toast = toastDriver.find(t('downloadMergeSuccess'))!;
    expect(toastDriver.labels(toast)).toContain(t('syncUndo'));

    toastDriver.press(toast, t('syncUndo'));
    await vi.waitFor(() => expect(toastDriver.find(t('syncUndoDone'))).toBeDefined());
    expect(names()).toEqual(['Work']);
  });
});
