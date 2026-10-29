/**
 * The legacy folder authority fence on a repository's writes: the reload notice,
 * refused saves, deletions and migrations, and the queued snapshots, backups and
 * unload copies a fenced tab must not write. Loads and account binding under the
 * fence live in `FolderRepositoryFenceReads.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { isVoyagerLayerEvent } from '@/core/ui/layer';
import { createToaster } from '@/core/ui/toast/toaster';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import {
  LegacyFolderFence,
  LegacyFolderWriteRefusedError,
} from '@/features/folder/owner/legacyFolderFence';
import { CHATGPT_FOLDER_CONFIG } from '@/pages/content/folder/pluginSiteFolderConfigs';
import { toastDriver } from '@/tests/toastDriver';

import {
  change,
  clone,
  deferred,
  fence,
  initial,
  installFolderRepositoryFence,
  onRecovery,
  onSaveFailed,
  pageBackups,
  ready,
  repository,
  settle,
  stored,
} from './__tests__/folderRepositoryFenceHarness';
import { AISTUDIO_FOLDER_CONFIG, GEMINI_FOLDER_CONFIG } from './platformFolderConfig';
import { AIStudioFolderStorageAdapter } from './storage/AIStudioFolderStorageAdapter';
import { LocalStorageFolderAdapter } from './storage/FolderStorageAdapter';
import type { FolderData } from './types';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return chrome.storage;
    },
    get runtime() {
      return chrome.runtime;
    },
  },
}));

installFolderRepositoryFence();

describe('legacy folder authority fence', () => {
  it('keeps one persistent reload toast beside other feedback until the user dismisses it', async () => {
    vi.useFakeTimers();
    const repo = await ready();
    const other = createToaster();
    try {
      other.show({ message: 'Other feedback', durationMs: null });
      change(fence('chatgpt'));
      change(fence('chatgpt'));
      await vi.advanceTimersByTimeAsync(60_000);
      const notice = toastDriver.find('Voyager was updated')!;
      expect(notice).toMatchObject({ tone: 'error', role: 'alert' });
      expect(toastDriver.all()).toHaveLength(2);
      const events: boolean[] = [];
      const pressed = (event: Event) => events.push(isVoyagerLayerEvent(event));
      document.addEventListener('pointerdown', pressed, { once: true });
      notice.element.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true }),
      );
      expect(events).toEqual([true]);
      toastDriver.press(notice, 'Close');
      expect(toastDriver.messages()).toEqual(['Other feedback']);
      change(fence('chatgpt'));
      expect(toastDriver.messages()).toEqual(['Other feedback']);
      expect(repo.canEdit).toBe(false);
    } finally {
      other.destroy();
    }
  });

  it.each(['close', 'destroy'] as const)(
    'removes only its reload toast when %s ends its lifetime',
    (method) => {
      const guard = new LegacyFolderFence(StorageKeys.FOLDER_DATA_CHATGPT, () => {}, false);
      const other = createToaster();
      try {
        other.show({ message: 'Other feedback', durationMs: null });
        guard.observe(fence('chatgpt'));
        expect(toastDriver.all()).toHaveLength(2);
        guard[method]();
        guard[method]();
        expect(toastDriver.messages()).toEqual(['Other feedback']);
      } finally {
        guard.destroy();
        other.destroy();
      }
    },
  );

  it.each([
    [CHATGPT_FOLDER_CONFIG, 'chatgpt'],
    [GEMINI_FOLDER_CONFIG, 'gemini'],
    [
      {
        ...AISTUDIO_FOLDER_CONFIG,
        storageKey: `${StorageKeys.FOLDER_DATA_AISTUDIO}:acct:abc`,
        platform: null,
      },
      'aistudio',
    ],
  ] as const)(
    'blocks init/migration for the owner of $1 while keeping memory',
    async (config, site) => {
      localStorage.setItem(config.storageKey, JSON.stringify(initial));
      stored[AUTHORITY_FENCE_KEY] = fence(site);
      const repo = repository(config, new LocalStorageFolderAdapter());
      repo.data = clone(initial);
      await repo.init();
      expect(repo.canEdit).toBe(false);
      expect(repo.data).toEqual(initial);
      expect(stored[config.storageKey]).toBeUndefined();
      expect(localStorage.getItem(`gvBackup_${config.backupNamespace}_primary`)).toBeNull();
      expect(toastDriver.all().find(({ role }) => role === 'alert')?.message).toBe(
        'Voyager was updated. Reload this tab to keep editing folders.',
      );
      expect(await repo.saveData()).toBe(false);
      expect(await repo.replaceData({ ...initial, folders: [] })).toBe(false);
    },
  );

  it.each(['legacy', 'owner'])(
    'gates folder saves and deletion for %s authority',
    async (authority) => {
      const key = StorageKeys.FOLDER_DATA_CHATGPT;
      stored[key] = clone(initial);
      stored[AUTHORITY_FENCE_KEY] = fence('chatgpt', authority);
      const guard = new LegacyFolderFence(key, () => {});
      const adapter = new AIStudioFolderStorageAdapter();
      adapter.setWriteGate((_key, operation) => guard.write(operation));
      const edited = { ...initial, folders: [{ ...initial.folders[0], name: 'Edited' }] };
      const save = adapter.saveData(key, edited);
      if (authority === 'owner')
        await expect(save).rejects.toBeInstanceOf(LegacyFolderWriteRefusedError);
      else await save;
      expect(stored[key]).toEqual(authority === 'owner' ? initial : edited);
      const remove = adapter.removeData(key);
      if (authority === 'owner')
        await expect(remove).rejects.toBeInstanceOf(LegacyFolderWriteRefusedError);
      else await remove;
      expect(stored[key]).toEqual(authority === 'owner' ? initial : undefined);
      guard.destroy();
    },
  );

  it('checks fresh authority before a save even without a storage event', async () => {
    const repo = await ready();
    repo.data.folders[0].name = 'Unsaved';
    const backups = pageBackups();
    stored[AUTHORITY_FENCE_KEY] = fence('chatgpt');
    expect(await repo.saveData()).toBe(false);
    await settle();
    window.dispatchEvent(new Event('beforeunload'));
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
    expect(repo.data.folders[0]?.name).toBe('Unsaved');
    expect(repo.canEdit).toBe(false);
    expect(pageBackups()).toEqual(backups);
    expect(toastDriver.all().some(({ role }) => role === 'alert')).toBe(true);
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('observes only local authority and keeps a fenced tab closed after rollback', async () => {
    const repo = await ready();
    change(fence('chatgpt'), 'sync');
    expect(repo.canEdit).toBe(true);
    repo.data.folders[0].name = 'Memory';
    change(fence('chatgpt'));
    expect(repo.canEdit).toBe(false);
    change(fence('chatgpt', 'legacy'));
    await repo.loadData();
    expect(await repo.saveData()).toBe(false);
    expect(repo.data.folders[0]?.name).toBe('Memory');
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
    expect(toastDriver.all().filter(({ role }) => role === 'alert')).toHaveLength(1);
  });

  it('blocks a failed fence read without writing data or backups', async () => {
    const repo = await ready();
    repo.data.folders[0].name = 'Unsaved';
    const backups = pageBackups();
    vi.mocked(browser.storage.local.get).mockRejectedValue(new Error('read unavailable'));
    expect(await repo.saveData()).toBe(false);
    await settle();
    window.dispatchEvent(new Event('beforeunload'));
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
    expect(repo.data.folders[0]?.name).toBe('Unsaved');
    expect(repo.canEdit).toBe(false);
    expect(pageBackups()).toEqual(backups);
    expect(onRecovery).toHaveBeenCalledWith('unreadable');
    expect(onSaveFailed).not.toHaveBeenCalled();
    expect(toastDriver.all().some(({ role }) => role === 'alert')).toBe(false);
  });

  it('fences the empty-save diagnostic before its adapter can mirror storage', async () => {
    const repo = await ready(new LocalStorageFolderAdapter());
    const pageData = localStorage.getItem(StorageKeys.FOLDER_DATA_CHATGPT);
    repo.data = { folders: [], folderContents: {} };
    stored[StorageKeys.FOLDER_DATA_CHATGPT] = {
      ...initial,
      folders: [{ ...initial.folders[0], name: 'Owner data' }],
    };
    stored[AUTHORITY_FENCE_KEY] = fence('chatgpt');
    expect(await repo.saveData()).toBe(false);
    expect(localStorage.getItem(StorageKeys.FOLDER_DATA_CHATGPT)).toBe(pageData);
    expect((stored[StorageKeys.FOLDER_DATA_CHATGPT] as FolderData).folders[0].name).toBe(
      'Owner data',
    );
    expect(repo.data).toEqual({ folders: [], folderContents: {} });
  });

  it('checks again before retrying an adapter failure', async () => {
    const repo = await ready(new LocalStorageFolderAdapter());
    repo.data.folders[0].name = 'Unsaved';
    vi.mocked(browser.storage.local.set).mockImplementation(async () => {
      stored[AUTHORITY_FENCE_KEY] = fence('chatgpt');
      throw new Error('first write failed');
    });
    expect(await repo.saveData()).toBe(false);
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
    expect(repo.data.folders[0]?.name).toBe('Unsaved');
    expect(toastDriver.all().some(({ role }) => role === 'alert')).toBe(true);
  });

  it('cancels queued snapshots and the debounce while retaining the newest edit', async () => {
    vi.useFakeTimers();
    const repo = await ready();
    const gate = deferred<void>();
    const started = deferred<void>();
    vi.mocked(browser.storage.local.set).mockImplementation(async () => {
      started.resolve();
      await gate.promise;
      throw new Error('issued write failed');
    });
    const first = repo.saveData();
    await started.promise;
    repo.data.folders[0].name = 'Latest';
    const queued = repo.saveData();
    repo.scheduleSaveData();
    change(fence('chatgpt'));
    expect(await queued).toBe(false);
    gate.resolve();
    expect(await first).toBe(false);
    await vi.advanceTimersByTimeAsync(31000);
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
    expect(repo.data.folders[0]?.name).toBe('Latest');
    expect(repo.canEdit).toBe(false);
  });

  it('stops queued Safari backup copies, late metadata and unload after fencing', async () => {
    vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Version/17.0 Safari/605.1.15');
    const gate = deferred<{ status: string }>();
    vi.mocked(browser.runtime.sendMessage).mockReturnValue(gate.promise);
    const repo = await ready();
    const emergency = repo.session!.backup.createEmergencyBackup(initial);
    await settle();
    const backups = pageBackups();
    const sent = vi.mocked(browser.runtime.sendMessage).mock.calls.length;
    change(fence('chatgpt'));
    gate.resolve({ status: 'saved' });
    await emergency;
    await settle();
    repo.session!.markReady();
    window.dispatchEvent(new Event('beforeunload'));
    expect(await repo.session!.backup.createPrimaryBackup(initial)).toBe(false);
    expect(vi.mocked(browser.runtime.sendMessage).mock.calls.length).toBe(sent);
    expect(pageBackups()).toEqual(backups);
    expect(stored[StorageKeys.FOLDER_DATA_CHATGPT]).toEqual(initial);
  });

  it.each([
    undefined,
    { build: 'legacy', sites: { chatgpt: 'legacy', gemini: 'legacy', aistudio: 'legacy' } },
  ])('keeps legacy edits, backups and unload unchanged for fence %j', async (authority) => {
    stored[AUTHORITY_FENCE_KEY] = authority;
    const repo = await ready();
    repo.data.folders[0].name = 'Saved';
    expect(await repo.saveData()).toBe(true);
    await settle();
    expect(repo.canEdit).toBe(true);
    expect((stored[StorageKeys.FOLDER_DATA_CHATGPT] as FolderData).folders[0].name).toBe('Saved');
    expect(
      JSON.parse(localStorage.getItem('gvBackup_chatgpt-folders_emergency')!).data.folders[0].name,
    ).toBe('Saved');
    window.dispatchEvent(new Event('beforeunload'));
    await settle();
    expect(
      JSON.parse(localStorage.getItem('gvBackup_chatgpt-folders_beforeUnload')!).data.folders[0]
        .name,
    ).toBe('Saved');
    expect(toastDriver.all().some(({ role }) => role === 'alert')).toBe(false);
    expect(onRecovery).not.toHaveBeenCalled();
  });
});
