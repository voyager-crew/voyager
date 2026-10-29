import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCloudSyncSettings } from '../useCloudSyncSettings';
import { baseState, createCloudSyncChromeMock, flushMicrotasks } from './cloudSyncChromeMock';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (key: string) => key }),
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

describe('popup completion after an empty download', () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports cancellation when the popup closes before a no-data reply with no snapshot', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const send = vi.fn(async (message: { type?: string }) => {
      if (message.type === 'gv.sync.getState') return { ok: true, state: baseState };
      if (message.type === 'gv.sync.download') {
        entered.resolve();
        await release.promise;
        return { ok: true, operationId: 'empty-download', catalog: null, data: null };
      }
      return { ok: true };
    });
    const storage = createCloudSyncChromeMock(send);
    vi.stubGlobal('chrome', storage);
    let settings!: ReturnType<typeof useCloudSyncSettings>;
    function Harness() {
      const value = useCloudSyncSettings();
      useEffect(() => {
        settings = value;
      }, [value]);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    await flushMicrotasks();
    let downloading!: Promise<void>;
    await act(async () => {
      downloading = settings.handleDownloadFromDrive('overwrite');
      await entered.promise;
    });
    await act(async () => root?.unmount());
    root = undefined;
    release.resolve();
    await act(async () => downloading);

    expect(send).toHaveBeenCalledWith({
      type: 'gv.sync.completeDownload',
      payload: { operationId: 'empty-download', success: false },
    });
    expect(storage.storage.local.set).not.toHaveBeenCalled();
    expect(storage.storage.sync.set).not.toHaveBeenCalled();
  });
});
