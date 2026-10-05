/**
 * Behavior AI Studio gained by moving onto FolderRepository: it reloads when
 * another context writes its active bucket, ignores its own write echoes, and
 * retries a failed account-scope resolution before the next account poll.
 */
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import { handlePromptLibraryApplyMessage } from '@/features/prompt/library/promptLibraryMessages';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';
import { useCloudSyncTransfer } from '@/pages/popup/components/useCloudSyncTransfer';
import { toastDriver } from '@/tests/toastDriver';

import { AIStudioFolderManager } from '../aistudio';
import type { FolderData } from '../types';
import { nameInput, tree, treeText } from './aistudioTreeDriver';

const { mockBrowser } = vi.hoisted(() => ({
  mockBrowser: {
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
    },
  },
}));

vi.mock('webextension-polyfill', () => ({ default: mockBrowser }));

type Manager = {
  data: FolderData;
  activeStorageKey: string;
  save(): Promise<boolean>;
  transfer: { sync(): Promise<void>; upload(): Promise<void> };
  destroy(): void;
};

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

const GLOBAL_KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
let local: Record<string, unknown>;
let sync: Record<string, unknown>;
const managers: Manager[] = [];

function pick(values: Record<string, unknown>, keys: unknown): Record<string, unknown> {
  if (typeof keys === 'string') return structuredClone({ [keys]: values[keys] });
  if (Array.isArray(keys)) {
    return structuredClone(Object.fromEntries(keys.map((key) => [key, values[key]])));
  }
  if (keys && typeof keys === 'object') {
    return structuredClone(
      Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]),
      ),
    );
  }
  return structuredClone(values);
}

function folderData(name: string): FolderData {
  return {
    folders: [{ id: name, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
    folderContents: { [name]: [] },
  };
}

function emitStorageChange(values: Record<string, unknown>, area: string): void {
  const changes = Object.fromEntries(
    Object.entries(values).map(([key, newValue]) => [key, { newValue }]),
  );
  for (const [listener] of mockBrowser.storage.onChanged.addListener.mock.calls) {
    (listener as StorageListener)(changes, area);
  }
}

/** chrome.storage hands listeners a fresh copy whose object keys come back sorted. */
function sortedClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedClone((value as Record<string, unknown>)[key])]),
  );
}

/** Another tab, the popup or cloud sync writes local storage. */
function writeFromElsewhere(values: Record<string, unknown>): void {
  Object.assign(local, structuredClone(values));
  emitStorageChange(values, 'local');
}

function bucketReads(key: string): number {
  return mockBrowser.storage.local.get.mock.calls.filter(([keys]) => keys === key).length;
}

function panelText(): string {
  return treeText();
}

async function scopedKey(account: string): Promise<string> {
  const scope = await accountIsolationService.resolveAccountScope({
    pageUrl: window.location.href,
    email: `${account}@example.com`,
  });
  return buildScopedStorageKey(GLOBAL_KEY, scope.accountKey);
}

async function mount(): Promise<Manager> {
  const instance = new AIStudioFolderManager();
  const manager = instance as unknown as Manager;
  managers.push(manager);
  await instance.init();
  return manager;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = `
    <span class="account-switcher-text" data-email="a@example.com">a@example.com</span>
    <div class="nav-content v3-left-nav"><nav><div class="empty-space"></div></nav></div>`;
  (
    globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }
  ).jsdom.reconfigure({ url: 'https://aistudio.google.com/' });
  local = {};
  sync = {
    [StorageKeys.LANGUAGE]: 'en',
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
    geminiFolderEnabled: true,
  };
  mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => pick(local, keys));
  // Like chrome.storage: a write that changes a value echoes back to this context's
  // listeners in a later task; an unchanged value or a rejected write emits nothing.
  mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
    const changed = Object.fromEntries(
      Object.entries(values)
        .filter(([key, value]) => JSON.stringify(local[key]) !== JSON.stringify(value))
        .map(([key, value]) => [key, sortedClone(value)]),
    );
    Object.assign(local, structuredClone(values));
    if (Object.keys(changed).length > 0) setTimeout(() => emitStorageChange(changed, 'local'), 0);
  });
  mockBrowser.storage.sync.get.mockImplementation(async (keys: unknown) => pick(sync, keys));
  mockBrowser.storage.sync.set.mockImplementation(async (values: Record<string, unknown>) => {
    Object.assign(sync, structuredClone(values));
  });
  chrome.storage.local.get = mockBrowser.storage.local.get as typeof chrome.storage.local.get;
  chrome.storage.local.set = mockBrowser.storage.local.set as typeof chrome.storage.local.set;
  chrome.storage.sync.get = mockBrowser.storage.sync.get as typeof chrome.storage.sync.get;
  chrome.storage.sync.set = mockBrowser.storage.sync.set as typeof chrome.storage.sync.set;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.className = '';
});

describe('AI Studio folder sync across contexts', () => {
  it('reloads and repaints when another tab writes the active bucket', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    expect(panelText()).toContain('Mine');

    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('From another tab'));
    expect(panelText()).toContain('From another tab');
    expect(panelText()).not.toContain('Mine');
  });

  it('does not reload for its own writes, including a merged cloud draft', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    local.gvPromptItems = [];
    const manager = await mount();
    const readsAfterMount = bucketReads(GLOBAL_KEY);

    manager.data.folders[0].name = 'Edited here';
    await expect(manager.save()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    const prompt: PromptItem = { id: 'p', text: 'Prompt', tags: [], createdAt: 1, updatedAt: 1 };
    mockBrowser.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: { folders: { data: folderData('Cloud') }, prompts: { items: [prompt] } },
    });
    await manager.transfer.sync();
    await vi.advanceTimersByTimeAsync(0);

    expect(bucketReads(GLOBAL_KEY)).toBe(readsAfterMount);
    expect(local.gvPromptItems).toEqual([prompt]);
    expect(manager.data.folders.map((folder) => folder.name)).toEqual(['Edited here', 'Cloud']);
  });

  it('leaves only the result once a cloud transfer finishes, not its in-progress notice', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    local.gvPromptItems = [];
    const manager = await mount();

    mockBrowser.runtime.sendMessage.mockResolvedValue({ ok: true });
    await manager.transfer.upload();
    expect(toastDriver.all().map((toast) => toast.tone)).toEqual(['success']);

    mockBrowser.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'offline' });
    await manager.transfer.sync();
    expect(toastDriver.all()).toMatchObject([{ tone: 'error' }]);
    expect(toastDriver.messages()[0]).toContain('offline');
  });

  it("shows AI Studio's own last upload and sync times in the cloud tooltips, not Gemini's", async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    const now = Date.now();
    mockBrowser.runtime.sendMessage.mockResolvedValue({
      ok: true,
      state: {
        lastUploadTime: now - 3 * 3_600_000,
        lastSyncTime: now - 3 * 3_600_000,
        lastUploadTimeAIStudio: now - 5 * 60_000,
        lastSyncTimeAIStudio: null,
      },
    });
    const button = (title: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('.gv-aistudio .gv-folder-action-btn')].find(
        (candidate) => candidate.title.startsWith(title),
      )!;
    const upload = button('Upload to Cloud');
    const sync = button('Sync from Cloud');

    upload.dispatchEvent(new MouseEvent('mouseenter'));
    sync.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(0);

    expect(upload.title).toBe('Upload to Cloud\nUploaded: 5 minutes ago');
    expect(sync.title).toBe('Sync from Cloud\nNever synced');
  });

  it('reloads another tab write that follows an unchanged save', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();

    await expect(manager.save()).resolves.toBe(true);
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('From another tab'));
  });

  it('reloads another tab write that follows a rejected save', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    mockBrowser.storage.local.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));

    manager.data.folders[0].name = 'Edited here';
    await expect(manager.save()).resolves.toBe(false);
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('From another tab'));
  });

  it('reloads when another tab restores the value of an earlier own write', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    const readsAfterMount = bucketReads(GLOBAL_KEY);

    await expect(manager.save()).resolves.toBe(true);
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('Mine') });
    await vi.advanceTimersByTimeAsync(0);

    expect(bucketReads(GLOBAL_KEY)).toBe(readsAfterMount + 2);
    expect(manager.data).toEqual(folderData('Mine'));
  });

  it('applies another tab write that lands while its own write is pending', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    const write = Promise.withResolvers<void>();
    const commit = mockBrowser.storage.local.set.getMockImplementation()!;
    mockBrowser.storage.local.set.mockImplementationOnce(
      async (values: Record<string, unknown>) => {
        await commit(values); // committed and echoed; the storage promise is still pending
        return write.promise;
      },
    );

    manager.data.folders[0].name = 'Edited here';
    const saving = manager.save();
    await vi.advanceTimersByTimeAsync(0);
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    write.resolve();
    await expect(saving).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.data).toEqual(folderData('From another tab'));

    manager.data.folders[0].isExpanded = false;
    await expect(manager.save()).resolves.toBe(true);
    expect(local[GLOBAL_KEY]).toEqual({
      ...folderData('From another tab'),
      folders: [{ ...folderData('From another tab').folders[0], isExpanded: false }],
    });
  });

  it('restores a bucket another tab removed once, then settles', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    const readsBefore = bucketReads(GLOBAL_KEY);

    writeFromElsewhere({ [GLOBAL_KEY]: undefined });
    await vi.advanceTimersByTimeAsync(1000);
    expect(local[GLOBAL_KEY]).toEqual(folderData('Mine'));
    const reads = bucketReads(GLOBAL_KEY);
    expect(reads).toBe(readsBefore + 1); // the recovery write answers the removal; no reread

    manager.data.folders[0].isExpanded = false;
    await expect(manager.save()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bucketReads(GLOBAL_KEY)).toBe(reads);
  });

  it('does not keep rewriting a removed bucket while the write fails', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    const read = mockBrowser.storage.local.get.getMockImplementation()!;
    mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => {
      await new Promise((tick) => setTimeout(tick, 10)); // a reload loop shows up as a count
      return read(keys);
    });
    const writes = () =>
      mockBrowser.storage.local.set.mock.calls.filter(([values]) => GLOBAL_KEY in values).length;
    mockBrowser.storage.local.set.mockRejectedValue(new Error('quota'));

    writeFromElsewhere({ [GLOBAL_KEY]: undefined });
    await vi.advanceTimersByTimeAsync(1000);
    const attempts = writes();
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes()).toBe(attempts);
  });

  it('does not reload for an unchanged save that the browser still reports', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    // Like Firefox: every write is reported, even one that leaves the value unchanged.
    mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(local, structuredClone(values));
      setTimeout(() => emitStorageChange(sortedClone(values) as Record<string, unknown>, 'local'));
    });
    const readsAfterMount = bucketReads(GLOBAL_KEY);

    manager.data.folders[0].name = 'Edited here';
    await expect(manager.save()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await expect(manager.save()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(bucketReads(GLOBAL_KEY)).toBe(readsAfterMount);
  });

  it.each([
    'suspended',
    'rebound while disabled',
    'waiting for its re-enable reload',
    'waiting for its re-enable reload after a disabled rebind',
    're-enabled with a concurrent external write: Merge keeps folder A',
  ])(
    'popup Merge preserves stored folders when an empty AI Studio manager is %s',
    async (lifecycle) => {
      local[GLOBAL_KEY] = { folders: [], folderContents: {} };
      const manager = await mount();
      sync.geminiFolderEnabled = false;
      emitStorageChange({ geminiFolderEnabled: false }, 'sync');
      if (lifecycle.includes('rebound') || lifecycle.includes('rebind')) {
        await scopedKey('a');
        sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] = true;
        emitStorageChange({ [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: true }, 'sync');
        await vi.advanceTimersByTimeAsync(0);
        sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] = false;
        emitStorageChange({ [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false }, 'sync');
        await vi.advanceTimersByTimeAsync(0);
      }
      const concurrentWrite = lifecycle.startsWith('re-enabled');
      const localName = concurrentWrite ? 'A' : 'Local only';
      if (!concurrentWrite) writeFromElsewhere({ [GLOBAL_KEY]: folderData(localName) });
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.data).toEqual({ folders: [], folderContents: {} });
      const heldRead = Promise.withResolvers<void>();
      const startedRead = Promise.withResolvers<void>();
      const staleReads = Promise.withResolvers<void>();
      const waitingForReload = lifecycle.startsWith('waiting') || concurrentWrite;
      if (waitingForReload) {
        const read = mockBrowser.storage.local.get.getMockImplementation()!;
        mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => {
          if (keys === GLOBAL_KEY) {
            const captured = await read(keys);
            startedRead.resolve();
            if (concurrentWrite && !(captured[GLOBAL_KEY] as FolderData).folders.length) {
              await staleReads.promise;
              return captured;
            }
            await heldRead.promise;
          }
          return read(keys);
        });
        sync.geminiFolderEnabled = true;
        emitStorageChange({ geminiFolderEnabled: true }, 'sync');
        await vi.advanceTimersByTimeAsync(0);
        await startedRead.promise;
        if (concurrentWrite) {
          writeFromElsewhere({ [GLOBAL_KEY]: folderData(localName) });
          staleReads.resolve();
          await vi.advanceTimersByTimeAsync(1_000);
        }
      }

      type Receiver = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
      const responses: unknown[] = [];
      vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((async (
        _id: number,
        message: unknown,
      ) => {
        let response: unknown;
        for (const [receiver] of mockBrowser.runtime.onMessage.addListener.mock.calls) {
          (receiver as Receiver)(message, {}, (value: unknown) => {
            response = structuredClone(value);
          });
        }
        if ((message as { type: string }).type === 'gv.sync.requestData') responses.push(response);
        return response;
      }) as typeof chrome.tabs.sendMessage);
      // The popup restores the shared prompts through the background prompt owner.
      const prompts = createPromptLibraryOwner({
        area: {
          get: (key) => mockBrowser.storage.local.get(key),
          set: (items) => mockBrowser.storage.local.set(items),
        },
      });
      vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((message: unknown) =>
        handlePromptLibraryApplyMessage(message, prompts)) as typeof chrome.runtime.sendMessage);
      let transfer!: ReturnType<typeof useCloudSyncTransfer>;
      function Harness() {
        const current = useCloudSyncTransfer(
          'aistudio',
          false,
          async () => ({ id: 3, url: 'https://aistudio.google.com/' }) as chrome.tabs.Tab,
        );
        useEffect(() => {
          transfer = current;
        }, [current]);
        return null;
      }
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const root = createRoot(document.createElement('div'));
      try {
        await act(async () => root.render(createElement(Harness)));
        const download = await transfer.prepareDownload();
        await download.restore({ folders: { data: folderData('Cloud') } }, 'merge', false);
        expect((local[GLOBAL_KEY] as FolderData).folders.map((folder) => folder.name)).toEqual([
          localName,
          'Cloud',
        ]);
        expect(responses).toEqual([{ ok: false }]);
      } finally {
        staleReads.resolve();
        heldRead.resolve();
        await act(async () => root.unmount());
      }
      if (!waitingForReload) {
        sync.geminiFolderEnabled = true;
        emitStorageChange({ geminiFolderEnabled: true }, 'sync');
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(panelText()).toContain(localName);
      expect(panelText()).toContain('Cloud');
      tree.startRootFolder();
      const input = nameInput()!;
      expect(input).not.toBeNull();
      input.value = 'After resume';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect((local[GLOBAL_KEY] as FolderData).folders.map((folder) => folder.name)).toContain(
        'After resume',
      );
    },
  );

  it('ignores other buckets, other areas and a disabled folder feature', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    const manager = await mount();
    const readsAfterMount = bucketReads(GLOBAL_KEY);

    writeFromElsewhere({ [StorageKeys.FOLDER_DATA]: folderData('Gemini') });
    emitStorageChange({ [GLOBAL_KEY]: folderData('Sync area') }, 'sync');
    emitStorageChange({ geminiFolderEnabled: false }, 'sync');
    writeFromElsewhere({ [GLOBAL_KEY]: folderData('While disabled') });
    await vi.advanceTimersByTimeAsync(0);

    expect(bucketReads(GLOBAL_KEY)).toBe(readsAfterMount);
    expect(manager.data).toEqual(folderData('Mine'));
  });
});

// The sidebar tree is the shared folder tree: it keeps one name form open at a
// time, and while that form's input has focus it holds a reload back until the
// form closes, so typing is never rebuilt away.
describe('AI Studio inline folder drafts across reloads', () => {
  function twoFolders(first: string, second: string): FolderData {
    return {
      folders: [...folderData(first).folders, ...folderData(second).folders],
      folderContents: { [first]: [], [second]: [] },
    };
  }

  function press(input: HTMLInputElement, key: string): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  function folderNames(): string[] {
    return (local[GLOBAL_KEY] as FolderData).folders.map((folder) => folder.name);
  }

  it('keeps an unfinished new-folder name and creates it on top of the reloaded data', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    tree.startRootFolder();
    const input = nameInput()!;
    input.value = 'Draft';

    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);
    expect(nameInput()).toBe(input);
    expect(input.value).toBe('Draft');

    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(folderNames()).toEqual(['From another tab', 'Draft']);
    expect(nameInput()).toBeNull();
    expect(panelText()).toContain('From another tab');
    expect(panelText()).not.toContain('Mine');
  });

  it('keeps an unfinished rename and applies it to the reloaded folder', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    tree.startRename('Mine');
    const input = nameInput()!;
    input.value = 'Renamed';

    writeFromElsewhere({ [GLOBAL_KEY]: twoFolders('Mine', 'From another tab') });
    await vi.advanceTimersByTimeAsync(0);
    expect(tree.headerHolds('Mine', input)).toBe(true);
    expect(input.value).toBe('Renamed');

    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(folderNames()).toEqual(['Renamed', 'From another tab']);
    expect(nameInput()).toBeNull();
  });

  it('drops a rename whose folder another tab deleted', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    tree.startRename('Mine');

    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);

    expect(nameInput()).toBeNull();
    expect(panelText()).toContain('From another tab');
  });

  it('drops a new-subfolder draft whose parent another tab deleted', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    tree.startSubfolder('Mine');
    expect(nameInput()).not.toBeNull();

    writeFromElsewhere({ [GLOBAL_KEY]: folderData('From another tab') });
    await vi.advanceTimersByTimeAsync(0);

    expect(nameInput()).toBeNull();
  });

  it('keeps a new-subfolder draft while its parent stays, and creates it there', async () => {
    local[GLOBAL_KEY] = twoFolders('Mine', 'Other');
    await mount();
    tree.startSubfolder('Mine');
    const input = nameInput()!;
    input.value = 'Kid';

    writeFromElsewhere({ [GLOBAL_KEY]: twoFolders('Mine', 'Other') });
    await vi.advanceTimersByTimeAsync(0);
    expect(nameInput()).toBe(input);

    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    const kid = (local[GLOBAL_KEY] as FolderData).folders.find((folder) => folder.name === 'Kid');
    expect(kid?.parentId).toBe('Mine');
  });

  it('keeps one name form open: starting a new folder closes an open rename', async () => {
    local[GLOBAL_KEY] = folderData('Mine');
    await mount();
    tree.startRename('Mine');
    const rename = nameInput()!;
    tree.startRootFolder();

    expect(rename.isConnected).toBe(false);
    expect(nameInput()).not.toBeNull();
    expect(folderNames()).toEqual(['Mine']);
  });

  /** Parent P holds child S; `expanded` is P's state. */
  function nested(expanded: boolean, withChild = true): FolderData {
    const folders = [
      { id: 'P', name: 'Parent', parentId: null, isExpanded: expanded, createdAt: 1, updatedAt: 1 },
      { id: 'S', name: 'Child', parentId: 'P', isExpanded: true, createdAt: 2, updatedAt: 1 },
    ];
    return {
      folders: withChild ? folders : folders.slice(0, 1),
      folderContents: withChild ? { P: [], S: [] } : { P: [] },
    };
  }

  it('keeps a rename whose parent another tab collapsed and shows it again when expanded', async () => {
    local[GLOBAL_KEY] = nested(true);
    await mount();
    tree.startRename('S');
    const input = nameInput()!;
    input.value = 'Renamed';
    input.blur();

    writeFromElsewhere({ [GLOBAL_KEY]: nested(false) });
    await vi.advanceTimersByTimeAsync(0);
    expect(input.isConnected).toBe(true);
    expect(tree.isShown(input)).toBe(false);

    writeFromElsewhere({ [GLOBAL_KEY]: nested(true) });
    await vi.advanceTimersByTimeAsync(0);
    expect(tree.isShown(input)).toBe(true);
    expect(tree.headerHolds('S', input)).toBe(true);
    expect(input.value).toBe('Renamed');

    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(folderNames()).toEqual(['Parent', 'Renamed']);
  });

  it('keeps a new-subfolder draft across a local collapse of its ancestor', async () => {
    local[GLOBAL_KEY] = nested(true);
    await mount();
    tree.startSubfolder('P');
    const input = nameInput()!;
    input.value = 'Kid';

    tree.toggleExpanded('P');
    await vi.advanceTimersByTimeAsync(0);
    expect(tree.isShown(input)).toBe(false);
    tree.toggleExpanded('P');
    await vi.advanceTimersByTimeAsync(0);

    expect(tree.isShown(input)).toBe(true);
    expect(input.value).toBe('Kid');
  });

  it('drops a hidden rename once another tab deletes its folder', async () => {
    local[GLOBAL_KEY] = nested(true);
    await mount();
    tree.startRename('S');
    nameInput()!.blur();

    writeFromElsewhere({ [GLOBAL_KEY]: nested(false) });
    await vi.advanceTimersByTimeAsync(0);
    writeFromElsewhere({ [GLOBAL_KEY]: nested(false, false) });
    await vi.advanceTimersByTimeAsync(0);
    writeFromElsewhere({ [GLOBAL_KEY]: nested(true, false) });
    await vi.advanceTimersByTimeAsync(0);
    expect(nameInput()).toBeNull();

    // An import or restore elsewhere brings the same folder id back: the old draft stays gone.
    writeFromElsewhere({ [GLOBAL_KEY]: nested(true) });
    await vi.advanceTimersByTimeAsync(0);
    expect(nameInput()).toBeNull();
    expect(panelText()).toContain('Child');
  });

  it('does not carry a new-folder draft into another account', async () => {
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] = true;
    local[await scopedKey('a')] = folderData('Private a');
    const manager = await mount();
    tree.startRootFolder();
    expect(nameInput()).not.toBeNull();

    document.querySelector('.account-switcher-text')!.textContent = 'b@example.com';
    document.querySelector('.account-switcher-text')!.setAttribute('data-email', 'b@example.com');
    await vi.advanceTimersByTimeAsync(4000);

    expect(manager.activeStorageKey).toBe(await scopedKey('b'));
    expect(nameInput()).toBeNull();
  });
});

describe('AI Studio library archive visibility across contexts', () => {
  function libraryRow(id: string): HTMLElement {
    const row = document.createElement('tr');
    row.className = 'mat-mdc-row';
    row.innerHTML = `<td><a class="name-btn" href="/prompts/${id}">${id}</a></td>`;
    document.body.appendChild(row);
    return row;
  }

  function filed(id: string): FolderData {
    const data = folderData('Mine');
    data.folderContents.Mine = [
      { conversationId: id, title: id, url: `/prompts/${id}`, addedAt: 1 },
    ];
    return data;
  }

  it('archives and unarchives existing rows when another tab moves prompts', async () => {
    (
      globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }
    ).jsdom.reconfigure({ url: 'https://aistudio.google.com/library' });
    sync[StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO] = true;
    local[GLOBAL_KEY] = filed('p1');
    const first = libraryRow('p1');
    const second = libraryRow('p2');
    await mount();
    expect(first.classList.contains('gv-conversation-archived')).toBe(true);
    expect(second.classList.contains('gv-conversation-archived')).toBe(false);

    writeFromElsewhere({ [GLOBAL_KEY]: filed('p2') });
    await vi.advanceTimersByTimeAsync(0);

    expect(first.classList.contains('gv-conversation-archived')).toBe(false);
    expect(second.classList.contains('gv-conversation-archived')).toBe(true);
  });
});

describe('AI Studio account scope retry', () => {
  it('binds before the next poll and later polls keep the bound account', async () => {
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] = true;
    const key = await scopedKey('a');
    const privateA = folderData('Private a');
    privateA.folderContents['Private a'] = [
      {
        conversationId: 'p1',
        title: 'Prompt p1',
        url: 'https://aistudio.google.com/prompts/p1',
        addedAt: 1,
      },
    ];
    local[key] = privateA;
    const resolve = accountIsolationService.resolveAccountScope.bind(accountIsolationService);
    vi.spyOn(accountIsolationService, 'resolveAccountScope')
      .mockRejectedValueOnce(new Error('background not listening'))
      .mockImplementation(resolve);
    const manager = await mount();
    expect(manager.activeStorageKey).toBe('');

    await vi.advanceTimersByTimeAsync(400);
    expect(manager.activeStorageKey).toBe(key);
    expect(panelText()).toContain('Private a');

    tree.requestRemoval('Private a', 'p1');
    await vi.advanceTimersByTimeAsync(3600);

    expect(tree.pendingQuestion()).not.toBeNull();
    expect(manager.activeStorageKey).toBe(key);
  });
});
