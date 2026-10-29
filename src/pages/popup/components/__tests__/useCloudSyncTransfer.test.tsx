import { describe, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { getTimelineHierarchyStorageKey } from '@/pages/content/timeline/hierarchyStorage';

import {
  emptyFolders,
  folders,
  pageContext,
  pageScope,
  setupTransferHarness,
  tabScope,
} from './cloudSyncTransferHarness';

describe('popup cloud sync transfer operations', () => {
  const h = setupTransferHarness();
  const { tabMessage, localGet, localSet } = h;

  it('keeps hierarchy and highlights scoped when folder isolation is off', async () => {
    vi.mocked(accountIsolationService.isIsolationEnabled).mockResolvedValue(false);
    localGet.mockResolvedValue({ [StorageKeys.FOLDER_DATA]: folders });
    await h.render();
    const payload = await h.transfer.prepareUpload();
    expect(payload).toEqual({
      platform: 'gemini',
      accountScope: null,
      timelineHierarchyAccountScope: pageScope,
      highlightAccountScope: pageScope,
      includeHighlights: true,
      folders,
      prompts: [],
    });
  });

  it.each([
    ['gemini', 'upload', { routeUserId: '1', email: null }],
    ['gemini', 'download', { routeUserId: '1', email: null }],
    ['aistudio', 'upload', { routeUserId: null, email: null }],
    ['aistudio', 'download', { routeUserId: null, email: null }],
    ['gemini', 'download', undefined],
  ] as const)(
    'with isolation on, %s refuses to %s for a page that has not named its account (%o)',
    async (platform, operation, context) => {
      tabMessage.mockImplementation(async (_tabId, message) => {
        if (message.type !== 'gv.account.getContext') return { ok: false };
        if (!context) throw new Error('no content script');
        return { ok: true, context };
      });
      await h.render(platform, false);
      const prepare =
        operation === 'upload' ? h.transfer.prepareUpload : h.transfer.prepareDownload;
      await expect(prepare()).rejects.toThrow();
      // No `route:<n>`, shared `default` or unscoped bucket stands in for the unknown account.
      expect(accountIsolationService.resolveAccountScope).not.toHaveBeenCalled();
      expect(localGet).not.toHaveBeenCalled();
      expect(localSet).not.toHaveBeenCalled();
    },
  );

  it('never uploads or overwrites the shared default bucket for an AI Studio page that refuses its folders', async () => {
    const shared = buildScopedStorageKey(StorageKeys.FOLDER_DATA_AISTUDIO, 'default');
    h.stored[shared] = folders;
    // The switcher is unreadable, so the page's gate answers the folder request with a refusal.
    tabMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'gv.account.getContext'
        ? { ok: true, context: { routeUserId: null, email: null } }
        : { ok: false },
    );
    await h.render('aistudio', false);
    await expect(h.transfer.prepareUpload()).rejects.toThrow();
    await expect(h.transfer.prepareDownload()).rejects.toThrow();
    expect(localGet).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(h.stored[shared]).toEqual(folders);
  });

  it('with isolation off, syncs the unscoped folders of a page that has not named its account', async () => {
    vi.mocked(accountIsolationService.isIsolationEnabled).mockResolvedValue(false);
    tabMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'gv.account.getContext'
        ? { ok: true, context: { ...pageContext, email: null } }
        : { ok: false },
    );
    localGet.mockResolvedValue({ [StorageKeys.FOLDER_DATA]: folders });
    await h.render();
    const payload = await h.transfer.prepareUpload();
    expect(payload.accountScope).toBeNull();
    expect(payload.folders).toEqual(folders);
    expect((await h.transfer.prepareDownload()).payload.accountScope).toBeNull();
  });

  it('uses fresh nonempty tab folders and only overrides the folder scope', async () => {
    tabMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'gv.account.getContext'
        ? { ok: true, context: pageContext }
        : { ok: true, data: folders, accountScope: tabScope },
    );
    localGet.mockResolvedValue({
      [buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'tab')]: emptyFolders,
    });
    await h.render();
    const payload = await h.transfer.prepareUpload();
    expect(payload.folders).toEqual(folders);
    expect(payload.accountScope).toEqual(tabScope);
    expect(payload.timelineHierarchyAccountScope).toEqual(pageScope);
    expect(payload.highlightAccountScope).toEqual(pageScope);
    expect(localSet).not.toHaveBeenCalled();
  });

  it('restores into the captured folder and hierarchy scopes while the tab stays on that account', async () => {
    await h.render('gemini', false);
    const download = await h.transfer.prepareDownload();
    // Changes after preparation must not redirect the hierarchy restore.
    vi.mocked(accountIsolationService.resolveAccountScope).mockResolvedValue({
      ...tabScope,
      emailHash: null,
    });
    tabMessage.mockResolvedValue({ ok: true, data: emptyFolders, accountScope: pageScope });
    await download.restore(
      {
        folders: { data: folders },
        timelineHierarchy: { data: { conversations: {} } },
        prompts: { items: [] },
      },
      'overwrite',
      false,
    );
    expect(h.stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'page')]).toEqual(folders);
    expect(h.stored[getTimelineHierarchyStorageKey('page')]).toEqual({ conversations: {} });
    expect(h.stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'tab')]).toBeUndefined();
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(tabMessage).toHaveBeenLastCalledWith(7, { type: 'gv.folders.reload' });
  });

  it.each([
    ['merge', 'another account', tabScope],
    ['overwrite', 'another account', tabScope],
    ['merge', 'no account', undefined],
    ['overwrite', 'no account', undefined],
  ] as const)(
    'a %s download for one account never lands in the tab once it reports %s',
    async (mode, _label, liveScope) => {
      const otherAccount: FolderData = {
        folders: [
          { id: 'b', name: 'B only', parentId: null, isExpanded: true, createdAt: 2, updatedAt: 2 },
        ],
        folderContents: {},
      };
      h.stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'tab')] = otherAccount;
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      expect(download.payload.accountScope).toEqual(pageScope);
      // The tab switched accounts while Drive was downloading the captured account's files.
      tabMessage.mockResolvedValue({ ok: true, data: otherAccount, accountScope: liveScope });
      await expect(
        download.restore({ folders: { data: folders }, prompts: { items: [] } }, mode, false),
      ).rejects.toMatchObject({ restored: [], failed: expect.arrayContaining(['folders']) });
      expect(localSet).not.toHaveBeenCalled();
      expect(h.stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'tab')]).toEqual(otherAccount);
      expect(tabMessage).not.toHaveBeenCalledWith(7, { type: 'gv.folders.reload' });
    },
  );

  it('falls back to scoped legacy folders after the upload tab timeout', async () => {
    await h.render('gemini', false);
    vi.useFakeTimers();
    tabMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'gv.account.getContext'
        ? { ok: true, context: pageContext }
        : new Promise(() => {}),
    );
    localGet.mockResolvedValue({
      [buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'page')]: JSON.stringify(folders),
      [StorageKeys.PROMPT_ITEMS]: [{ id: 'p', text: 'Prompt', tags: [], createdAt: 1 }],
    });
    const upload = h.transfer.prepareUpload();
    await vi.advanceTimersByTimeAsync(499);
    expect(localGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await upload).folders).toEqual(folders);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['gemini', 'aistudio'] as const)(
    'keeps a prompt another tab saves during a restore on %s',
    async (platform) => {
      const localPrompt = { id: 'local', text: 'Local', tags: [], createdAt: 1 };
      const otherTab = { id: 'other', text: 'Other tab', tags: [], createdAt: 3 };
      const cloudPrompt = { id: 'cloud', text: 'Cloud', tags: [], createdAt: 2 };
      h.stored[StorageKeys.PROMPT_ITEMS] = [localPrompt];
      let saved = false;
      localSet.mockImplementation(async (items) => {
        // Prompt Manager saves through the owner while the popup writes folders.
        if (!saved && !(StorageKeys.PROMPT_ITEMS in items)) {
          saved = true;
          await h.promptOwner.apply({ kind: 'add', items: [otherTab] });
        }
        Object.assign(h.stored, structuredClone(items));
      });
      await h.render(platform, false);
      const download = await h.transfer.prepareDownload();
      await download.restore(
        { folders: { data: folders }, prompts: { items: [cloudPrompt] } },
        'merge',
        false,
      );
      expect(saved).toBe(true);
      expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([otherTab, localPrompt, cloudPrompt]);
    },
  );

  it.each([
    ['gemini', 'fails'],
    ['gemini', 'is invalid'],
    ['aistudio', 'fails'],
    ['aistudio', 'is invalid'],
  ] as const)(
    'does not replace prompts on %s with the backup when the local prompt read %s',
    async (platform, failure) => {
      const localPrompts = failure === 'is invalid' ? [{ id: 'broken' }] : [];
      h.stored[StorageKeys.PROMPT_ITEMS] = localPrompts;
      if (failure === 'fails') {
        const readLocal = localGet.getMockImplementation()!;
        localGet.mockImplementation(async (keys) => {
          if (keys === StorageKeys.PROMPT_ITEMS) throw new Error('read failed');
          return readLocal(keys);
        });
      }
      await h.render(platform, false);
      const download = await h.transfer.prepareDownload();
      const restore = download.restore(
        {
          folders: { data: folders },
          prompts: { items: [{ id: 'cloud', text: 'Cloud', tags: [], createdAt: 2 }] },
        },
        'merge',
        false,
      );
      await expect(restore).rejects.toMatchObject({
        restored: ['folders'],
        failed: ['prompts'],
      });
      expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual(localPrompts);
    },
  );

  it.each(['gemini', 'aistudio'] as const)(
    'overwrite repairs a corrupt prompt library on %s',
    async (platform) => {
      for (const items of [[{ id: 'cloud', text: 'Cloud', tags: [], createdAt: 2 }], []]) {
        h.stored[StorageKeys.PROMPT_ITEMS] = { broken: true };
        await h.render(platform, false);
        const download = await h.transfer.prepareDownload();
        await download.restore(
          { folders: { data: folders }, prompts: { items } },
          'overwrite',
          false,
        );
        expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual(items);
      }
    },
  );

  it('restores the prompts an AI Studio upload saved, without Gemini-only data', async () => {
    vi.mocked(accountIsolationService.isIsolationEnabled).mockResolvedValue(false);
    const localPrompt = { id: 'local', text: 'Local', tags: [], createdAt: 1 };
    const cloudPrompt = { id: 'cloud', text: 'Cloud', tags: [], createdAt: 2 };
    h.stored[StorageKeys.PROMPT_ITEMS] = [localPrompt];
    await h.render('aistudio');
    const download = await h.transfer.prepareDownload();
    await download.restore(
      { folders: { data: folders }, prompts: { items: [cloudPrompt] } },
      'merge',
      false,
    );
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([localPrompt, cloudPrompt]);
    expect(Object.keys(h.stored).sort()).toEqual(
      [
        StorageKeys.FOLDER_DATA_AISTUDIO,
        StorageKeys.PROMPT_ITEMS,
        StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT,
      ].sort(),
    );
    expect(download.payload).toEqual({
      platform: 'aistudio',
      accountScope: null,
      timelineHierarchyAccountScope: null,
      highlightAccountScope: null,
      includeHighlights: false,
    });
  });
});
