/** AI Studio folder persistence: loads, writes, imports and cloud drafts. Setup lives in `aistudioPersistenceSuite.ts`. */
import { describe, expect, it, vi } from 'vitest';

import type { PromptItem } from '@/core/types/sync';
import { toastDriver } from '@/tests/toastDriver';
import { getTranslationSync } from '@/utils/i18n';

import type { FolderData } from '../types';
import { AIStudioFolderManager } from './aistudioFolderManager';
import { mockBrowser } from './aistudioPersistenceMockBrowser';
import {
  type Manager,
  accountKey,
  attemptCreateAndDrop,
  backupData,
  chooseImport,
  createFolder,
  deferred,
  folderData,
  hasErrorNotice,
  holdFolderWrites,
  importNotices,
  installAIStudioPersistenceSuite,
  pick,
  managers,
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

describe('AI Studio folder persistence', () => {
  it.each(['global', 'scoped'] as const)(
    'rejects editing while the new %s data is loading',
    async (kind) => {
      const manager = await mountManager();
      const key = kind === 'global' ? storageKey : await accountKey('b');
      const original = structuredClone(local[key]);
      const loaded = deferred<Record<string, unknown>>();
      const started = deferred<void>();
      mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => {
        if (keys === key) {
          started.resolve();
          return loaded.promise;
        }
        return pick(local, keys);
      });
      selectAccount('b');
      const switching =
        kind === 'global'
          ? manager.handleAccountIsolationToggle(false)
          : manager.refreshScopedDataOnAccountContextChange();
      await started.promise;
      try {
        expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(
          true,
        );
        expect(document.querySelector('.gv-folder-container')?.getAttribute('aria-busy')).toBe(
          'true',
        );
        attemptCreateAndDrop();
        // A form or menu opened just before the switch can still call back.
        const actions = manager.treeActions();
        actions.onCreateFolder?.('Created by a stale form', null);
        await vi.advanceTimersByTimeAsync(0);
        expect(local[key]).toEqual(original);
        expect(manager.data).toEqual({ folders: [], folderContents: {} });
      } finally {
        loaded.resolve({ [key]: original });
        await switching;
      }
      expect(manager.data).toEqual(original);
      expect(document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.disabled).toBe(false);
      expect(treeText()).toContain(kind === 'global' ? 'Global original' : 'Private b');
    },
  );

  it.each([true, false])(
    'settles coalesced saves only with their trailing result: %s',
    async (saved) => {
      const manager = await mountManager();
      const writes = holdFolderWrites(manager.activeStorageKey);
      manager.data.folders[0].name = 'First';
      const first = manager.save();
      await writes.firstStarted.promise;
      manager.data.folders[0].name = 'Superseded';
      const queued = manager.save();
      manager.data.folders[0].name = 'Latest';
      const latest = manager.save();
      const outcomes: boolean[] = [];
      void queued.then((result) => outcomes.push(result));
      void latest.then((result) => outcomes.push(result));
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(outcomes).toEqual([]);
        writes.first.resolve();
        await writes.tailStarted.promise;
        expect(outcomes).toEqual([]);
        writes.tail.resolve(saved);
        expect(await first).toBe(true);
        expect(await queued).toBe(saved);
        expect(await latest).toBe(saved);
        expect(writes.snapshots.map((snapshot) => snapshot.folders[0].name)).toEqual([
          'First',
          'Latest',
        ]);
        expect((local[manager.activeStorageKey] as FolderData).folders[0].name).toBe(
          saved ? 'Latest' : 'First',
        );
      } finally {
        writes.first.resolve();
        writes.tail.resolve(saved);
        await Promise.all([first, queued, latest]);
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  it('does not create a default library folder while global storage is loading', async () => {
    window.history.replaceState({}, '', '/library');
    const manager = await mountManager();
    const original = structuredClone(local[storageKey]);
    const loaded = deferred<Record<string, unknown>>();
    const started = deferred<void>();
    mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => {
      if (keys === storageKey) {
        started.resolve();
        return loaded.promise;
      }
      return pick(local, keys);
    });
    const switching = manager.handleAccountIsolationToggle(false);
    await started.promise;
    try {
      // A provider row can appear before Voyager's observer attaches its row handlers.
      const table = document.createElement('table');
      table.innerHTML =
        '<tr class="mat-mdc-row"><td><a href="/prompts/new-row">New row</a></td></tr>';
      document.body.appendChild(table);
      table.querySelector('tr')!.dispatchEvent(new Event('dragstart', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.data).toEqual({ folders: [], folderContents: {} });
      expect(local[storageKey]).toEqual(original);
      expect(document.querySelector('.gv-library-folder-item')).toBeNull();
    } finally {
      loaded.resolve({ [storageKey]: original });
      await switching;
    }
    expect(manager.data).toEqual(original);
  });

  it('does not report a superseded write failure when its trailing snapshot succeeds', async () => {
    const manager = await mountManager();
    const firstResult = deferred<void>();
    const tailResult = deferred<void>();
    let writes = 0;
    mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      const snapshot = structuredClone(values);
      if (snapshot[manager.activeStorageKey]) {
        if (++writes === 1) {
          await firstResult.promise;
          throw new Error('Temporary storage failure');
        }
        await tailResult.promise;
      }
      Object.assign(local, snapshot);
    });

    const first = manager.save();
    manager.data.folders[0].name = 'Latest ordinary edit';
    const queued = manager.save();
    try {
      firstResult.resolve();
      expect(await first).toBe(false);
      expect(hasErrorNotice()).toBe(false);
      tailResult.resolve();
      expect(await queued).toBe(true);
      expect((local[manager.activeStorageKey] as FolderData).folders[0].name).toBe(
        'Latest ordinary edit',
      );
      expect(hasErrorNotice()).toBe(false);
    } finally {
      firstResult.resolve();
      tailResult.resolve();
      await Promise.all([first, queued]);
    }
  });

  it.each([true, false])(
    'continues cloud sync only after its queued folder save succeeds: %s',
    async (saved) => {
      const manager = await mountManager();
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
      const writes = holdFolderWrites(manager.activeStorageKey);
      const first = manager.save();
      await writes.firstStarted.promise;
      const syncing = manager.transfer.sync();
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(local.gvPromptItems).toEqual([]);
        expect(notificationText()).not.toContain(getTranslationSync('downloadMergeSuccess'));
        writes.first.resolve();
        await writes.tailStarted.promise;
        expect(manager.data).toEqual(folderData('Private a'));
        expect(treeText()).not.toContain('Cloud');
        expect(local.gvPromptItems).toEqual([]);
        writes.tail.resolve(saved);
        await syncing;
        expect(local.gvPromptItems).toEqual([]);
        if (saved) {
          expect(notificationText()).toContain(getTranslationSync('downloadMergeSuccess'));
          expect(
            (local[manager.activeStorageKey] as FolderData).folders.map((folder) => folder.name),
          ).toEqual(['Private a', 'Cloud']);
        } else {
          expect(notificationText()).not.toContain(getTranslationSync('downloadMergeSuccess'));
          expect(hasErrorNotice()).toBe(true);
          expect(
            (local[manager.activeStorageKey] as FolderData).folders.map((folder) => folder.name),
          ).toEqual(['Private a']);
          expect(manager.data).toEqual(folderData('Private a'));
        }
      } finally {
        writes.first.resolve();
        writes.tail.resolve(saved);
        await Promise.all([first, syncing]);
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  it.each(['import', 'cloud'] as const)(
    'keeps a failed %s draft out of live data, recovery and the next ordinary save',
    async (kind) => {
      const manager = await mountManager();
      const original = structuredClone(manager.data);
      await manager.save();
      local.gvPromptItems = [];
      mockBrowser.storage.local.set.mockRejectedValue(new Error('Storage quota exceeded'));
      mockBrowser.runtime.sendMessage.mockResolvedValue({
        ok: true,
        data: { folders: { data: folderData('Failed draft') }, prompts: { items: [] } },
      });
      if (kind === 'import') chooseImport(manager, folderData('Failed draft'));
      else await manager.transfer.sync();
      await vi.waitFor(() => expect(hasErrorNotice()).toBe(true));
      await vi.advanceTimersByTimeAsync(0);

      expect(importNotices()).toEqual([]);
      expect(notificationText()).not.toContain(getTranslationSync('downloadMergeSuccess'));
      expect(local[manager.activeStorageKey]).toEqual(original);
      expect.soft(manager.data).toEqual(original);
      window.dispatchEvent(new Event('beforeunload'));
      await vi.waitFor(() => expect(backupData(manager, 'beforeUnload')).toEqual(original));
      for (const slot of ['primary', 'emergency', 'beforeUnload'] as const) {
        expect.soft(backupData(manager, slot)).toEqual(original);
      }

      mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
        Object.assign(local, structuredClone(values));
      });
      createFolder('After failed draft');
      await vi.waitFor(() => {
        expect(
          (local[manager.activeStorageKey] as FolderData).folders.some(
            (folder) => folder.name === 'After failed draft',
          ),
        ).toBe(true);
      });
      expect
        .soft((local[manager.activeStorageKey] as FolderData).folders.map((folder) => folder.name))
        .toEqual(['Private a', 'After failed draft']);
      window.dispatchEvent(new Event('beforeunload'));
      await vi.waitFor(() =>
        expect(backupData(manager, 'beforeUnload').folders.map((folder) => folder.name)).toEqual([
          'Private a',
          'After failed draft',
        ]),
      );
      expect
        .soft(manager.data.folders.map((folder) => folder.name))
        .toEqual(['Private a', 'After failed draft']);
      for (const slot of ['primary', 'emergency', 'beforeUnload'] as const) {
        expect
          .soft(backupData(manager, slot).folders.map((folder) => folder.name))
          .toEqual(['Private a', 'After failed draft']);
      }
    },
  );

  it('syncs site folders even when shared prompt writes would fail', async () => {
    const manager = await mountManager();
    local.gvPromptItems = [];
    mockBrowser.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: { folders: { data: folderData('Cloud') }, prompts: { items: [] } },
    });
    mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      if ('gvPromptItems' in values) throw new Error('Storage quota exceeded');
      Object.assign(local, structuredClone(values));
    });

    await manager.transfer.sync();

    expect(notificationText()).toContain(getTranslationSync('downloadMergeSuccess'));
    expect(hasErrorNotice()).toBe(false);
    expect(manager.data.folders.map((folder) => folder.name)).toEqual(['Private a', 'Cloud']);
    expect(local[manager.activeStorageKey]).toEqual(manager.data);
    expect(local.gvPromptItems).toEqual([]);
  });

  it('loads stored folders named after inherited object keys', async () => {
    local[await accountKey('a')] = JSON.parse(
      '{"folders":[' +
        '{"id":"__proto__","name":"Proto","parentId":null,"isExpanded":true,"createdAt":1,"updatedAt":1},' +
        '{"id":"constructor","name":"Ctor","parentId":null,"isExpanded":true,"createdAt":1,"updatedAt":1}],' +
        '"folderContents":{}}',
    );
    const instance = new AIStudioFolderManager();
    managers.push(instance as unknown as Manager);

    await instance.init();

    const list = treeText();
    expect(list).toContain('Proto');
    expect(list).toContain('Ctor');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('refuses a folder whose id every object inherits', async () => {
    const manager = await mountManager();
    const key = manager.activeStorageKey;

    chooseImport(manager, {
      folders: [{ ...folderData('P').folders[0], id: '__proto__' }],
      folderContents: {},
    });
    await vi.waitFor(() =>
      expect(toastDriver.messages()).toContain(getTranslationSync('folder_import_invalid_format')),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('Private a'));
    expect(local[key]).toEqual(folderData('Private a'));
  });

  it('refuses a file that repeats a folder id', async () => {
    const manager = await mountManager();
    const key = manager.activeStorageKey;
    const [first] = folderData('P').folders;

    chooseImport(manager, {
      folders: [first, { ...first, parentId: first.id }],
      folderContents: {},
    });
    await vi.waitFor(() =>
      expect(toastDriver.messages()).toContain(getTranslationSync('folder_import_invalid_format')),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('Private a'));
    expect(local[key]).toEqual(folderData('Private a'));
  });

  it.each([
    ['its own parent', [['a', 'a']], 'a'],
    [
      'a pair of folders',
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
      'a',
    ],
  ] as const)(
    'imports a file where a folder is inside itself through %s, with that folder at the root',
    async (_kind, links, cutId) => {
      const manager = await mountManager();
      const key = manager.activeStorageKey;
      const [template] = folderData('P').folders;
      const file: FolderData = {
        folders: links.map(([id, parentId]) => ({ ...template, id, name: id, parentId })),
        folderContents: Object.fromEntries(
          links.map(([id]) => [
            id,
            [{ conversationId: `p_${id}`, title: id, url: `https://x.test/${id}`, addedAt: 1 }],
          ]),
        ),
      };

      chooseImport(manager, file, { format: 'gemini-voyager.folders.v1' });
      await vi.waitFor(() =>
        expect((local[key] as FolderData).folders).toHaveLength(1 + links.length),
      );

      const saved = local[key] as FolderData;
      expect(saved.folders.slice(1)).toEqual(
        file.folders.map((folder) =>
          folder.id === cutId ? { ...folder, parentId: null } : folder,
        ),
      );
      for (const [id] of links) expect(saved.folderContents[id]).toEqual(file.folderContents[id]);
      expect(manager.data).toEqual(saved);
      expect(toastDriver.messages()).not.toContain(
        getTranslationSync('folder_import_invalid_format'),
      );
    },
  );

  it('refuses a folder file ChatGPT exported', async () => {
    const manager = await mountManager();
    const key = manager.activeStorageKey;
    const chatgpt: FolderData = {
      folders: [
        { id: 'f', name: 'Trips', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
      ],
      folderContents: {
        f: [
          {
            conversationId: 'chatgpt:conv:abc',
            title: 'Trip plan',
            url: 'https://chatgpt.com/c/abc',
            addedAt: 1,
          },
        ],
      },
    };

    chooseImport(manager, chatgpt, { platform: 'chatgpt' });
    await vi.waitFor(() =>
      expect(toastDriver.messages()).toContain(getTranslationSync('folder_import_wrong_site')),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.data).toEqual(folderData('Private a'));
    expect(local[key]).toEqual(folderData('Private a'));
    expect(treeText()).not.toContain('Trips');
  });
});
