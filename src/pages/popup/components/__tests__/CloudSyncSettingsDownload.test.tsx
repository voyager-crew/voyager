import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';
import { getTimelineHierarchyStorageKey } from '@/pages/content/timeline/hierarchyStorage';

import { CloudSyncSettings } from '../CloudSyncSettings';
import {
  baseState,
  createCloudSyncChromeMock as createChromeMock,
  flushMicrotasks,
} from './cloudSyncChromeMock';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

type MockedChrome = typeof chrome;

describe('CloudSyncSettings download', () => {
  let container: HTMLDivElement;
  let root: Root;

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

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('triggers download directly without a separate authenticate message', async () => {
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
            starred: { data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const downloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncMerge'),
    );
    expect(downloadButton).toBeTruthy();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.download',
      }),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.authenticate',
      }),
    );
  });

  it('reports a partial sync when other data exists but the folder backup is missing', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.download') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
          data: { prompts: { items: [] } },
        });
      }
      return Promise.resolve({ ok: true });
    });
    (globalThis as { chrome: MockedChrome }).chrome = createChromeMock(sendMessageMock);

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
    await flushMicrotasks();

    expect(container.textContent).toContain('syncSuccessFoldersMissing');
  });

  it('blocks overwrite when Drive has no folders payload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.download') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
          data: {
            prompts: { items: [] },
            starred: { data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (chromeMock.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        folders: [
          {
            id: 'folder-1',
            name: 'Existing',
            parentId: null,
            isExpanded: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        folderContents: {},
      },
    });
    (chromeMock.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      gvFolderData: {
        folders: [
          {
            id: 'folder-1',
            name: 'Existing',
            parentId: null,
            isExpanded: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        folderContents: {},
      },
      gvPromptItems: [],
      geminiTimelineStarredMessages: { messages: {} },
      [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    });
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const overwriteButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncOverwrite'),
    );
    expect(overwriteButton).toBeTruthy();

    await act(async () => {
      overwriteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('syncOverwriteMissingFolders');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'gv.folders.reload' }),
    );
  });

  it('persists merged timeline hierarchy data on download', async () => {
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
            starred: { data: { messages: {} } },
            timelineHierarchy: {
              data: {
                conversations: {
                  'gemini:conv:test': {
                    conversationUrl: 'https://gemini.google.com/app/test',
                    levels: { 'turn-1': 2 },
                    collapsed: ['turn-2'],
                    updatedAt: 1234,
                  },
                },
              },
            },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const downloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncMerge'),
    );
    expect(downloadButton).toBeTruthy();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    const localSetMock = chromeMock.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    expect(localSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        [StorageKeys.TIMELINE_HIERARCHY]: {
          conversations: {
            'gemini:conv:test': {
              conversationUrl: 'https://gemini.google.com/app/test',
              levels: { 'turn-1': 2 },
              collapsed: ['turn-2'],
              updatedAt: 1234,
            },
          },
        },
      }),
    );
  });

  it('restores synced settings into chrome.storage.sync on download', async () => {
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
              data: {
                [StorageKeys.CHAT_WIDTH]: 88,
                [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
                unknownKey: 'ignore-me',
              },
            },
            starred: { data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const downloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncMerge'),
    );
    expect(downloadButton).toBeTruthy();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    const syncSetMock = chromeMock.storage.sync.set as unknown as ReturnType<typeof vi.fn>;
    expect(syncSetMock).toHaveBeenCalledWith({
      [StorageKeys.CHAT_WIDTH]: 88,
      [StorageKeys.CONTEXT_SYNC_PORT]: 4040,
    });
  });

  it('merges the independent cloud plugin-state file into local storage', async () => {
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
            plugins: {
              format: 'gemini-voyager.plugins.v1',
              exportedAt: new Date().toISOString(),
              version: '1.0.0',
              data: {
                shared: { enabled: true, installedAt: 3, settings: { width: 80 } },
                cloud: { enabled: false, installedAt: 4 },
              },
            },
            starred: { data: { messages: {} } },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (chromeMock.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      gvFolderData: { folders: [], folderContents: {} },
      gvPromptItems: [],
      geminiTimelineStarredMessages: { messages: {} },
      [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
      [StorageKeys.PLUGINS_STATE]: {
        local: { enabled: true, installedAt: 1 },
        shared: { enabled: false, installedAt: 2, settings: { width: 60 } },
      },
    });
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
    await flushMicrotasks();

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      [StorageKeys.PLUGINS_STATE]: {
        local: { enabled: true, installedAt: 1 },
        shared: { enabled: true, installedAt: 3, settings: { width: 80 } },
        cloud: { enabled: false, installedAt: 4 },
      },
    });
  });

  it('stores merged timeline hierarchy under the current account scope when isolation is enabled', async () => {
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
            starred: { data: { messages: {} } },
            timelineHierarchy: {
              data: {
                conversations: {
                  'gemini:conv:test': {
                    conversationUrl: 'https://gemini.google.com/u/1/app/test',
                    levels: { 'turn-1': 2 },
                    collapsed: ['turn-2'],
                    updatedAt: 1234,
                  },
                },
              },
            },
          },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (chromeMock.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
    });
    (chromeMock.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://gemini.google.com/u/1/app/test' },
    ]);
    (chromeMock.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_tabId: number, message: { type?: string }) => {
        if (message.type === 'gv.account.getContext') {
          return Promise.resolve({
            ok: true,
            context: {
              routeUserId: '1',
              email: 'user@example.com',
            },
          });
        }

        if (message.type === 'gv.sync.requestData') {
          return Promise.resolve({
            ok: true,
            data: { folders: [], folderContents: {} },
            accountScope: {
              accountKey: `email:${hashString('user@example.com')}`,
              accountId: 1,
              routeUserId: '1',
            },
          });
        }

        return Promise.resolve({ ok: true });
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
    expect(downloadButton).toBeTruthy();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    const localSetMock = chromeMock.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    const scopedHierarchyKey = getTimelineHierarchyStorageKey(
      `email:${hashString('user@example.com')}`,
    );

    expect(localSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        [scopedHierarchyKey]: {
          conversations: {
            'gemini:conv:test': {
              conversationUrl: 'https://gemini.google.com/u/1/app/test',
              levels: { 'turn-1': 2 },
              collapsed: ['turn-2'],
              updatedAt: 1234,
            },
          },
        },
      }),
    );
  });
});
