import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import type { FolderNavigation } from '../FolderNavigation';
import type { FolderSidebarRuntime } from '../FolderSidebarRuntime';
import type { FolderStore } from '../FolderStore';
import type { FolderData } from '../types';
import { FolderManager } from './geminiFolderManager';

const { mountFloatingFabMock, mountFloatingPanelMock } = vi.hoisted(() => ({
  mountFloatingFabMock: vi.fn(),
  mountFloatingPanelMock: vi.fn(() => ({ destroy: vi.fn(), update: vi.fn() })),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: { get: vi.fn(), set: vi.fn() },
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

vi.mock('../floatingPanel', () => ({
  mountFloatingPanel: mountFloatingPanelMock,
}));

vi.mock('../floatingModeFab', () => ({
  mountFloatingFab: mountFloatingFabMock,
  unmountFloatingFab: vi.fn(),
}));

type TestableManager = {
  store: FolderStore;
  sidebarRuntime: FolderSidebarRuntime;
  navigation: FolderNavigation;
};

/** The sync settings the page stores: the folders switch and floating mode. */
function storeSettings(settings: Record<string, unknown>): void {
  vi.mocked(browser.storage.sync.get).mockImplementation(async (keys) => ({
    ...(keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {}),
    ...settings,
  }));
}

function mountSidebar(): { appRoot: HTMLElement; sidebar: HTMLElement; recents: HTMLElement } {
  const appRoot = document.createElement('div');
  appRoot.id = 'app-root';
  appRoot.className = 'side-nav-open';

  const sidebar = document.createElement('div');
  sidebar.setAttribute('data-test-id', 'overflow-container');

  const recents = document.createElement('expandable-section');
  recents.setAttribute('data-test-id', 'chats-expandable-section');
  sidebar.appendChild(recents);
  appRoot.appendChild(sidebar);
  document.body.appendChild(appRoot);

  return { appRoot, sidebar, recents };
}

describe("Gemini's folders turning off and floating mode", () => {
  let manager: FolderManager | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.storage.sync.get).mockResolvedValue({});
    vi.mocked(browser.storage.sync.set).mockResolvedValue(undefined);
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops enhancing native rows and menus when turned off while preserving folder data', async () => {
    vi.useFakeTimers();
    const storedData: FolderData = {
      folders: [
        {
          id: 'saved-folder',
          name: 'Saved folder',
          parentId: null,
          isExpanded: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folderContents: { 'saved-folder': [] },
    };
    // Callers use both the callback and the promise form.
    vi.mocked(chrome.storage.local.get).mockImplementation(((
      keys: unknown,
      callback?: (items: Record<string, unknown>) => void,
    ) => {
      const items = keys === 'gvFolderData' ? { gvFolderData: structuredClone(storedData) } : {};
      callback?.(items);
      return Promise.resolve(items);
    }) as unknown as typeof chrome.storage.local.get);
    const { recents } = mountSidebar();
    const row = document.createElement('div');
    row.setAttribute('data-test-id', 'conversation');
    row.innerHTML = '<a href="/app/abcdef0123456789">Native conversation</a>';
    const nextRow = row.cloneNode(true) as HTMLElement;
    recents.appendChild(row);

    const menu = document.createElement('gem-menu');
    menu.innerHTML = '<gem-menu-item data-test-id="rename-button">Rename</gem-menu-item>';
    const nextMenu = menu.cloneNode(true) as HTMLElement;
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;
    await manager.init();
    const loaded = structuredClone(typed.store.data);
    expect(loaded.folders.map((folder) => folder.id)).toEqual(['saved-folder']);
    document.body.appendChild(menu);
    await vi.advanceTimersByTimeAsync(100);

    expect(row.draggable).toBe(true);
    expect(menu.querySelector('.gv-move-to-folder-btn')).not.toBeNull();
    expect(document.querySelector('.gv-folder-container')).not.toBeNull();
    menu.remove();

    manager.setFolders(false);
    recents.appendChild(nextRow);
    document.body.appendChild(nextMenu);
    await vi.advanceTimersByTimeAsync(100);

    expect(document.querySelector('.gv-folder-container')).toBeNull();
    expect(nextRow.draggable).toBe(false);
    expect(nextMenu.querySelector('.gv-move-to-folder-btn')).toBeNull();
    expect(typed.store.data).toEqual(loaded);
  });

  it('uses floating mode when folders turn on again with the floating toggle on', async () => {
    storeSettings({
      [StorageKeys.FOLDER_ENABLED]: false,
      [StorageKeys.FOLDER_FLOATING_MODE_ENABLED]: true,
    });
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;
    await manager.init();
    expect(mountFloatingPanelMock).not.toHaveBeenCalled();

    manager.setFolders(true);

    await vi.waitFor(() => expect(mountFloatingPanelMock).toHaveBeenCalledTimes(1));
    expect(typed.sidebarRuntime.isFloatingMode).toBe(true);
    expect(document.querySelector('.gv-folder-container')).toBeNull();
  });

  it('opens the floating panel by default when floating mode starts', async () => {
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;

    await typed.sidebarRuntime.start('floating');

    expect(mountFloatingPanelMock).toHaveBeenCalledTimes(1);
    expect(mountFloatingFabMock).not.toHaveBeenCalled();
  });

  it('keeps the FAB reopen path for explicit floating mode', async () => {
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;
    await typed.sidebarRuntime.start('floating');
    const calls = mountFloatingPanelMock.mock.calls as unknown as Array<[{ onClose?: () => void }]>;
    const panelArgs = calls[0]?.[0];
    panelArgs?.onClose?.();

    await vi.waitFor(() => expect(mountFloatingFabMock).toHaveBeenCalledTimes(1));
  });

  it('routes floating panel conversation clicks through the SPA navigator', async () => {
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;
    const navigateSpy = vi.spyOn(typed.navigation, 'navigate').mockImplementation(() => {});
    const conversation = {
      conversationId: 'c_1234567890abcdef',
      title: 'Conversation',
      url: 'https://gemini.google.com/app/1234567890abcdef',
      addedAt: 1,
    };

    await typed.sidebarRuntime.start('floating');
    const calls = mountFloatingPanelMock.mock.calls as unknown as Array<
      [
        {
          onNavigate?: (conv: typeof conversation) => void;
        },
      ]
    >;
    const args = calls[0][0];
    args.onNavigate?.(conversation);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(conversation);
  });

  it('starts floating mode as a FAB only when startup panel is disabled', async () => {
    storeSettings({
      [StorageKeys.FOLDER_FLOATING_MODE_ENABLED]: true,
      [StorageKeys.FOLDER_FLOATING_OPEN_ON_START]: false,
    });
    manager = new FolderManager();
    const typed = manager as unknown as TestableManager;

    await manager.init();
    await vi.waitFor(() => expect(mountFloatingFabMock).toHaveBeenCalledTimes(1));

    expect(mountFloatingPanelMock).not.toHaveBeenCalled();
    expect(typed.sidebarRuntime.isFloatingMode).toBe(true);
  });
});
