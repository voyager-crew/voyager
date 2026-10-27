// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.kimi.com/" }
/**
 * Hiding filed chats on Kimi, a derived folder site, through the page's own
 * path: `PluginHost`, the bundled catalog plugin and Kimi's `site.json`, over
 * Kimi's sidebar as measured live (2026-10-24).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import { createMemoryStorage, settle } from '@/tests/memoryStorage';
import { initI18n } from '@/utils/i18n';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const PLUGIN_ID = 'voyager.kimi-folders';
// Kimi's two id forms: 20 lowercase letters and digits, and a UUID.
const FILED = { id: '19a2b3c4d5e6f7g8h9i0', title: 'Notes' };
const FILED_UUID = { id: '0f8b7f33-2c77-4207-8108-87e3ba9b33d0', title: 'Ideas' };
const OTHER = { id: 'k0j9h8g7f6e5d4c3b2a1', title: 'Plans' };
const ROWS = [FILED, OTHER, FILED_UUID];

const DATA: FolderData = {
  folders: [
    { id: 'folder_1', name: 'Work', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: {
    folder_1: [FILED, FILED_UUID].map((row) => ({
      conversationId: `kimi:conv:${row.id}`,
      title: row.title,
      url: `https://www.kimi.com/chat/${row.id}`,
      addedAt: 1,
    })),
    [ROOT_CONVERSATIONS_ID]: [],
  },
};

function mountSidebar(): void {
  const item = (row: (typeof ROWS)[number]) =>
    `<div class="next-sidebar-history-item" id="row-${row.id}">` +
    `<a class="next-sidebar-history-item__link" href="/chat/${row.id}?chat_enter_method=history"><span>${row.title}</span></a>` +
    '<div class="next-sidebar-history-item__action"></div></div>';
  const root = document.createElement('div');
  root.innerHTML = `<aside class="next-sidebar"><div class="next-sidebar__body">
    <section class="next-sidebar-section"></section>
    <section class="next-sidebar-section next-sidebar__section--history">
      <div class="next-sidebar-section__header">History</div>
      <div class="next-sidebar-section__content"><div class="next-sidebar-history-list">
        ${ROWS.map(item).join('')}
      </div></div>
    </section></div></aside>`;
  document.body.append(root);
}

async function nextPass(): Promise<void> {
  await settle(5);
  vi.advanceTimersToNextFrame();
  await settle(20);
  await vi.advanceTimersByTimeAsync(1);
  await settle(20);
}

let original: typeof chrome.storage | undefined;
let host: PluginHost | null = null;

function installStorage(settings?: Record<string, boolean>): void {
  const memory = createMemoryStorage();
  original ??= globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  memory.values.local.set('gvFolderData:kimi', structuredClone(DATA));
  memory.values.local.set(StorageKeys.PLUGINS_STATE, {
    [PLUGIN_ID]: { enabled: true, installedAt: 1, ...(settings ? { settings } : {}) },
  });
}

const shown = (row: (typeof ROWS)[number]) => {
  const wrapper = document.getElementById(`row-${row.id}`)!;
  return [wrapper, wrapper.querySelector('a')!].every(
    (element) => getComputedStyle(element).display !== 'none',
  );
};

beforeAll(async () => {
  installStorage();
  await initI18n();
  if (original) globalThis.chrome.storage = original;
});

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
});

afterEach(async () => {
  try {
    host?.stop();
    host = null;
    await nextPass();
    // Unmounting does not cancel Preact's after-paint fallback when the tab drew no frames.
    await vi.runAllTimersAsync();
  } finally {
    document.body.replaceChildren();
    if (original) globalThis.chrome.storage = original;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

async function openPage(): Promise<void> {
  installStorage({ hideFiledChats: true });
  host = new PluginHost({
    url: location.href,
    sources: [new BundledCatalogPluginSource()],
    doc: document,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
}

describe('Kimi folders: hide filed chats', () => {
  it('hides the whole history row of each filed chat, action button included', async () => {
    mountSidebar();
    await openPage();
    await nextPass();

    expect(document.querySelector('.gv-kimi-folder-section')).not.toBeNull();
    expect(shown(FILED)).toBe(false);
    expect(shown(FILED_UUID)).toBe(false);
    expect(shown(OTHER)).toBe(true);
    // The row itself is what is hidden, so its action button never shows alone.
    expect(getComputedStyle(document.getElementById(`row-${FILED.id}`)!).display).toBe('none');
  });

  it('hides filed rows in a tab that loads with hiding on but draws no frames', async () => {
    mountSidebar();
    // A background tab runs no animation frames; the folders still load from storage.
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      await openPage();
      for (let i = 0; i < 5; i += 1) await settle(20);
      await vi.advanceTimersByTimeAsync(0);
      await settle(20);

      expect(shown(FILED)).toBe(false);
      expect(shown(OTHER)).toBe(true);
    } finally {
      frames.mockRestore();
    }
  });
});
