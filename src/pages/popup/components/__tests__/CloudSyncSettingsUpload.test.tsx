import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

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

describe('CloudSyncSettings upload', () => {
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

  it('triggers upload directly without a separate authenticate message', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
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

    const uploadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncUpload'),
    );
    expect(uploadButton).toBeTruthy();

    await act(async () => {
      uploadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
      }),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.authenticate',
      }),
    );
  });

  it('includes highlights by default in the next manual upload', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      return Promise.resolve({ ok: true });
    });
    const chromeMock = createChromeMock(sendMessageMock);
    vi.mocked(chromeMock.tabs.sendMessage).mockImplementation(async (_tabId, message) => {
      if ((message as { type?: string }).type === 'gv.account.getContext') {
        return {
          ok: true,
          context: { routeUserId: '0', email: 'user@example.com' },
        } as never;
      }
      return { ok: true, data: { folders: [], folderContents: {} } } as never;
    });
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const toggle = container.querySelector<HTMLInputElement>('#highlight-cloud-sync');
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(true);

    const uploadButton = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent || '').includes('syncUpload'),
    );
    await act(async () => {
      uploadButton?.click();
    });
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
        payload: expect.objectContaining({
          includeHighlights: true,
          highlightAccountScope: expect.objectContaining({ routeUserId: '0' }),
        }),
      }),
    );
  });

  it('uses the default account scope when the Gemini page has no explicit account id', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      return Promise.resolve({ ok: true });
    });
    const chromeMock = createChromeMock(sendMessageMock);
    vi.mocked(chromeMock.tabs.sendMessage).mockImplementation(async (_tabId, message) => {
      if ((message as { type?: string }).type === 'gv.account.getContext') {
        return {
          ok: true,
          context: { routeUserId: null, email: null },
        } as never;
      }
      return { ok: true, data: { folders: [], folderContents: {} } } as never;
    });
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const uploadButton = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent || '').includes('syncUpload'),
    );
    await act(async () => {
      uploadButton?.click();
    });
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
        payload: expect.objectContaining({
          includeHighlights: true,
          highlightAccountScope: expect.objectContaining({
            accountKey: 'default',
            routeUserId: null,
          }),
        }),
      }),
    );
  });

  it('reports a partial success when highlights are skipped without page context', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({
          ok: true,
          state: baseState,
          highlights: { synced: false, skipped: true },
        });
      }
      return Promise.resolve({ ok: true });
    });
    const chromeMock = createChromeMock(sendMessageMock);
    vi.mocked(chromeMock.tabs.sendMessage).mockRejectedValue(new Error('No receiving end'));
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings />);
    });
    await flushMicrotasks();

    const uploadButton = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent || '').includes('syncUpload'),
    );
    await act(async () => {
      uploadButton?.click();
    });
    await flushMicrotasks();

    expect(container.textContent).toContain('syncSuccessHighlightsSkipped');
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
        payload: expect.objectContaining({
          includeHighlights: true,
          highlightAccountScope: null,
        }),
      }),
    );
  });

  it('uses the source tab when options is opened as the popup fallback', async () => {
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({
          ok: true,
          state: { ...baseState, isAuthenticated: true },
        });
      }
      return Promise.resolve({ ok: true });
    });

    const chromeMock = createChromeMock(sendMessageMock);
    (chromeMock.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 7, url: 'chrome-extension://test/src/pages/options/index.html' },
    ]);
    (chromeMock.tabs.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 42,
      url: 'https://gemini.google.com/app/source',
    });
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    await act(async () => {
      root = createRoot(container);
      root.render(<CloudSyncSettings sourceTabId={42} />);
    });
    await flushMicrotasks();

    const uploadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncUpload'),
    );
    expect(uploadButton).toBeTruthy();

    await act(async () => {
      uploadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();

    expect(chromeMock.tabs.get).toHaveBeenCalledWith(42);
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ type: 'gv.sync.requestData' }),
    );
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'gv.sync.requestData' }),
    );
  });

  it('uploads legacy Safari folder data stored as a JSON string', async () => {
    const storedFolders = {
      folders: [
        {
          id: 'folder-1',
          name: 'Research',
          parentId: null,
          isExpanded: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      folderContents: { 'folder-1': [] },
    };
    const sendMessageMock = vi.fn().mockImplementation((message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      if (message.type === 'gv.sync.upload') {
        return Promise.resolve({ ok: true, state: baseState });
      }
      return Promise.resolve({ ok: true });
    });
    const chromeMock = createChromeMock(sendMessageMock);
    (chromeMock.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('No receiving end'),
    );
    (chromeMock.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      gvFolderData: JSON.stringify(storedFolders),
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

    const uploadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      (btn.textContent || '').includes('syncUpload'),
    );
    await act(async () => {
      uploadButton?.click();
    });
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gv.sync.upload',
        payload: expect.objectContaining({ folders: storedFolders }),
      }),
    );
  });
});
