import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudDownloadData } from '@/core/services/CloudSyncDownloadService';
import { StorageKeys } from '@/core/types/common';

import { createScopeSyncDevice, syncTestEnvelope, syncTestFolders } from './cloudSyncScopeHarness';

const folderFile = 'gemini-voyager-aistudio-folders.json';
const folderKey = StorageKeys.FOLDER_DATA_AISTUDIO;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type DownloadReply = {
  ok: boolean;
  data: CloudDownloadData;
  snapshotId: string;
  operationId: string;
  selection: NonNullable<CloudDownloadData['selection']>;
};

async function applyDownload(download: DownloadReply) {
  const { applyPopupCloudDownload } = await import('@/core/services/CloudSyncDownloadService');
  return applyPopupCloudDownload({
    context: {
      payload: { platform: 'aistudio', accountScope: null },
      timelineHierarchyStorageKey: StorageKeys.TIMELINE_HIERARCHY,
    },
    local: {
      folders: syncTestFolders('Local'),
      timelineHierarchy: { conversations: {} },
      folderStorageKey: folderKey,
      accountChanged: false,
    },
    data: { ...download.data, snapshotId: download.snapshotId, selection: download.selection },
    mode: 'overwrite',
    highlightsRestored: false,
    catalog: { status: 'pulled', value: null },
    send: async () => undefined,
  });
}

describe('download bookkeeping after real owner applies', () => {
  it('records applied data only after the owner finishes and the caller acknowledges success', async () => {
    const d = await createScopeSyncDevice();
    d.values[folderKey] = syncTestFolders('Local');
    d.drive.put(
      folderFile,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud')),
    );
    const download = (await d.request('gv.sync.download', {
      platform: 'aistudio',
      selection: 'site',
    })) as DownloadReply;
    expect(download.ok).toBe(true);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
    await applyDownload(download);
    expect(d.values[folderKey]).toEqual(syncTestFolders('Cloud'));
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
    await expect(
      d.request('gv.sync.completeDownload', { operationId: download.operationId, success: true }),
    ).resolves.toMatchObject({ ok: true, recorded: true });
    const reads = d.requests.filter((url) => url.searchParams.get('alt') === 'media').length;
    await expect(
      d.request('gv.sync.getStatus', { platform: 'aistudio', rows: ['aistudio'] }),
    ).resolves.toMatchObject({ rows: [{ row: 'aistudio', status: 'synced' }] });
    d.values[folderKey] = syncTestFolders('Later edit');
    await expect(
      d.request('gv.sync.getStatus', { platform: 'aistudio', rows: ['aistudio'] }),
    ).resolves.toMatchObject({ rows: [{ status: 'newer_here' }] });
    expect(d.requests.filter((url) => url.searchParams.get('alt') === 'media')).toHaveLength(reads);
  });

  it('a partial apply leaves the complete prior bookkeeping unchanged', async () => {
    const d = await createScopeSyncDevice();
    d.values[folderKey] = syncTestFolders('Local');
    await expect(
      d.request('gv.sync.upload', { platform: 'aistudio', selection: 'site' }),
    ).resolves.toMatchObject({ ok: true });
    const before = structuredClone(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]);
    d.drive.put(
      folderFile,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud')),
    );
    d.drive.put(
      'gemini-voyager-settings.json',
      syncTestEnvelope('gemini-voyager.settings.v1', { [StorageKeys.CHAT_WIDTH]: 96 }),
    );
    const download = (await d.request('gv.sync.download', {
      platform: 'aistudio',
    })) as DownloadReply;
    const write = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (values) => {
      if (folderKey in values) throw new Error('folders_write_failed');
      await write(values);
    });
    await expect(applyDownload(download)).rejects.toMatchObject({
      restored: ['settings'],
      failed: ['folders'],
    });
    expect(d.syncValues[StorageKeys.CHAT_WIDTH]).toBe(96);
    expect(d.values[folderKey]).toEqual(syncTestFolders('Local'));
    await expect(
      d.request('gv.sync.completeDownload', { operationId: download.operationId, success: false }),
    ).resolves.toMatchObject({ ok: true, recorded: false });
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toEqual(before);
  });

  it('does not call an edit after the apply the value received from cloud', async () => {
    const d = await createScopeSyncDevice();
    d.values[folderKey] = syncTestFolders('Local');
    d.drive.put(
      folderFile,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud')),
    );
    const download = (await d.request('gv.sync.download', {
      platform: 'aistudio',
      selection: 'site',
    })) as DownloadReply;
    await applyDownload(download);
    d.values[folderKey] = syncTestFolders('Later edit');
    await expect(
      d.request('gv.sync.completeDownload', { operationId: download.operationId, success: true }),
    ).resolves.toMatchObject({ ok: true, recorded: false, reason: 'changed_since_download' });
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });

  it('does not record a transient edit even when storage returns to the receipted value before completion', async () => {
    const d = await createScopeSyncDevice();
    d.values[folderKey] = syncTestFolders('Local');
    const applied = syncTestFolders('Cloud');
    d.drive.put(folderFile, syncTestEnvelope('gemini-voyager.folders.v1', applied));
    const download = (await d.request('gv.sync.download', {
      platform: 'aistudio',
      selection: 'site',
    })) as DownloadReply;
    await applyDownload(download);
    d.values[folderKey] = syncTestFolders('Transient later edit');
    const read = chrome.storage.local.get;
    let reverted = false;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      const requested =
        typeof keys === 'string'
          ? keys
          : Array.isArray(keys)
            ? keys.filter((key): key is string => typeof key === 'string')
            : null;
      const captured = await read<Record<string, unknown>>(requested);
      if (!reverted && (keys === null || keys === folderKey)) {
        // Another context reverts B to A after this browser read captured B.
        reverted = true;
        d.values[folderKey] = structuredClone(applied);
      }
      return captured;
    });

    await expect(
      d.request('gv.sync.completeDownload', { operationId: download.operationId, success: true }),
    ).resolves.toMatchObject({ ok: true, recorded: false, reason: 'changed_since_download' });
    expect(d.values[folderKey]).toEqual(applied);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });
});
