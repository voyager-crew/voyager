import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AccountScope,
  accountIsolationService,
  buildScopedFolderStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { toastDriver } from '@/tests/toastDriver';

import { FolderStore } from '../FolderStore';
import * as storageAdapters from '../storage/FolderStorageAdapter';
import type { FolderData } from '../types';
import { showGeminiAccount } from './geminiAccountControl';
import { FolderManager } from './geminiFolderManager';
import { mountSidebar } from './sidebarRuntimeHarness';
import { sidebarTree, sidebarTreeRoot } from './sidebarTreeDriver';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

type Surface = 'sidebar' | 'floating' | 'fab';

/** Everything the page shows, the trees in shadow roots included. */
const pageText = () =>
  [document.body, ...Array.from(document.querySelectorAll('*'), (element) => element.shadowRoot)]
    .map((node) => node?.textContent ?? '')
    .join('');

/** The folders the sidebar's tree shows. */
const sidebarFolders = () =>
  sidebarTree(document.querySelector('.gv-folder-container')).folderNames();

function accountData(account: string): FolderData {
  return {
    folders: [
      {
        id: account,
        name: `Private ${account}`,
        parentId: null,
        isExpanded: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folderContents: { [account]: [] },
  };
}

function accountScope(account: string, route: string): AccountScope {
  return {
    accountKey: `email:${account}`,
    accountId: Number(route),
    routeUserId: route,
    emailHash: account,
  };
}

/** Gemini moves to another account slot: its account control and route change together. */
function openRoute(path: string): void {
  const slot = path.match(/^\/u\/(\d+)\//)?.[1] ?? '1';
  showGeminiAccount(`${{ '1': 'a', '2': 'b' }[slot] ?? `slot${slot}`}@example.com`);
  history.pushState({}, '', path);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('FolderManager account routes across mounted surfaces', () => {
  let manager: FolderManager | null;
  let adapter: storageAdapters.IFolderStorageAdapter;

  async function initialize(surface: Surface): Promise<FolderManager> {
    vi.mocked(chrome.storage.sync.get).mockImplementation(async (keys) => ({
      ...(keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {}),
      [StorageKeys.FOLDER_FLOATING_MODE_ENABLED]: surface !== 'sidebar',
      [StorageKeys.FOLDER_FLOATING_OPEN_ON_START]: surface !== 'fab',
    }));
    manager = new FolderManager();
    await manager.init();
    expect(manager.getFolders().map((folder) => folder.name)).toEqual(['Private a']);
    return manager;
  }

  function setEnabled(enabled: boolean): void {
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ geminiFolderEnabled: { newValue: enabled } }, 'sync');
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    history.replaceState({}, '', '/u/1/app');
    mountSidebar();
    showGeminiAccount('a@example.com');
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
    vi.mocked(chrome.storage.local.set).mockResolvedValue();
    vi.mocked(chrome.storage.sync.set).mockResolvedValue();
    vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(true);
    vi.spyOn(accountIsolationService, 'resolveAccountScope').mockImplementation(async (context) =>
      accountScope(context?.routeUserId === '2' ? 'b' : 'a', context?.routeUserId ?? '1'),
    );
    adapter = {
      init: vi.fn(async () => {}),
      loadData: vi.fn(async (key) =>
        accountData(key === buildScopedFolderStorageKey('email:b') ? 'b' : 'a'),
      ),
      saveData: vi.fn(async () => true),
      removeData: vi.fn(async () => {}),
      getBackendName: () => 'test-memory',
    };
    vi.spyOn(storageAdapters, 'createFolderStorageAdapter').mockReturnValue(adapter);
    // History fetching is independent of the manager's account route listener.
    vi.spyOn(FolderStore.prototype, 'initializeConversationActivityTracking').mockResolvedValue();
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['sidebar', 'floating', 'fab'] as const)(
    'clears account A on a real route change from %s and waits for account B to load',
    async (surface) => {
      const instance = await initialize(surface);
      const resolution = deferred<AccountScope>();
      const loaded = deferred<FolderData>();
      const loadStarted = deferred<void>();
      vi.mocked(accountIsolationService.resolveAccountScope).mockReturnValueOnce(
        resolution.promise,
      );
      vi.mocked(adapter.loadData).mockImplementationOnce(() => {
        loadStarted.resolve();
        return loaded.promise;
      });

      openRoute('/u/2/app');
      await vi.advanceTimersByTimeAsync(0);

      expect(instance.getFolders()).toEqual([]);
      expect(pageText()).not.toContain('Private a');
      if (surface === 'fab') {
        const fab = document.querySelector<HTMLButtonElement>('.gv-floating-fab')!;
        expect(fab).not.toBeNull();
        fab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);
      }
      const host = document.querySelector<HTMLElement>(
        surface === 'sidebar' ? '.gv-folder-container' : '.gv-floating-folder-panel',
      )!;
      // The floating panel renders inside its shadow root; the sidebar's tree in one in the panel.
      const root: ParentNode & Node = host.shadowRoot ?? host;
      const create = root.querySelector<HTMLButtonElement>(
        surface === 'sidebar' ? '.gv-folder-add-btn' : '[aria-label="floatingPanelCreateFolder"]',
      )!;
      const tree = () => (surface === 'sidebar' ? sidebarTreeRoot(host) : root);
      const editor = () =>
        tree().querySelector<HTMLInputElement>(
          `input[placeholder="floatingPanelFolderNamePlaceholder"]`,
        );
      expect(create.disabled).toBe(true);
      create.click();
      expect(editor()).toBeNull();
      expect(adapter.saveData).not.toHaveBeenCalled();

      resolution.resolve(accountScope('b', '2'));
      await loadStarted.promise;
      expect(create.disabled).toBe(true);
      expect(instance.getFolders()).toEqual([]);
      loaded.resolve(accountData('b'));
      await vi.advanceTimersByTimeAsync(0);

      expect(create.disabled).toBe(false);
      expect(tree().textContent).toContain('Private b');
      expect(instance.getFolders().map((folder) => folder.name)).toEqual(['Private b']);
      create.click();
      const input = editor()!;
      input.value = 'Created for B';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.saveData).toHaveBeenCalledWith(
        buildScopedFolderStorageKey('email:b'),
        expect.objectContaining({
          folders: expect.arrayContaining([expect.objectContaining({ name: 'Created for B' })]),
        }),
      );
    },
  );

  it('renders an issued import when it finishes after leaving and returning to account A', async () => {
    const instance = await initialize('sidebar');
    const write = deferred<boolean>();
    vi.mocked(adapter.saveData).mockReturnValueOnce(write.promise);
    const imported = accountData('imported-a');
    imported.folders[0].name = 'Imported A';

    document.querySelector<HTMLButtonElement>('.gv-folder-import-export-btn')!.click();
    Array.from(document.querySelectorAll<HTMLButtonElement>('.gv-folder-menu-item'))
      .find((button) => button.textContent?.endsWith('folder_import'))!
      .click();
    document.querySelector<HTMLButtonElement>('.gv-folder-import-paste-toggle')!.click();
    document.querySelector<HTMLTextAreaElement>('.gv-folder-import-paste-area')!.value =
      JSON.stringify(FolderImportExportService.exportToPayload(imported));
    document.querySelector<HTMLButtonElement>('.gv-folder-dialog-btn-primary')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.saveData).toHaveBeenCalledExactlyOnceWith(
      buildScopedFolderStorageKey('email:a'),
      expect.objectContaining({
        folders: expect.arrayContaining([expect.objectContaining({ name: 'Imported A' })]),
      }),
    );

    openRoute('/u/2/app');
    await vi.advanceTimersByTimeAsync(0);
    expect(sidebarFolders()).toContain('Private b');
    expect(sidebarFolders()).not.toContain('Imported A');
    expect(document.querySelector('.gv-folder-import-dialog')).toBeNull();
    openRoute('/u/1/app');
    await vi.advanceTimersByTimeAsync(0);
    expect(instance.getFolders().map((folder) => folder.name)).toEqual(['Private a']);
    expect(sidebarFolders()).toContain('Private a');

    write.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(instance.getFolders().map((folder) => folder.name)).toEqual(['Private a', 'Imported A']);
    expect(sidebarFolders()).toContain('Imported A');
    expect(sidebarFolders()).not.toContain('Private b');
    expect(toastDriver.all().filter(({ tone }) => tone === 'success')).toEqual([]);
  });

  it.each(['floating', 'fab'] as const)(
    '%s rebinds once after disable/re-enable and stops reacting after destroy',
    async (surface) => {
      const instance = await initialize(surface);
      setEnabled(false);
      vi.mocked(accountIsolationService.resolveAccountScope).mockClear();
      openRoute('/u/1/app/while-disabled');
      await vi.advanceTimersByTimeAsync(1000);
      expect(accountIsolationService.resolveAccountScope).not.toHaveBeenCalled();
      expect(document.querySelector('.gv-floating-folder-panel, .gv-floating-fab')).toBeNull();

      setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelectorAll('.gv-floating-folder-panel, .gv-floating-fab')).toHaveLength(
        1,
      );
      openRoute('/u/2/app');
      await vi.advanceTimersByTimeAsync(1000);
      expect(instance.getFolders().map((folder) => folder.name)).toEqual(['Private b']);
      expect(accountIsolationService.resolveAccountScope).toHaveBeenCalledTimes(1);

      instance.destroy();
      manager = null;
      vi.mocked(accountIsolationService.resolveAccountScope).mockClear();
      openRoute('/u/3/app');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(accountIsolationService.resolveAccountScope).not.toHaveBeenCalled();
      expect(document.querySelector('.gv-floating-folder-panel, .gv-floating-fab')).toBeNull();
    },
  );
});
