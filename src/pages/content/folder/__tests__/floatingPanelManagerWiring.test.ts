/**
 * The floating panel, mounted by the real FolderManager, files changes through
 * the same store paths and dialogs as the sidebar tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { confirmDriver } from '@/tests/confirmDriver';

import { FolderStore } from '../FolderStore';
import * as storageAdapters from '../storage/FolderStorageAdapter';
import type { FolderData } from '../types';
import { FolderManager } from './geminiFolderManager';
import { mountSidebar } from './sidebarRuntimeHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => {
  const translate = (key: string) =>
    key === 'folder_remove_conversation_confirm' ? 'Remove "{title}"?' : key;
  return {
    onCachedLanguageChange: () => () => {},
    getTranslationSync: translate,
    getTranslationSyncUnsafe: translate,
    initI18n: () => Promise.resolve(),
  };
});

const PANEL = 'gv-floating-folder-panel';

function storedData(): FolderData {
  return {
    folders: [
      {
        id: 'work',
        name: 'Work',
        parentId: null,
        isExpanded: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folderContents: {
      work: [
        {
          conversationId: 'c-work',
          title: 'Quarterly plan',
          url: 'https://gemini.google.com/app/c-work',
          addedAt: 1,
        },
      ],
      [ROOT_CONVERSATIONS_ID]: [
        {
          conversationId: 'c-root',
          title: 'Filed at root',
          url: 'https://gemini.google.com/app/c-root',
          addedAt: 1,
        },
      ],
    },
  };
}

describe('floating panel wired through FolderManager', () => {
  let manager: FolderManager | null = null;
  let adapter: storageAdapters.IFolderStorageAdapter;

  async function openFloatingPanel(): Promise<ShadowRoot> {
    manager = new FolderManager();
    await manager.init();
    await vi.advanceTimersByTimeAsync(0);
    const host = document.querySelector<HTMLElement>(`.${PANEL}`);
    if (!host?.shadowRoot) throw new Error('Expected the floating panel to be open');
    return host.shadowRoot;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    history.replaceState({}, '', '/u/0/app');
    mountSidebar();
    vi.mocked(chrome.storage.sync.get).mockImplementation(async (keys) => ({
      ...(keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {}),
      [StorageKeys.FOLDER_FLOATING_MODE_ENABLED]: true,
      [StorageKeys.FOLDER_FLOATING_OPEN_ON_START]: true,
    }));
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
    vi.mocked(chrome.storage.local.set).mockResolvedValue();
    vi.mocked(chrome.storage.sync.set).mockResolvedValue();
    vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(false);
    adapter = {
      init: vi.fn(async () => {}),
      loadData: vi.fn(async () => storedData()),
      saveData: vi.fn(async () => true),
      removeData: vi.fn(async () => {}),
      getBackendName: () => 'test-memory',
    };
    vi.spyOn(storageAdapters, 'createFolderStorageAdapter').mockReturnValue(adapter);
    vi.spyOn(FolderStore.prototype, 'initializeConversationActivityTracking').mockResolvedValue();
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function savedContents(): FolderData['folderContents'] | undefined {
    const calls = vi.mocked(adapter.saveData).mock.calls;
    return (calls.at(-1)?.[1] as FolderData | undefined)?.folderContents;
  }

  it('lists root conversations next to the folders', async () => {
    const root = await openFloatingPanel();

    expect(root.querySelector(`[data-conversation-id="c-root"]`)?.textContent).toContain(
      'Filed at root',
    );
    expect(root.querySelector(`[data-conversation-id="c-work"]`)).not.toBeNull();
  });

  it('confirms with the folder dialog before removing a conversation', async () => {
    const root = await openFloatingPanel();
    const row = root.querySelector<HTMLElement>('[data-conversation-id="c-work"]')!;

    row.querySelector<HTMLButtonElement>(`.${PANEL}__icon-button--remove`)!.click();
    expect(confirmDriver.message()).toContain('Remove "Quarterly plan"?');
    expect(manager!.getFolders()).toHaveLength(1);
    expect(root.querySelector('[data-conversation-id="c-work"]')).not.toBeNull();

    const [, remove] = confirmDriver.labels();
    confirmDriver.answer(remove);
    await vi.advanceTimersByTimeAsync(0);

    expect(root.querySelector('[data-conversation-id="c-work"]')).toBeNull();
    expect(savedContents()?.work).toEqual([]);
    expect(confirmDriver.isOpen()).toBe(false);
  });

  it('asks with the same folder confirm as the sidebar before deleting a folder', async () => {
    const root = await openFloatingPanel();
    const header = root.querySelector<HTMLElement>(
      `.${PANEL}__folder-header[data-folder-id="work"]`,
    )!;
    header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    root.querySelector<HTMLButtonElement>(`.${PANEL}__menu-item--danger`)!.click();

    expect(confirmDriver.message()).toBe('folder_delete_confirm');
    expect(confirmDriver.focusedLabel()).toBe('pm_cancel');
    confirmDriver.answer('folder_delete');
    await vi.advanceTimersByTimeAsync(0);

    expect(manager!.getFolders()).toEqual([]);
  });

  it('saves folder expansion in the stored data', async () => {
    const root = await openFloatingPanel();
    const header = root.querySelector<HTMLElement>(
      `.${PANEL}__folder-header[data-folder-id="work"]`,
    )!;

    header.click();
    await vi.advanceTimersByTimeAsync(5000);

    const saved = vi.mocked(adapter.saveData).mock.calls.at(-1)?.[1] as FolderData | undefined;
    expect(saved?.folders.find((folder) => folder.id === 'work')?.isExpanded).toBe(false);
    // Rows are flat: the folder reads as collapsed and renders none of its rows.
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector(`.${PANEL}__conv[data-folder-id="work"]`)).toBeNull();
  });
});
