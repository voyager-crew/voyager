import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  createScopeSyncDevice,
  SYNC_TEST_PROMPTS_FILE,
  syncTestEnvelope,
  syncTestFolders,
  syncTestPrompt,
} from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
function rejectRelease(values: Record<string, unknown>): void {
  const slot = values[SLOT];
  if (
    slot &&
    typeof slot === 'object' &&
    'run' in slot &&
    slot.run &&
    typeof slot.run === 'object' &&
    !('active' in slot.run)
  )
    throw new Error('run release storage failed');
}

it.each([false, true])(
  'preserves the prompts apply outcome when run release fails (apply failure %s)',
  async (applyFails) => {
    const d = await createScopeSyncDevice();
    d.drive.put(SYNC_TEST_PROMPTS_FILE, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('cloud')],
    });
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (values) => {
      rejectRelease(values);
      if (applyFails && StorageKeys.PROMPT_ITEMS in values)
        throw new Error('prompt canonical failed');
      await set(values);
    });
    const result = await d.request('gv.sync.pullPromptsMerge', { snapshotRun: 'start' });
    expect(result).toMatchObject(
      applyFails
        ? { ok: false, error: 'prompt canonical failed', snapshotId: expect.any(String) }
        : { ok: true, warning: 'sync_bookkeeping_failed', snapshotId: expect.any(String) },
    );
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(
      applyFails ? [syncTestPrompt('local')] : [syncTestPrompt('cloud'), syncTestPrompt('local')],
    );
    expect(result).not.toMatchObject({ error: 'run release storage failed' });
  },
);

it.each([false, true])(
  'does not turn a completion release failure into a data failure (bookkeeping failure %s)',
  async (bookkeepingFails) => {
    const d = await createScopeSyncDevice();
    const folderKey = StorageKeys.FOLDER_DATA_AISTUDIO;
    const cloud = syncTestFolders('Cloud');
    d.values[folderKey] = syncTestFolders('Before');
    d.drive.put(
      'gemini-voyager-aistudio-folders.json',
      syncTestEnvelope('gemini-voyager.folders.v1', cloud),
    );
    const response = (await d.request('gv.sync.download', {
      platform: 'aistudio',
      selection: 'site',
      snapshotRun: 'start',
    })) as { snapshotId: string; operationId: string };
    const { applyCloudRestore } = await import('@/core/services/CloudSyncApplyService');
    await applyCloudRestore({
      snapshot: { source: 'popup-restore', platform: 'aistudio', accountScope: null },
      snapshotId: response.snapshotId,
      mode: 'overwrite',
      highlightsRestored: false,
      storageUpdate: { [folderKey]: cloud },
      storageParts: ['folders'],
    });
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (values) => {
      rejectRelease(values);
      if (bookkeepingFails && StorageKeys.CLOUD_SYNC_BOOKKEEPING in values)
        throw new Error('first bookkeeping failed');
      await set(values);
    });
    const result = d.request('gv.sync.completeDownload', {
      operationId: response.operationId,
      success: true,
    });
    if (bookkeepingFails) await expect(result).rejects.toThrow('first bookkeeping failed');
    else await expect(result).resolves.toEqual({ ok: false, error: 'sync_bookkeeping_failed' });
    expect(d.values[folderKey]).toEqual(cloud);
    const { readCloudSyncSnapshot } = await import('@/core/services/CloudSyncSnapshotService');
    expect((await readCloudSyncSnapshot())?.id).toBe(response.snapshotId);
  },
);
