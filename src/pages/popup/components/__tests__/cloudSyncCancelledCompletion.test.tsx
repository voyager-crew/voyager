import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { useCloudSyncSettings } from '../useCloudSyncSettings';
import { baseState, createCloudSyncChromeMock, flushMicrotasks } from './cloudSyncChromeMock';
import { emptyFolders, folders } from './cloudSyncTransferHarness';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (key: string) => key }),
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

describe('popup completion after download interruption', () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['closed', 'failed'] as const)(
    'sends success false after a %s apply settles',
    async (interruption) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const send = vi.fn(async (message: { type?: string }) => {
        if (message.type === 'gv.sync.getState') return { ok: true, state: baseState };
        if (message.type === 'gv.sync.download')
          return {
            ok: true,
            operationId: 'interrupted-download',
            catalog: null,
            data: { folders: { data: emptyFolders } },
          };
        return { ok: true };
      });
      const storage = createCloudSyncChromeMock(send, {
        local: { [StorageKeys.FOLDER_DATA]: folders },
      });
      vi.stubGlobal('chrome', storage);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const save = vi.mocked(storage.storage.local.set).getMockImplementation()!;
      vi.spyOn(storage.storage.local, 'set').mockImplementation(
        async (items: Record<string, unknown>) => {
          if (StorageKeys.FOLDER_DATA in items) {
            entered.resolve();
            await release.promise;
            if (interruption === 'failed') throw new Error('canonical quota');
          }
          await save(items, () => {});
        },
      );
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
      let applying!: Promise<void>;
      await act(async () => {
        applying = settings.handleDownloadFromDrive('overwrite');
        await entered.promise;
      });
      if (interruption === 'closed') await act(async () => root?.unmount());
      expect(send.mock.calls.some(([message]) => message.type === 'gv.sync.completeDownload')).toBe(
        false,
      );
      release.resolve();
      await act(async () => applying);

      expect(send).toHaveBeenCalledWith({
        type: 'gv.sync.completeDownload',
        payload: { operationId: 'interrupted-download', success: false },
      });
      const stored = await storage.storage.local.get<Record<string, unknown>>(
        StorageKeys.FOLDER_DATA,
      );
      expect(stored[StorageKeys.FOLDER_DATA]).toEqual(
        interruption === 'closed' ? emptyFolders : folders,
      );
    },
  );
});
