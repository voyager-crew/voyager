import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { routeCatalogOutlineWrites } from '@/features/timeline/__tests__/catalogOutlineBackground';

import { useCloudSyncSettings } from '../useCloudSyncSettings';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

type Settings = ReturnType<typeof useCloudSyncSettings>;
function Harness({ capture }: { capture: (settings: Settings) => void }) {
  const settings = useCloudSyncSettings(42);
  useEffect(() => {
    capture(settings);
  }, [capture, settings]);
  return null;
}

describe('cloud sync popup state owner', () => {
  let root: Root;
  let container: HTMLDivElement;
  let settings: Settings;
  const state = { ...DEFAULT_SYNC_STATE, mode: 'manual' as const };
  const sendMessage = vi.fn<(message: { type: string }) => Promise<unknown>>();
  const localSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sendMessage.mockImplementation(async (message) =>
      message.type === 'gv.sync.getState' ? { ok: true, state } : { ok: true },
    );
    localSet.mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test',
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
      tabs: {
        get: vi.fn().mockRejectedValue(new Error('source tab closed')),
        query: vi.fn().mockResolvedValue([{ url: 'https://gemini.google.com/app' }]),
      },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: localSet },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness capture={(next) => (settings = next)} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('falls back to the active tab when the source tab has closed', () => {
    expect(settings.platform).toBe('gemini');
    expect(settings.hasFolderPlatform).toBe(true);
    expect(chrome.tabs.get).toHaveBeenCalledWith(42);
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('rolls back the highlight preference after a rejected storage write', async () => {
    localSet.mockRejectedValueOnce(new Error('storage unavailable'));
    await act(async () => settings.handleHighlightSyncChange(false));
    expect(localSet).toHaveBeenCalledWith({ [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false });
    expect(settings.highlightSyncEnabled).toBe(true);
  });

  it('cancels overwrite before requesting cloud data or entering a busy state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    sendMessage.mockClear();
    await act(async () => settings.handleDownloadFromDrive('overwrite'));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(settings.isDownloading).toBe(false);
    expect(settings.downloadMode).toBeNull();
  });

  it('retains returned sync state and resets busy flags after a failed upload', async () => {
    const failedState = { ...state, isAuthenticated: true, error: 'upload failed' };
    sendMessage.mockResolvedValueOnce({ ok: false, state: failedState });
    await act(async () => settings.handleSyncNow());
    expect(settings.syncState).toEqual(failedState);
    expect(settings.statusMessage?.kind).toBe('err');
    expect(settings.isUploading).toBe(false);
  });

  it.each([
    [false, 'syncNoData', 'err'],
    [true, 'syncSuccess', 'ok'],
  ] as const)(
    'handles data-free download with highlights synced=%s',
    async (synced, text, kind) => {
      sendMessage.mockResolvedValueOnce({ ok: true, data: null, highlights: { synced } });
      await act(async () => settings.handleDownloadFromDrive());
      expect(settings.statusMessage).toEqual({ text, kind });
      expect(settings.isDownloading).toBe(false);
      expect(settings.downloadMode).toBeNull();
      expect(localSet).not.toHaveBeenCalled();
    },
  );

  it('restores ChatGPT outlines from the cloud when no folder file is there', async () => {
    const key = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
    const outline = {
      conversationUrl: 'https://chatgpt.com/c/one',
      levels: { 'turn-one': 2 },
      collapsed: [],
      updatedAt: 10,
    };
    const popup = { id: 'test', url: 'chrome-extension://test/src/pages/popup/index.html' };
    sendMessage.mockImplementation(
      routeCatalogOutlineWrites(
        async (message: { type: string }) =>
          message.type === 'gv.sync.download'
            ? { ok: true, data: null, highlights: { synced: false } }
            : message.type === 'gv.sync.catalogTimeline.pull'
              ? { ok: true, buckets: { [key]: { conversations: { one: outline } } }, stars: {} }
              : { ok: true, state },
        popup,
      ) as (message: { type: string }) => Promise<unknown>,
    );
    await act(async () => settings.handleDownloadFromDrive());

    expect(localSet).toHaveBeenCalledWith({ [key]: { conversations: { one: outline } } });
    expect(settings.statusMessage).toEqual({ text: 'syncSuccess', kind: 'ok' });
  });

  it('expires status after three seconds and cancels pending expiry on unmount', async () => {
    vi.useFakeTimers();
    await act(async () => settings.handleSyncNow());
    await act(async () => vi.advanceTimersByTimeAsync(2999));
    expect(settings.statusMessage?.text).toBe('syncSuccess');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(settings.statusMessage).toBeNull();
    await act(async () => settings.handleSyncNow());
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
