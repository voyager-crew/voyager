import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';

import { startGeminiBatchDelete } from '../../batchDelete/gemini';
import { deepActiveElement } from '../floatingTree/__tests__/treeDriver';
import { createFolderViewHarness, resetFolderViewBrowserMocks } from './folderViewHarness';
import { FolderManager } from './geminiFolderManager';
import { mountSidebar } from './sidebarRuntimeHarness';
import { sidebarTree, sidebarTreeRoot } from './sidebarTreeDriver';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => key,
  // The selection count is the one message these tests read back as user-visible
  // text, so it resolves to its real English form; everything else stays a key.
  getTranslationSyncUnsafe: (key: string) =>
    key === 'folder_multi_select_count' ? '{count} selected' : key,
  initI18n: () => Promise.resolve(),
}));

vi.mock('../floatingPanel', () => ({
  mountFloatingPanel: vi.fn(() => ({
    destroy: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
  })),
}));

function mountNativeSidebar(conversationId: string = 'c_abc123'): HTMLElement {
  const sidebar = document.createElement('div');
  sidebar.setAttribute('data-test-id', 'overflow-container');

  const conversation = document.createElement('div');
  conversation.setAttribute('data-test-id', 'conversation');
  conversation.setAttribute('jslog', `["${conversationId}"]`);

  sidebar.appendChild(conversation);
  document.body.appendChild(sidebar);
  return conversation;
}

describe('folder duplicate click guards', () => {
  let manager: FolderManager | null = null;
  let stopBatchDelete: (() => Promise<void>) | null = null;
  let harness: Awaited<ReturnType<typeof createFolderViewHarness>> | null = null;
  const createFolder = () =>
    harness!.runtime.panel!.querySelector<HTMLButtonElement>('.gv-folder-add-btn')!.click();
  /** The folder name fields open in the sidebar's tree. */
  const nameInputs = (panel = harness!.runtime.panel) =>
    sidebarTreeRoot(panel).querySelectorAll('input');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetFolderViewBrowserMocks();
    // Folder storage uses promises; TimestampService still uses Chrome's callback API.
    vi.mocked(chrome.storage.local.get).mockImplementation(
      async (_keys: unknown, callback?: (items: unknown) => void) => {
        callback?.({});
        return {};
      },
    );
    vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(false);
  });

  afterEach(async () => {
    await stopBatchDelete?.();
    stopBatchDelete = null;
    harness?.destroy();
    harness = null;
    manager?.destroy();
    manager = null;
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reuses the active folder input instead of creating duplicates', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });

    createFolder();

    const input = sidebarTree(harness.runtime.panel).nameInput();
    expect(input).not.toBeNull();
    expect(nameInputs()).toHaveLength(1);

    const focusTrap = document.createElement('button');
    document.body.appendChild(focusTrap);
    focusTrap.focus();
    expect(document.activeElement).toBe(focusTrap);

    createFolder();

    expect(nameInputs()).toHaveLength(1);
    expect(deepActiveElement()).toBe(input);
  });

  it('keeps the typed draft when "+" is pressed again with the mouse', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });
    const addButton =
      harness.runtime.panel!.querySelector<HTMLButtonElement>('.gv-folder-add-btn')!;
    const press = () => {
      for (const type of ['mousedown', 'mouseup', 'click']) {
        addButton.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }),
        );
      }
    };

    press();
    const input = sidebarTree(harness.runtime.panel).nameInput()!;
    input.value = 'Draft';
    addButton.focus();

    press();

    expect(nameInputs()).toHaveLength(1);
    expect(sidebarTree(harness.runtime.panel).nameInput()).toBe(input);
    expect(input.value).toBe('Draft');
    expect(deepActiveElement()).toBe(input);
  });

  it('clears stale folder input state during reinitialize so creation stays usable', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });

    createFolder();
    expect(nameInputs()).toHaveLength(1);

    await harness.runtime.remount();

    expect(nameInputs()).toHaveLength(0);

    createFolder();

    expect(nameInputs()).toHaveLength(1);
  });

  it('runs the chosen import, export or cloud action through the header buttons', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });
    const importAction = vi
      .spyOn(harness.transfer, 'showImportDialog')
      .mockImplementation(() => {});
    const exportAction = vi.spyOn(harness.transfer, 'exportFolders').mockImplementation(() => {});
    const uploadAction = vi.spyOn(harness.transfer, 'upload').mockResolvedValue(undefined);
    const syncAction = vi.spyOn(harness.transfer, 'sync').mockResolvedValue(undefined);
    const header = harness.runtime.panel!;

    for (const [buttonSelector, label, action] of [
      ['.gv-folder-import-export-btn', 'folder_import', importAction],
      ['.gv-folder-import-export-btn', 'folder_export', exportAction],
      ['.gv-folder-cloud-btn', 'folder_cloud_upload', uploadAction],
      ['.gv-folder-cloud-btn', 'folder_cloud_sync', syncAction],
    ] as const) {
      header.querySelector<HTMLButtonElement>(buttonSelector)?.click();
      const item = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.gv-folder-menu-item'),
      ).find((candidate) => candidate.textContent?.endsWith(label));
      expect(item).toBeDefined();
      item?.click();

      expect(action).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.gv-folder-menu')).toBeNull();
    }
    for (const action of [importAction, exportAction, uploadAction, syncAction]) {
      expect(action).toHaveBeenCalledTimes(1);
    }
  });

  it('persists a sort choice made through the header settings button', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });
    const header = harness.runtime.panel!;
    expect(header.querySelector('.gv-folder-sort-btn')).toBeNull();

    header.querySelector<HTMLButtonElement>('.gv-folder-settings-btn')?.click();
    const recentOption = document.querySelector<HTMLButtonElement>(
      '.gv-folder-sort-option:last-child',
    );
    expect(recentOption).not.toBeNull();
    recentOption?.click();

    expect(browser.storage.sync.set).toHaveBeenCalledWith({
      [StorageKeys.FOLDER_CONVERSATION_SORT_MODE]: 'recent',
    });
  });

  it('keeps the import dialog singleton and reopens cleanly after closing', async () => {
    harness = await createFolderViewHarness({ folders: [], folderContents: {} });

    harness.transfer.showImportDialog();

    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(1);

    harness.transfer.showImportDialog();

    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(1);

    const cancelBtn = document.querySelector(
      '.gv-folder-dialog-btn-secondary',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();

    cancelBtn?.click();

    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(0);

    harness.transfer.showImportDialog();

    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(1);
  });

  it('cleans up tracked UI overlays during destroy', async () => {
    mountSidebar();
    manager = new FolderManager();
    await manager.init();
    const panel = document.querySelector<HTMLElement>('.gv-folder-container')!;
    panel.querySelector<HTMLButtonElement>('.gv-folder-add-btn')!.click();
    const menuButton = panel.querySelector<HTMLButtonElement>('.gv-folder-import-export-btn')!;
    menuButton.click();
    const importButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.gv-folder-menu-item'),
    ).find((item) => item.textContent?.endsWith('folder_import'))!;
    importButton.click();
    menuButton.click();
    await vi.advanceTimersByTimeAsync(0);

    const tree = sidebarTreeRoot(panel);
    expect(tree.querySelectorAll('input')).toHaveLength(1);
    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(1);
    expect(document.querySelectorAll('.gv-folder-menu')).toHaveLength(1);

    manager.destroy();
    manager = null;

    expect(tree.querySelectorAll('input')).toHaveLength(0);
    expect(document.querySelectorAll('.gv-folder-dialog-overlay')).toHaveLength(0);
    expect(document.querySelectorAll('.gv-folder-menu')).toHaveLength(0);
  });

  it('wires native long-press multi-select when floating mode starts first', async () => {
    stopBatchDelete = startGeminiBatchDelete();
    manager = new FolderManager();
    vi.mocked(browser.storage.sync.get).mockResolvedValue({
      [StorageKeys.FOLDER_FLOATING_MODE_ENABLED]: true,
    });
    const conversation = mountNativeSidebar('c_abc123');

    await manager.init();
    // Run the scheduled row enhancement through its production frame/idle path.
    await vi.advanceTimersByTimeAsync(100);

    expect(conversation.dataset.gvConvDragAttached).toBe('true');

    conversation.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(500);

    const floatingHost = document.querySelector(
      '[data-multi-select-floating-host="true"]',
    ) as HTMLElement | null;
    expect(conversation.classList.contains('gv-conversation-selected')).toBe(true);
    expect(floatingHost).not.toBeNull();
    expect(floatingHost?.querySelector('[data-selection-count="true"]')?.textContent).toBe(
      '1 selected',
    );
    expect(floatingHost?.querySelector('.gv-multi-select-delete-btn')).not.toBeNull();
  });
});
