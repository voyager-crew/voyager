/**
 * Behavior AI Studio gained by moving onto FolderRepository: it reloads when
 * another context writes its active bucket and ignores its own write echoes.
 * Inline drafts, archived /library rows and the account-scope retry are in
 * aistudioFolderSync.drafts.
 */
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import {
  handlePromptLibraryApplyMessage,
  isPromptLibraryApplyMessage,
} from '@/features/prompt/library/promptLibraryMessages';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';
import { useCloudSyncTransfer } from '@/pages/popup/components/useCloudSyncTransfer';
import { toastDriver } from '@/tests/toastDriver';

import type { FolderData } from '../types';
import {
  GLOBAL_KEY,
  emitStorageChange,
  folderData,
  local,
  mockBrowser,
  mount,
  panelText,
  scopedKey,
  sortedClone,
  sync,
  installAIStudioFolderPage,
  writeFromElsewhere,
} from './aistudioFolderHarness';
import { nameInput, tree } from './aistudioTreeDriver';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

function bucketReads(key: string): number {
  return mockBrowser.storage.local.get.mock.calls.filter(([keys]) => keys === key).length;
}

installAIStudioFolderPage({ syncStorage: true });

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
    expect(local.gvPromptItems).toEqual([]);
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
    // The generic failure: the provider's raw text goes to the log only.
    expect(toastDriver.messages()[0]).not.toContain('offline');
  });

  it("shows AI Studio's own last upload and sync times in the cloud tooltip, not Gemini's", async () => {
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
    const cloud = document.querySelector<HTMLButtonElement>('.gv-aistudio .gv-folder-cloud-btn')!;

    cloud.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(0);

    expect(cloud.title).toBe('Cloud sync\nUploaded: 5 minutes ago\nNever synced');
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
      // No other background owner answers here (the catalog outline pull goes unhandled).
      vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((message: unknown) =>
        isPromptLibraryApplyMessage(message)
          ? handlePromptLibraryApplyMessage(message, prompts)
          : Promise.resolve(undefined)) as typeof chrome.runtime.sendMessage);
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
        expect(responses.length).toBeGreaterThan(0);
        for (const response of responses) expect(response).toEqual({ ok: false });
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
