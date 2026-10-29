import { describe, expect, it, vi } from 'vitest';

import { captureCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';

import { cloudFolders, localFolders, setupFlowHarness } from './cloudSyncFlowHarness';

vi.mock(
  '@/contexts/LanguageContext',
  async () => (await import('./cloudSyncFlowLanguage')).languageMock,
);
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
}));

const ids = (value: unknown) => (value as FolderData).folders.map(({ id }) => id);

describe('popup Undo after a download', () => {
  const h = setupFlowHarness();

  async function merge(
    data: Record<string, unknown> = { folders: { data: cloudFolders } },
    completion: unknown = { ok: true },
  ) {
    await h.mount(
      (message) =>
        message.type === 'gv.sync.download'
          ? { ok: true, operationId: 'op', catalog: null, data }
          : message.type === 'gv.sync.completeDownload'
            ? completion
            : undefined,
      { local: { [StorageKeys.FOLDER_DATA]: localFolders } },
    );
    vi.mocked(h.chrome.tabs.sendMessage).mockResolvedValue({
      ok: true,
      data: localFolders,
    } as never);
    await h.click('syncMerge');
    await vi.waitFor(() => expect(h.button('syncUndo')).toBeDefined(), { timeout: 5000 });
  }

  const folders = async () =>
    (await h.chrome.storage.local.get(StorageKeys.FOLDER_DATA))[StorageKeys.FOLDER_DATA];

  it('restores the folders from before the download, says so, and offers no second Undo', async () => {
    await merge();
    expect(ids(await folders())).toEqual(['local', 'cloud']);

    await h.click('syncUndo');
    await vi.waitFor(() => expect(h.status()).toContain('syncUndoDone'));

    expect(ids(await folders())).toEqual(['local']);
    expect(h.button('syncUndo')).toBeUndefined();
  });

  it('leaves a later download in place when Undo was offered for an earlier one', async () => {
    await merge();
    // The folder panel downloads meanwhile and takes the undo slot.
    await captureCloudSyncSnapshot({
      context: { source: 'folder-panel-download', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: StorageKeys.FOLDER_DATA }],
    });

    await h.click('syncUndo');
    await vi.waitFor(() => expect(h.status()).toContain('syncUndoReplaced'));
    expect(ids(await folders())).toEqual(['local', 'cloud']);
  });

  it('keeps the result and its Undo when only the completion handshake fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await merge(undefined, { ok: false, error: 'stale_download' });

    expect(h.status()).toContain('syncSuccess');
    expect(h.status()).toContain('syncReasonStatusRecord');
    expect(h.status()).not.toContain('syncDownloadFailed');
    expect(h.status()).not.toContain('stale_download');
  });

  it('offers Undo after a partial restore, and Undo brings the folders back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.mount(
      (message) =>
        message.type === 'gv.sync.download'
          ? {
              ok: true,
              operationId: 'op',
              catalog: null,
              data: {
                folders: { data: cloudFolders },
                starred: { format: 'gemini-voyager.starred.v1', data: { messages: {} } },
              },
            }
          : undefined,
      { local: { [StorageKeys.FOLDER_DATA]: localFolders } },
    );
    vi.mocked(h.chrome.tabs.sendMessage).mockResolvedValue({
      ok: true,
      data: localFolders,
    } as never);
    const set = vi.mocked(h.chrome.storage.local.set).getMockImplementation() as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    vi.mocked(h.chrome.storage.local.set).mockImplementation(async (items) => {
      if (StorageKeys.TIMELINE_STARRED_MESSAGES in items) throw new Error('stars write failed');
      await set(items);
    });
    await h.click('syncMerge');
    await vi.waitFor(() => expect(h.button('syncUndo')).toBeDefined(), { timeout: 5000 });
    expect(h.status()).toContain('Not restored: savedLibraryStars');
    expect(ids(await folders())).toEqual(['local', 'cloud']);

    await h.click('syncUndo');
    await vi.waitFor(() => expect(h.status()).toContain('syncUndoDone'));
    expect(ids(await folders())).toEqual(['local']);
  });
});
