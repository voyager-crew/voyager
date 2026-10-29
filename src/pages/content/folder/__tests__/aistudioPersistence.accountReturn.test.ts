/** AI Studio folder writes, imports and cloud drafts across an account switch and back (A → B → A). Setup lives in `aistudioPersistenceSuite.ts`. */
import { describe, expect, it, vi } from 'vitest';

import type { PromptItem } from '@/core/types/sync';
import { getTranslationSync } from '@/utils/i18n';

import type { FolderData } from '../types';
import { mockBrowser } from './aistudioPersistenceMockBrowser';
import {
  accountKey,
  backupData,
  chooseImport,
  folderData,
  holdFolderWrites,
  importNotices,
  installAIStudioPersistenceSuite,
  local,
  mountManager,
  notificationText,
  selectAccount,
  storageKey,
} from './aistudioPersistenceSuite';
import { treeText } from './aistudioTreeDriver';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./aistudioPersistenceMockBrowser')).mockBrowser,
}));

installAIStudioPersistenceSuite();

describe('AI Studio folder persistence across A → B → A', () => {
  it('finishes accepted ordinary writes but abandons an unissued import after A → B → A', async () => {
    const manager = await mountManager();
    const key = manager.activeStorageKey;
    const writes = holdFolderWrites(key);
    manager.data.folders[0].name = 'First ordinary edit';
    const first = manager.save();
    await writes.firstStarted.promise;
    manager.data.folders[0].name = 'Latest ordinary edit';
    const queued = manager.save();
    chooseImport(manager, folderData('Abandoned import'));
    await vi.advanceTimersByTimeAsync(0);
    selectAccount('b');
    await manager.refreshScopedDataOnAccountContextChange();
    expect(manager.data).toEqual(folderData('Private b'));
    selectAccount('a');
    await manager.refreshScopedDataOnAccountContextChange();
    writes.first.resolve();
    await writes.tailStarted.promise;
    writes.tail.resolve(true);
    await Promise.all([first, queued]);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      writes.snapshots.map((snapshot) => snapshot.folders.map((folder) => folder.name)),
    ).toEqual([['First ordinary edit'], ['Latest ordinary edit']]);
    expect(manager.data.folders.map((folder) => folder.name)).toEqual(['Latest ordinary edit']);
    expect(local[key]).toEqual(manager.data);
    expect(importNotices()).toEqual([]);
    expect(treeText()).not.toContain('Abandoned import');
    expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(false);
  });

  it('publishes an issued cloud draft in its original account when returning through A → B → A', async () => {
    const manager = await mountManager();
    const original = structuredClone(manager.data);
    const key = manager.activeStorageKey;
    const writes = holdFolderWrites(key);
    const prompt: PromptItem = {
      id: 'remote',
      text: 'Remote prompt',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    local.gvPromptItems = [];
    mockBrowser.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: { folders: { data: folderData('Cloud') }, prompts: { items: [prompt] } },
    });
    const syncing = manager.transfer.sync();
    await writes.firstStarted.promise;
    try {
      expect(manager.data).toEqual(original);
      selectAccount('b');
      await manager.refreshScopedDataOnAccountContextChange();
      expect(manager.data).toEqual(folderData('Private b'));
      expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(false);
      selectAccount('a');
      await manager.refreshScopedDataOnAccountContextChange();
      expect(manager.data).toEqual(original);
      expect(treeText()).not.toContain('Cloud');
      expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(true);
      writes.first.resolve();
      await syncing;
      expect(manager.data.folders.map((folder) => folder.name)).toEqual(['Private a', 'Cloud']);
      expect(local[key]).toEqual(manager.data);
      expect(local.gvPromptItems).toEqual([]);
      expect(treeText()).toContain('Cloud');
      expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(false);
      expect(notificationText()).not.toContain(getTranslationSync('downloadMergeSuccess'));
    } finally {
      writes.first.resolve();
      await syncing;
    }
  });

  it('does not announce an old account import after its issued write completes', async () => {
    const manager = await mountManager();
    const aKey = manager.activeStorageKey;
    const bKey = await accountKey('b');
    const writes = holdFolderWrites(aKey);
    chooseImport(manager, folderData('Imported into a'));
    await writes.firstStarted.promise;
    selectAccount('b');
    await manager.refreshScopedDataOnAccountContextChange();
    writes.first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(importNotices()).toEqual([]);
    expect(manager.data).toEqual(folderData('Private b'));
    expect(local[bKey]).toEqual(folderData('Private b'));
    expect(treeText()).toContain('Private b');
    expect((local[aKey] as FolderData).folders.map((folder) => folder.name)).toEqual([
      'Private a',
      'Imported into a',
    ]);
  });

  it('finishes a pending legacy migration before importing after A → B → A', async () => {
    const manager = await mountManager();
    const key = manager.activeStorageKey;
    const legacy = folderData('Legacy');
    delete local[key];
    local[storageKey] = legacy;
    const writes = holdFolderWrites(key);
    const migration = manager.load();
    await writes.firstStarted.promise;
    try {
      selectAccount('b');
      await manager.refreshScopedDataOnAccountContextChange();
      selectAccount('a');
      await manager.refreshScopedDataOnAccountContextChange();
      expect(treeText()).toContain('Legacy');

      chooseImport(manager, folderData('Imported after migration'));
      // An incorrectly concurrent import can finish before the slow migration.
      writes.tail.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect.soft(writes.snapshots).toHaveLength(1);
      expect.soft(importNotices()).toEqual([]);
      writes.first.resolve();
      await migration;
      await vi.advanceTimersByTimeAsync(0);

      expect((local[key] as FolderData).folders.map((folder) => folder.name)).toEqual([
        'Legacy',
        'Imported after migration',
      ]);
      expect(local[key]).toEqual(manager.data);
      expect(backupData(manager, 'primary')).toEqual(manager.data);
      expect(treeText()).toContain('Imported after migration');
      expect(local[storageKey]).toEqual(legacy);
    } finally {
      writes.first.resolve();
      writes.tail.resolve(true);
      await migration;
      await vi.advanceTimersByTimeAsync(0);
    }
  });
});
