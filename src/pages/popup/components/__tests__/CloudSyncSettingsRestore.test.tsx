import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';

import { CloudSyncSettings } from '../CloudSyncSettings';
import { createCloudSyncChromeMock as createChromeMock } from './cloudSyncChromeMock';
import { waitForCloudSyncAction } from './waitForCloudSyncAction';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    // Keys pass through, except the partial-restore template and its list
    // separator, so a test can read which parts it names and how they join.
    t: (key: string) =>
      key === 'syncRestorePartial'
        ? 'Restored: {restored}. Not restored: {failed} ({error})'
        : key === 'syncRestoreListSeparator'
          ? '、'
          : key,
  }),
}));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

type MockedChrome = typeof chrome;

const baseState: SyncState = {
  ...DEFAULT_SYNC_STATE,
  mode: 'manual',
  isAuthenticated: false,
};

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

type DownloadData = Record<string, unknown>;

function downloadResponder(data: DownloadData, highlightsSynced: boolean) {
  return vi.fn().mockImplementation((message: { type?: string }) => {
    if (message.type === 'gv.sync.getState') {
      return Promise.resolve({ ok: true, state: baseState });
    }
    if (message.type === 'gv.sync.download') {
      return Promise.resolve({
        ok: true,
        state: { ...baseState, isAuthenticated: true },
        ...(highlightsSynced ? { highlights: { synced: true, count: 2 } } : {}),
        data,
      });
    }
    return Promise.resolve({ ok: true });
  });
}

async function clickRestore(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((btn) =>
    (btn.textContent || '').includes(label),
  );
  await act(async () => {
    button?.click();
  });
  await waitForCloudSyncAction(button);
}

describe('CloudSyncSettings restore failures', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('fails the whole merge restore when local plugin state cannot be read', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.download') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
          data: {
            folders: { data: { folders: [], folderContents: {} } },
            prompts: { items: [] },
            settings: {
              format: 'gemini-voyager.settings.v1',
              exportedAt: new Date().toISOString(),
              version: '1.0.0',
              data: { [StorageKeys.MERMAID_ENABLED]: false },
            },
            plugins: {
              format: 'gemini-voyager.plugins.v1',
              exportedAt: new Date().toISOString(),
              version: '1.0.0',
              data: { cloud: { enabled: false, installedAt: 4 } },
            },
            starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock, {
      local: { [StorageKeys.PLUGINS_STATE]: { local: { enabled: true, installedAt: 1 } } },
      sync: { [StorageKeys.MERMAID_ENABLED]: true },
    });
    const getLocal = vi.mocked(chromeMock.storage.local.get).getMockImplementation()! as (
      keys: unknown,
    ) => Promise<Record<string, unknown>>;
    const before = await getLocal(null);
    (chromeMock.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: unknown) => {
        if (Array.isArray(keys) && keys.includes(StorageKeys.PLUGINS_STATE)) {
          throw new Error('local read failed');
        }
        return getLocal(keys);
      },
    );
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const downloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncMerge'),
    );
    await act(async () => {
      downloadButton?.click();
    });
    await waitForCloudSyncAction(downloadButton);

    expect(await getLocal(null)).toEqual(before);
    expect(await chromeMock.storage.sync.get(null)).toEqual({
      [StorageKeys.MERMAID_ENABLED]: true,
    });
    expect(container.textContent).toContain('syncError');
  });

  it('names the restored and the failed parts when a later write fails', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.download') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
          // The background already pulled highlights before the popup writes anything.
          highlights: { synced: true, count: 2 },
          data: {
            folders: { data: { folders: [], folderContents: {} } },
            prompts: { items: [] },
            settings: {
              format: 'gemini-voyager.settings.v1',
              exportedAt: new Date().toISOString(),
              version: '1.0.0',
              data: { [StorageKeys.MERMAID_ENABLED]: false },
            },
            plugins: {
              format: 'gemini-voyager.plugins.v1',
              exportedAt: new Date().toISOString(),
              version: '1.0.0',
              data: { cloud: { enabled: false, installedAt: 4 } },
            },
            starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    const setLocal = vi.mocked(chromeMock.storage.local.set).getMockImplementation()! as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    (chromeMock.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (items: Record<string, unknown>) => {
        if ('gvFolderData' in items) throw new Error('folders write failed');
        await setLocal(items);
      },
    );
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const downloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncMerge'),
    );
    await act(async () => {
      downloadButton?.click();
    });
    await waitForCloudSyncAction(downloadButton);

    expect(
      (await chromeMock.storage.local.get(StorageKeys.PLUGINS_STATE))[StorageKeys.PLUGINS_STATE],
    ).toEqual({ cloud: { enabled: false, installedAt: 4 } });
    expect(await chromeMock.storage.sync.get(null)).toEqual({
      [StorageKeys.MERMAID_ENABLED]: false,
    });
    expect(container.textContent).toContain(
      'Restored: storageQuotaHighlights、pluginsTitle、storageQuotaSync. ' +
        'Not restored: folder_title、promptDataMigration、savedLibraryStars (folders write failed)',
    );
  });

  it('does not name parts the backup had nothing for as restored', async () => {
    const sendMessageMock = downloadResponder(
      {
        folders: { data: { folders: [], folderContents: {} } },
        prompts: { items: [] },
        // No settings and no plugin state in this backup.
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      },
      true,
    );
    const chromeMock = createChromeMock(sendMessageMock);
    const setLocal = vi.mocked(chromeMock.storage.local.set).getMockImplementation()! as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    (chromeMock.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (items: Record<string, unknown>) => {
        if ('gvFolderData' in items) throw new Error('folders write failed');
        await setLocal(items);
      },
    );
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    await clickRestore(container, 'syncMerge');

    expect(await chromeMock.storage.sync.get(null)).toEqual({});
    expect(container.textContent).toContain(
      'Restored: storageQuotaHighlights. ' +
        'Not restored: folder_title、promptDataMigration、savedLibraryStars (folders write failed)',
    );
  });

  it('applies settings and prompts beside restored highlights while skipping missing folders', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendMessageMock = downloadResponder(
      {
        prompts: { items: [] },
        settings: {
          format: 'gemini-voyager.settings.v1',
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
          data: { [StorageKeys.MERMAID_ENABLED]: false },
        },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      },
      true,
    );
    const previousPrompt = { id: 'local', text: 'Local prompt', tags: [], createdAt: 1 };
    const chromeMock = createChromeMock(sendMessageMock, {
      local: {
        [StorageKeys.FOLDER_DATA]: 'legacy folder value',
        [StorageKeys.PROMPT_ITEMS]: [previousPrompt],
      },
      sync: { [StorageKeys.MERMAID_ENABLED]: true },
    });
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    await clickRestore(container, 'syncOverwrite');

    expect(
      (await chromeMock.storage.local.get(StorageKeys.FOLDER_DATA))[StorageKeys.FOLDER_DATA],
    ).toBe('legacy folder value');
    expect(
      (await chromeMock.storage.local.get(StorageKeys.PROMPT_ITEMS))[StorageKeys.PROMPT_ITEMS],
    ).toEqual([]);
    expect(await chromeMock.storage.sync.get(null)).toEqual({
      [StorageKeys.MERMAID_ENABLED]: false,
    });
    expect(container.textContent).toContain('syncOverwriteMissingFolders');
    expect(container.textContent).not.toContain('Not restored:');
  });

  it('reports folders and prompts as restored when the star owner write fails', async () => {
    const sendMessage = downloadResponder(
      {
        folders: { data: { folders: [], folderContents: {} } },
        prompts: { items: [] },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      },
      false,
    );
    const mocked = createChromeMock(sendMessage);
    const setLocal = vi.mocked(mocked.storage.local.set).getMockImplementation()! as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    vi.mocked(mocked.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.TIMELINE_STARRED_MESSAGES in items) throw new Error('stars write failed');
      await setLocal(items);
    });
    (globalThis as { chrome: MockedChrome }).chrome = mocked;
    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    await clickRestore(container, 'syncMerge');
    const stored = await mocked.storage.local.get(null);
    expect(stored[StorageKeys.FOLDER_DATA]).toEqual({ folders: [], folderContents: {} });
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(container.textContent).toContain(
      'Restored: folder_title、promptDataMigration. Not restored: savedLibraryStars (stars write failed)',
    );
  });

  it('names forks as not restored when the fork owner write fails after stars merged', async () => {
    const cloudFork = {
      conversationId: 'gemini:conv:cloud',
      turnId: 'turn',
      forkGroupId: 'fork-group',
      forkIndex: 0,
      createdAt: 1,
      conversationUrl: 'https://gemini.google.com/app/cloud',
    };
    const sendMessage = downloadResponder(
      {
        folders: { data: { folders: [], folderContents: {} } },
        prompts: { items: [] },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
        forks: {
          format: 'gemini-voyager.forks.v1',
          data: {
            nodes: { [cloudFork.conversationId]: [cloudFork] },
            groups: { [cloudFork.forkGroupId]: ['gemini:conv:cloud:turn'] },
          },
        },
      },
      false,
    );
    const mocked = createChromeMock(sendMessage);
    const setLocal = vi.mocked(mocked.storage.local.set).getMockImplementation()! as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    vi.mocked(mocked.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.FORK_NODES in items) throw new Error('forks write failed');
      await setLocal(items);
    });
    (globalThis as { chrome: MockedChrome }).chrome = mocked;
    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    await clickRestore(container, 'syncMerge');
    const stored = await mocked.storage.local.get(null);
    expect(stored[StorageKeys.FOLDER_DATA]).toEqual({ folders: [], folderContents: {} });
    expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(stored[StorageKeys.SAVED_LIBRARY_STARS]).toEqual({ messages: {} });
    expect(stored[StorageKeys.FORK_NODES]).toBeUndefined();
    expect(container.textContent).toContain(
      'Restored: folder_title、promptDataMigration、savedLibraryStars. ' +
        'Not restored: syncRestoreForks (forks write failed)',
    );
  });

  it('keeps the missing-folders warning after a partial overwrite applies present data', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendMessageMock = downloadResponder(
      {
        prompts: { items: [] },
        starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
      },
      false,
    );
    const chromeMock = createChromeMock(sendMessageMock);
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();
    await clickRestore(container, 'syncOverwrite');

    expect(
      (await chromeMock.storage.local.get(StorageKeys.PROMPT_ITEMS))[StorageKeys.PROMPT_ITEMS],
    ).toEqual([]);
    expect(container.textContent).toContain('syncOverwriteMissingFolders');
    expect(container.textContent).not.toContain('Restored:');
    expect(container.textContent).not.toContain('syncError');
  });
});
