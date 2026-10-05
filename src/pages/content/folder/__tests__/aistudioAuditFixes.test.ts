import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';

import { FolderRepository } from '../FolderRepository';
import { AIStudioFolderManager } from '../aistudio';
import { applyHideArchivedRows } from '../aistudioLibraryTable';
import { AIStudioTransfer, createSyncMessageListener } from '../aistudioTransfer';
import { AISTUDIO_FOLDER_CONFIG } from '../platformFolderConfig';
import { AIStudioFolderStorageAdapter } from '../storage/AIStudioFolderStorageAdapter';
import type { FolderData } from '../types';

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
      sendMessage: vi.fn(),
    },
  },
}));

type StoredConversation = {
  conversationId: string;
  title: string;
  url: string;
  addedAt: number;
  updatedAt?: number;
  customTitle?: boolean;
};

type ManagerInternals = {
  dataSession: { ready: boolean };
  data: {
    folders: Array<{
      id: string;
      name: string;
      parentId: string | null;
      isExpanded: boolean;
      createdAt: number;
      updatedAt: number;
    }>;
    folderContents: Record<string, StoredConversation[]>;
  };
  container: HTMLElement | null;
  folderEnabled: boolean;
  account: { polling: boolean };
  library: { mountDropZone: () => void };
  startAccountPolling: () => void;
  watchContainerMount: () => void;
  injectUI: () => void;
  destroy: () => void;
  applyFolderEnabledSetting: () => void;
  initializeFolderUI: () => Promise<void>;
  syncConversationTitlesFromPromptList: () => Promise<void>;
  save: () => Promise<boolean>;
  render: () => void;
};

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => unknown;

const managersToDestroy: ManagerInternals[] = [];

function createManager(): { manager: AIStudioFolderManager; internals: ManagerInternals } {
  const manager = new AIStudioFolderManager();
  const internals = manager as unknown as ManagerInternals;
  // These unit cases start after the initial folder load.
  internals.dataSession.ready = true;
  managersToDestroy.push(internals);
  return { manager, internals };
}

function createPromptLink(
  promptId: string,
  title: string,
  options: { promptLinkClass?: boolean; href?: string } = {},
): HTMLAnchorElement {
  const anchor = document.createElement('a');
  if (options.promptLinkClass !== false) anchor.className = 'prompt-link';
  anchor.setAttribute('href', options.href ?? `/prompts/${promptId}`);
  anchor.textContent = title;
  document.body.appendChild(anchor);
  return anchor;
}

function createLibraryRow(promptId: string): HTMLTableRowElement {
  let table = document.querySelector('table.mat-mdc-table') as HTMLTableElement | null;
  if (!table) {
    table = document.createElement('table');
    table.className = 'mat-mdc-table';
    document.body.appendChild(table);
  }
  const row = document.createElement('tr');
  row.className = 'mat-mdc-row';
  const cell = document.createElement('td');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', `/prompts/${promptId}`);
  anchor.textContent = `Prompt ${promptId}`;
  cell.appendChild(anchor);
  row.appendChild(cell);
  table.appendChild(row);
  return row;
}

function storedConversation(conversationId: string, title: string): StoredConversation {
  return { conversationId, title, url: `/prompts/${conversationId}`, addedAt: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
});

afterEach(() => {
  for (const internals of managersToDestroy.splice(0)) {
    try {
      internals.destroy();
    } catch {}
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.className = '';
  window.history.pushState({}, '', '/');
});

describe('H1 — runtime message listener response contract', () => {
  function syncListener(): MessageListener {
    return createSyncMessageListener({
      canEdit: () => true,
      data: () => ({ folders: [], folderContents: {} }),
      accountScope: () => null,
      reload: async () => {},
    }) as unknown as MessageListener;
  }

  it('does not publish an empty AI Studio snapshot before folders have loaded', async () => {
    const repository = new FolderRepository(
      AISTUDIO_FOLDER_CONFIG,
      new AIStudioFolderStorageAdapter(),
      {
        onChange: () => {},
        onRecovery: () => {},
        onExternalChange: () => {},
        onAccountReleased: () => {},
        isEnabled: () => true,
      },
    );
    const listener = createSyncMessageListener({
      canEdit: () => repository.canEdit,
      data: () => repository.data,
      accountScope: () => repository.accountScope,
      reload: () => repository.loadData(),
    }) as unknown as MessageListener;
    const sendResponse = vi.fn();
    try {
      listener({ type: 'gv.sync.requestData' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenLastCalledWith({ ok: false });
      vi.mocked(browser.storage.sync.get).mockResolvedValue({});
      vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => ({
        [StorageKeys.FOLDER_DATA_AISTUDIO]: { folders: [], folderContents: {} },
      }));
      await repository.init();
      listener({ type: 'gv.sync.requestData' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenLastCalledWith(
        expect.objectContaining({ ok: true, data: { folders: [], folderContents: {} } }),
      );
    } finally {
      repository.destroy();
    }
  });

  it('returns undefined for unknown messages so the sender promise settles', () => {
    const listener = syncListener();
    const sendResponse = vi.fn();

    const result = listener({ type: 'gv.some.unrelated.broadcast' }, {}, sendResponse);

    expect(result).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('still answers gv.sync.requestData synchronously with return true', () => {
    const listener = syncListener();
    const sendResponse = vi.fn();

    const result = listener({ type: 'gv.sync.requestData' }, {}, sendResponse);

    expect(result).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

describe('Drive prompt merge', () => {
  it('preserves the local name when a newer legacy cloud prompt omits it', async () => {
    const local: PromptItem = {
      id: 'prompt-1',
      name: 'Keep this name',
      text: 'local text',
      tags: ['local'],
      createdAt: 1,
      updatedAt: 10,
    };
    const cloud: PromptItem = {
      id: 'prompt-1',
      text: 'newer cloud text',
      tags: ['cloud'],
      createdAt: 1,
      updatedAt: 20,
    };

    const data: FolderData = { folders: [], folderContents: {} };
    const session = { data, accountScope: null };
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ gvPromptItems: [local] } as never);
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      ok: true,
      data: { folders: { data }, prompts: { items: [cloud] } },
    });
    const replaceData = vi.fn().mockResolvedValue(true);
    const transfer = new AIStudioTransfer({
      t: (key) => key,
      session: () => session as never,
      activation: () => 1,
      canEdit: () => true,
      data: () => data,
      replaceData,
      notify: vi.fn(),
    });

    await transfer.sync();

    expect(replaceData).toHaveBeenCalledWith(expect.anything(), [
      { ...cloud, name: 'Keep this name' },
    ]);
  });
});

describe('H7 — single-scan native title sync', () => {
  it('resolves all stored conversation titles with one document scan', async () => {
    createPromptLink('conv1', 'Native One');
    createPromptLink('conv2', 'Native Two');
    createPromptLink('conv3', 'Native Three', {
      promptLinkClass: false,
      href: '/u/1/prompts/conv3',
    });

    const { internals } = createManager();
    internals.data = {
      folders: [],
      folderContents: {
        folderA: [storedConversation('conv1', 'Old One'), storedConversation('conv2', 'Old Two')],
        folderB: [storedConversation('conv3', 'Old Three')],
      },
    };
    internals.save = vi.fn().mockResolvedValue(true);
    internals.render = vi.fn();

    const qsaSpy = vi.spyOn(document, 'querySelectorAll');
    await internals.syncConversationTitlesFromPromptList();

    expect(internals.data.folderContents.folderA[0]?.title).toBe('Native One');
    expect(internals.data.folderContents.folderA[1]?.title).toBe('Native Two');
    expect(internals.data.folderContents.folderB[0]?.title).toBe('Native Three');
    // One collectNativePromptTitles scan — not 3 selector scans per conversation.
    expect(qsaSpy).toHaveBeenCalledTimes(1);
    expect(internals.save).toHaveBeenCalledTimes(1);
    expect(internals.render).toHaveBeenCalledTimes(1);
  });

  it('prefers prompt-link anchors over generic anchors for the same prompt id', async () => {
    createPromptLink('dup1', 'Generic Title', { promptLinkClass: false });
    createPromptLink('dup1', 'Prompt Link Title');

    const { internals } = createManager();
    internals.data = {
      folders: [],
      folderContents: { folderA: [storedConversation('dup1', 'Old')] },
    };
    internals.save = vi.fn().mockResolvedValue(true);
    internals.render = vi.fn();

    await internals.syncConversationTitlesFromPromptList();

    expect(internals.data.folderContents.folderA[0]?.title).toBe('Prompt Link Title');
  });

  it('leaves titles untouched when no native prompt links are present', async () => {
    const { internals } = createManager();
    internals.data = {
      folders: [],
      folderContents: { folderA: [storedConversation('ghost1', 'Kept Title')] },
    };
    internals.save = vi.fn().mockResolvedValue(true);
    internals.render = vi.fn();

    await internals.syncConversationTitlesFromPromptList();

    expect(internals.data.folderContents.folderA[0]?.title).toBe('Kept Title');
    expect(internals.save).not.toHaveBeenCalled();
  });
});

describe('M11 — destroy() lifecycle teardown', () => {
  function mountLibraryPage(): ManagerInternals {
    window.history.pushState({}, '', '/library');
    document.body.innerHTML =
      '<div class="nav-content v3-left-nav"><nav><div class="empty-space"></div></nav></div>';
    const empty = { folders: [], folderContents: {} };
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [StorageKeys.FOLDER_DATA_AISTUDIO]: empty,
    } as never);
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.sync.get).mockResolvedValue({});
    return createManager().internals;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('clears timers and injected DOM, and is idempotent', async () => {
    vi.useFakeTimers();
    const internals = mountLibraryPage();
    internals.startAccountPolling();
    await internals.initializeFolderUI();

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(document.querySelector('.gv-folder-container')).not.toBeNull();
    expect(document.querySelector('.gv-library-drop-zone')).not.toBeNull();
    expect(document.querySelector('.gv-sidebar-resize-handle')).not.toBeNull();

    internals.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.gv-folder-container')).toBeNull();
    expect(document.querySelector('.gv-library-drop-zone')).toBeNull();
    expect(document.querySelector('.gv-sidebar-resize-handle')).toBeNull();
    expect(document.documentElement.classList.contains('gv-aistudio-root')).toBe(false);
    expect(() => internals.destroy()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no observer binding prompt links or library rows after destroy', async () => {
    const internals = mountLibraryPage();
    await internals.initializeFolderUI();
    internals.destroy();

    const row = createLibraryRow('late-row');
    const overlay = document.createElement('div');
    overlay.className = 'cdk-overlay-pane';
    const link = document.createElement('a');
    link.setAttribute('href', '/prompts/late-popover');
    overlay.appendChild(link);
    document.body.appendChild(overlay);
    await settle();

    expect(row.draggable).toBe(false);
    expect(link.dataset.gvDragBound).toBeUndefined();
  });

  it('destroys on disable and re-initializes through initializeFolderUI on enable', async () => {
    vi.useFakeTimers();
    const { internals } = createManager();
    internals.startAccountPolling();

    const container = document.createElement('div');
    document.body.appendChild(container);
    internals.container = container;

    internals.folderEnabled = false;
    internals.applyFolderEnabledSetting();

    expect(internals.container).toBeNull();
    expect(document.body.contains(container)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const initSpy = vi.fn().mockResolvedValue(undefined);
    internals.initializeFolderUI = initSpy;
    internals.folderEnabled = true;
    internals.applyFolderEnabledSetting();

    // Re-enable resolves account ownership before initializing the folder UI.
    await vi.waitFor(() => expect(initSpy).toHaveBeenCalledTimes(1));
    // The account-scope poller stopped by destroy() is restarted on re-enable.
    expect(internals.account.polling).toBe(true);
  });

  it('keeps one panel mount watch however often it is re-armed', async () => {
    const navContent = document.createElement('div');
    navContent.className = 'nav-content v3-left-nav';
    document.body.appendChild(navContent);
    const { internals } = createManager();
    const injectUI = vi.fn();
    internals.injectUI = injectUI;

    internals.watchContainerMount();
    internals.watchContainerMount();
    internals.watchContainerMount();
    internals.destroy();
    internals.container = document.createElement('div');
    navContent.appendChild(document.createElement('span'));
    await settle();

    expect(injectUI).not.toHaveBeenCalled();
  });
});

describe('L12 — floating drop zone heartbeat and archived-row set', () => {
  function dispatchLibraryDragStart(row: HTMLElement): void {
    const dragstart = new Event('dragstart', { bubbles: true }) as DragEvent;
    row.dispatchEvent(dragstart);
  }

  it('hides the floating drop zone when dragover heartbeats stop mid-drag', async () => {
    vi.useFakeTimers();
    const { internals } = createManager();
    internals.data = {
      folders: [
        {
          id: 'f1',
          name: 'Folder',
          parentId: null,
          isExpanded: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folderContents: { f1: [] },
    };
    internals.save = vi.fn().mockResolvedValue(true);

    const row = createLibraryRow('drag1');
    internals.library.mountDropZone();
    const zone = document.querySelector('.gv-library-drop-zone') as HTMLElement;
    expect(zone).not.toBeNull();

    dispatchLibraryDragStart(row);
    await vi.advanceTimersByTimeAsync(0);
    expect(zone.style.opacity).toBe('1');

    // dragover traffic keeps the zone alive past the heartbeat window...
    await vi.advanceTimersByTimeAsync(500);
    document.dispatchEvent(new Event('dragover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(zone.style.opacity).toBe('1');

    // ...but a silent gap (source row torn out, no dragend/drop) hides it.
    await vi.advanceTimersByTimeAsync(400);
    expect(zone.style.opacity).toBe('0');
  });

  it('hides the floating drop zone on a document-level drop', async () => {
    vi.useFakeTimers();
    const { internals } = createManager();
    internals.data = {
      folders: [
        {
          id: 'f1',
          name: 'Folder',
          parentId: null,
          isExpanded: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folderContents: { f1: [] },
    };
    internals.save = vi.fn().mockResolvedValue(true);

    const row = createLibraryRow('drag2');
    internals.library.mountDropZone();
    const zone = document.querySelector('.gv-library-drop-zone') as HTMLElement;

    dispatchLibraryDragStart(row);
    await vi.advanceTimersByTimeAsync(0);
    expect(zone.style.opacity).toBe('1');

    document.dispatchEvent(new Event('drop', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(zone.style.opacity).toBe('0');
  });

  it('hides archived library rows via a per-pass id set', () => {
    window.history.pushState({}, '', '/library');
    const archivedRow = createLibraryRow('archived1');
    const freeRow = createLibraryRow('free1');

    applyHideArchivedRows(
      {
        folders: [
          {
            id: 'f1',
            name: 'Folder',
            parentId: null,
            isExpanded: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        folderContents: { f1: [storedConversation('archived1', 'Archived')] },
      },
      true,
    );

    expect(archivedRow.classList.contains('gv-conversation-archived')).toBe(true);
    expect(freeRow.classList.contains('gv-conversation-archived')).toBe(false);
  });
});
