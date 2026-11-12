// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * A user's ChatGPT folders as the builtin plugin left them, before the folders
 * primitive: `fixtures/chatgptBuiltinData.json` is what that build stored and
 * exported on chatgpt.com (a nested folder with a colour, a chat at `/c/` and
 * one in a Project), with ids and titles replaced. The update must open it as
 * it is, never rewrite it, and export the same file.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { CHATGPT_TRANSFER } from '@/features/folder/sites/chatgptTransfer';
import { treeDriver } from '@/pages/content/folder/floatingTree/__tests__/treeDriver';
import { initI18n } from '@/utils/i18n';

import {
  type SidebarFixture,
  makeRows,
  mountSidebarFixture,
} from './chatgpt/chatgptSidebarFixture';
import {
  type Page,
  SECTION,
  installStorage,
  nextPass,
  openPage,
  restoreStorage,
} from './chatgptHarness';
import builtin from './fixtures/chatgptBuiltinData.json';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const STORED = builtin.stored as FolderData;

let page: Page | null = null;
let sidebar: SidebarFixture | null = null;

beforeAll(async () => {
  installStorage(false);
  await initI18n();
  restoreStorage();
});

afterEach(async () => {
  await page?.close();
  page = null;
  sidebar?.destroy();
  sidebar = null;
  document.body.replaceChildren();
  restoreStorage();
});

describe("a ChatGPT user's folders from the builtin plugin", () => {
  it('open as they were, nested and filed, and are never rewritten', async () => {
    // Other chats in the sidebar, so nothing there retitles the filed ones.
    sidebar = mountSidebarFixture(makeRows(2));
    page = await openPage(installStorage(undefined, undefined, STORED));
    await nextPass();

    const root = document.querySelector(SECTION)?.shadowRoot;
    if (!root) throw new Error('no folder section');
    expect(treeDriver({ root, rootBucketId: ROOT_CONVERSATIONS_ID }).outline()).toEqual([
      'Voyager 测试',
      '  Voyager 测试 子',
      '    · Voyager 测试 会话 B',
      '  · Voyager 测试 会话 A',
    ]);
    // A Project chat keeps the path it was filed under.
    expect(
      [...root.querySelectorAll('a.gv-floating-folder-panel__conv-title')].map((title) =>
        title.getAttribute('href'),
      ),
    ).toEqual([
      'https://chatgpt.com/g/g-p-0000000000000000000000000000000c/c/00000000-0000-4000-8000-00000000000b',
      'https://chatgpt.com/c/00000000-0000-4000-8000-00000000000a',
    ]);
    expect(page.stored()).toEqual(STORED);
    expect(
      page.memory.writes.filter((write) => write.key === StorageKeys.FOLDER_DATA_CHATGPT),
    ).toEqual([]);
  });

  it('export as the same file', () => {
    const { exportedAt: _exportedAt, version: _version, ...file } = builtin.exported;
    const { exportedAt: _now, version: _current, ...exported } = CHATGPT_TRANSFER.export(STORED);
    expect(exported).toEqual(file);
  });

  it('import from its file into an empty store as the same folders', async () => {
    const outcome = await CHATGPT_TRANSFER.importInto(builtin.exported, {
      folders: [],
      folderContents: {},
    });

    expect(outcome.ok && outcome.data).toEqual(STORED);
  });
});
