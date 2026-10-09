// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { routeCatalogOutlineWrites } from '@/features/timeline/__tests__/catalogOutlineBackground';
import { formatRelativeTime } from '@/pages/content/folder/syncTooltip';
import { toastDriver } from '@/tests/toastDriver';
import { initI18n, getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { activateChatGptFolders } from '../index';
import { exportChatGptFolders } from '../transfer';
import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import { type MemoryStorage, createMemoryStorage, settle } from './memoryStorage';

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

const ROWS = makeRows(4);
const conversation = (id: string, title: string) => ({
  conversationId: `chatgpt:conv:${id}`,
  title,
  url: `https://chatgpt.com/c/${id}`,
  addedAt: 1,
});
const LOCAL: FolderData = {
  folders: [
    { id: 'f1', name: 'Work', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: { f1: [conversation(ROWS[0].id, ROWS[0].title)], [ROOT_CONVERSATIONS_ID]: [] },
};
const CLOUD: FolderData = {
  folders: [
    { id: 'f2', name: 'Trips', parentId: null, isExpanded: true, createdAt: 2, updatedAt: 2 },
  ],
  folderContents: { f2: [conversation(ROWS[1].id, ROWS[1].title)], [ROOT_CONVERSATIONS_ID]: [] },
};

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;

async function nextPass(): Promise<void> {
  await settle(5);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(20);
}

function headerButton(label: string): HTMLButtonElement {
  const section = document.querySelector<HTMLElement>('.gv-chatgpt-folder-section')!;
  return section.shadowRoot!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

/** The open header menu's item labels, read the way a user sees them. */
function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-gv-layer="popover"]')].flatMap(
    (host) => [...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],
  );
}

async function choose(label: string): Promise<void> {
  headerButton(t('folder_cloud')).click();
  menuItems()
    .find((item) => item.textContent === label)!
    .click();
  await settle(30);
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
  memory.values.local.set(StorageKeys.FOLDER_DATA_CHATGPT, structuredClone(LOCAL));
  sendMessage.mockReset();
  scope = new PluginScope();
  sidebar = mountSidebarFixture(ROWS);
  await activateChatGptFolders(scope);
  await nextPass();
});

afterEach(async () => {
  await scope.dispose();
  sidebar.destroy();
  document.body.replaceChildren();
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

describe('ChatGPT folder section: cloud', () => {
  it('the ChatGPT folder header offers cloud upload and sync', () => {
    headerButton(t('folder_cloud')).click();

    expect(menuItems().map((item) => item.textContent)).toEqual([
      t('folder_cloud_upload'),
      t('folder_cloud_sync'),
    ]);
  });

  it('hovering the cloud button shows when the ChatGPT folders were last uploaded and synced', async () => {
    const uploadedAt = Date.now() - 5 * 60_000;
    const syncedAt = Date.now() - 2 * 3_600_000;
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'gv.sync.getState'
        ? {
            ok: true,
            // Gemini's own times must not stand in for ChatGPT's.
            state: {
              lastUploadTime: 1,
              lastSyncTime: 1,
              lastUploadTimeChatGPT: uploadedAt,
              lastSyncTimeChatGPT: syncedAt,
            },
          }
        : undefined,
    );
    const cloud = headerButton(t('folder_cloud'));

    cloud.dispatchEvent(new MouseEvent('mouseenter'));
    await settle(10);

    expect(cloud.title).toBe(
      [
        t('folder_cloud'),
        t('lastUploaded').replace('{time}', formatRelativeTime(uploadedAt)),
        t('lastSynced').replace('{time}', formatRelativeTime(syncedAt)),
      ].join('\n'),
    );
    expect(cloud.getAttribute('aria-label')).toBe(t('folder_cloud'));
  });

  it('pressing the cloud button again closes its menu instead of reopening it', () => {
    const cloud = headerButton(t('folder_cloud'));
    cloud.click();
    expect(cloud.getAttribute('aria-expanded')).toBe('true');

    cloud.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    cloud.click();

    expect(menuItems()).toEqual([]);
    expect(cloud.getAttribute('aria-expanded')).toBe('false');
  });

  it('uploads the ChatGPT folders through the popup’s sync message and confirms it', async () => {
    sendMessage.mockResolvedValue({ ok: true });

    await choose(t('folder_cloud_upload'));

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'gv.sync.upload',
      payload: expect.objectContaining({ platform: 'chatgpt' }),
    });
    expect(toastDriver.all()).toMatchObject([{ message: t('uploadSuccess'), tone: 'success' }]);
  });

  it('merges the cloud copy into the local folders and shows both', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { folders: exportChatGptFolders(CLOUD) } });

    await choose(t('folder_cloud_sync'));

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'gv.sync.download',
      payload: expect.objectContaining({ platform: 'chatgpt' }),
    });
    const saved = memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT) as FolderData;
    expect(saved.folders.map((folder) => folder.name).sort()).toEqual(['Trips', 'Work']);
    expect(saved.folderContents.f1).toHaveLength(1);
    expect(saved.folderContents.f2).toHaveLength(1);
    expect(toastDriver.all()).toMatchObject([
      { message: t('downloadMergeSuccess'), tone: 'success' },
    ]);
  });

  it('refuses a cloud copy holding another site’s conversations and keeps local folders', async () => {
    const gemini = structuredClone(CLOUD);
    gemini.folderContents.f2 = [
      {
        conversationId: 'c_abc',
        title: 'Gemini',
        url: 'https://gemini.google.com/app/abc',
        addedAt: 1,
      },
    ];
    sendMessage.mockResolvedValue({ ok: true, data: { folders: exportChatGptFolders(gemini) } });

    await choose(t('folder_cloud_sync'));

    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT)).toEqual(LOCAL);
    expect(toastDriver.all()).toMatchObject([
      { message: t('folder_import_wrong_site'), tone: 'error' },
    ]);
  });

  it('reports a failed upload with the provider’s error', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'iCloud unavailable' });

    await choose(t('folder_cloud_upload'));

    expect(toastDriver.all()).toMatchObject([
      { message: t('syncError').replace('{error}', 'iCloud unavailable'), tone: 'error' },
    ]);
  });

  it('a cloud merge that cannot be saved says so once and keeps the local folders', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = memory.api.local as unknown as {
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    const set = local.set;
    vi.spyOn(local, 'set').mockImplementation((items) =>
      StorageKeys.FOLDER_DATA_CHATGPT in items ? Promise.reject(new Error('quota')) : set(items),
    );
    sendMessage.mockResolvedValue({ ok: true, data: { folders: exportChatGptFolders(CLOUD) } });

    await choose(t('folder_cloud_sync'));

    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT)).toEqual(LOCAL);
    const saveErrors = toastDriver
      .messages()
      .filter((message) => message === t('folder_save_error'));
    expect(saveErrors).toHaveLength(1);
    expect(toastDriver.messages()).not.toContain(t('downloadMergeSuccess'));
  });

  it('restores ChatGPT outlines from the cloud when no ChatGPT folder file is there', async () => {
    const key = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
    const outline = {
      conversationUrl: 'https://chatgpt.com/c/one',
      levels: { 'turn-one': 2 },
      collapsed: [],
      updatedAt: 10,
    };
    sendMessage.mockImplementation(
      routeCatalogOutlineWrites(async (message: { type: string }) =>
        message.type === 'gv.sync.catalogTimeline.pull'
          ? { ok: true, buckets: { [key]: { conversations: { one: outline } } }, stars: {} }
          : { ok: true, data: null },
      ),
    );

    await choose(t('folder_cloud_sync'));

    expect(memory.values.local.get(key)).toEqual({ conversations: { one: outline } });
    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT)).toEqual(LOCAL);
    expect(toastDriver.all()).toMatchObject([{ message: t('syncSuccess'), tone: 'success' }]);
  });

  it('says so when the cloud has no ChatGPT folders yet', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: null });

    await choose(t('folder_cloud_sync'));

    expect(memory.values.local.get(StorageKeys.FOLDER_DATA_CHATGPT)).toEqual(LOCAL);
    expect(toastDriver.all()).toMatchObject([{ message: t('syncNoData'), tone: 'info' }]);
  });
});
