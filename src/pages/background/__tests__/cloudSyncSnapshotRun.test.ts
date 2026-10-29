import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudDownloadData } from '@/core/services/CloudSyncDownloadService';
import { StorageKeys } from '@/core/types/common';
import type { SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import {
  createScopeSyncDevice,
  SYNC_TEST_EXTENSION,
  SYNC_TEST_PROMPTS_FILE,
  syncTestEnvelope,
  syncTestFolders,
  syncTestPrompt,
} from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sender = (documentId = 'run-popup'): chrome.runtime.MessageSender => ({
  id: SYNC_TEST_EXTENSION,
  url: `chrome-extension://${SYNC_TEST_EXTENSION}/src/pages/popup/index.html`,
  documentId,
});
type Download = {
  ok: boolean;
  data: CloudDownloadData;
  snapshotId: string;
  operationId: string;
  selection: NonNullable<CloudDownloadData['selection']>;
};
function snapshotId(response: unknown): string {
  expect(response).toMatchObject({ ok: true, snapshotId: expect.any(String) });
  if (
    !response ||
    typeof response !== 'object' ||
    !('snapshotId' in response) ||
    typeof response.snapshotId !== 'string'
  )
    throw new Error('Missing snapshot id');
  return response.snapshotId;
}
async function applySite(platform: SyncPlatform, download: Download) {
  const { applyPopupCloudDownload } = await import('@/core/services/CloudSyncDownloadService');
  return applyPopupCloudDownload({
    context: {
      payload: { platform, accountScope: null },
      timelineHierarchyStorageKey: StorageKeys.TIMELINE_HIERARCHY,
    },
    local: {
      folders: syncTestFolders('before'),
      timelineHierarchy: { conversations: {} },
      folderStorageKey: FOLDER_PLATFORMS[platform].folderStorageKey,
      accountChanged: false,
    },
    data: { ...download.data, snapshotId: download.snapshotId, selection: download.selection },
    mode: 'overwrite',
    highlightsRestored: false,
    catalog: { status: 'pulled', value: null },
    send: async () => undefined,
  });
}

describe('one snapshot across runtime download rows', () => {
  it('requires a row completion before the next row can join', async () => {
    const d = await createScopeSyncDevice();
    const first = (await d.request(
      'gv.sync.download',
      { selection: 'shared', snapshotRun: 'start' },
      sender(),
    )) as Download;
    const id = snapshotId(first);
    const calls = d.requests.length;
    await expect(
      d.request(
        'gv.sync.download',
        { platform: 'aistudio', selection: 'site', snapshotRun: { snapshotId: id } },
        sender(),
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid_sync_request' });
    expect(d.requests).toHaveLength(calls);
    await expect(
      d.request(
        'gv.sync.completeDownload',
        { operationId: first.operationId, success: false },
        sender(),
      ),
    ).resolves.toEqual({ ok: true, recorded: false });
    expect(
      snapshotId(
        await d.request(
          'gv.sync.download',
          { platform: 'aistudio', selection: 'site', snapshotRun: { snapshotId: id } },
          sender(),
        ),
      ),
    ).toBe(id);
  });

  it('records the current site row when an earlier prompts row was edited afterward', async () => {
    const d = await createScopeSyncDevice();
    d.drive.put(SYNC_TEST_PROMPTS_FILE, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('cloud')],
    });
    const id = snapshotId(
      await d.request('gv.sync.pullPromptsMerge', { snapshotRun: 'start' }, sender()),
    );
    const { promptLibraryOwner } = await import('../promptLibraryOwner');
    await promptLibraryOwner.apply({
      kind: 'update',
      id: 'cloud',
      changes: { text: 'Edited between rows' },
    });
    const edited = structuredClone(d.values[StorageKeys.PROMPT_ITEMS]);
    d.values[StorageKeys.FOLDER_DATA_AISTUDIO] = syncTestFolders('Before');
    d.drive.put(
      FOLDER_PLATFORMS.aistudio.driveFoldersFileName,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud')),
    );
    const result = (await d.request(
      'gv.sync.download',
      { platform: 'aistudio', selection: 'site', snapshotRun: { snapshotId: id } },
      sender(),
    )) as Download;
    await applySite('aistudio', result);
    await expect(
      d.request(
        'gv.sync.completeDownload',
        { operationId: result.operationId, success: true },
        sender(),
      ),
    ).resolves.toEqual({ ok: true, recorded: true });
    const { undoCloudSyncSnapshot } = await import('@/core/services/CloudSyncSnapshotService');
    expect(await undoCloudSyncSnapshot(id)).toMatchObject({
      status: 'restored',
      kept: [{ kind: 'prompts' }],
    });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(edited);
    expect(d.values[StorageKeys.FOLDER_DATA_AISTUDIO]).toEqual(syncTestFolders('Before'));
  });

  it.each([null, {}, { snapshotId: '' }, { snapshotId: 1 }, 'resume'])(
    'rejects a malformed run request (%j) without reading Drive',
    async (snapshotRun) => {
      const d = await createScopeSyncDevice();
      await expect(d.request('gv.sync.download', { snapshotRun }, sender())).resolves.toEqual({
        ok: false,
        error: 'invalid_sync_request',
      });
      await expect(
        d.request('gv.sync.pullPromptsMerge', { snapshotRun }, sender()),
      ).resolves.toEqual({ ok: false, error: 'invalid_sync_request' });
      expect(d.requests).toEqual([]);
    },
  );

  it('undoes shared prompts and two site rows together without replacing the first snapshot', async () => {
    const d = await createScopeSyncDevice();
    d.drive.put(SYNC_TEST_PROMPTS_FILE, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('cloud')],
    });
    const original = [syncTestPrompt('local')];
    for (const platform of ['gemini', 'aistudio'] as const) {
      d.values[FOLDER_PLATFORMS[platform].folderStorageKey] = syncTestFolders(`old-${platform}`);
      d.drive.put(
        FOLDER_PLATFORMS[platform].driveFoldersFileName,
        syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders(`cloud-${platform}`)),
      );
    }
    const id = snapshotId(
      await d.request('gv.sync.pullPromptsMerge', { snapshotRun: 'start' }, sender()),
    );
    for (const platform of ['gemini', 'aistudio'] as const) {
      const result = (await d.request(
        'gv.sync.download',
        { platform, selection: 'site', snapshotRun: { snapshotId: id } },
        sender(),
      )) as Download;
      expect(snapshotId(result)).toBe(id);
      await applySite(platform, result);
      await expect(
        d.request(
          'gv.sync.completeDownload',
          { operationId: result.operationId, success: true },
          sender(),
        ),
      ).resolves.toMatchObject({ ok: true, recorded: true });
    }
    const { undoCloudSyncSnapshot } = await import('@/core/services/CloudSyncSnapshotService');
    expect(await undoCloudSyncSnapshot(id)).toMatchObject({
      status: 'restored',
      snapshotId: id,
      kept: [],
    });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(original);
    for (const platform of ['gemini', 'aistudio'] as const)
      expect(d.values[FOLDER_PLATFORMS[platform].folderStorageKey]).toEqual(
        syncTestFolders(`old-${platform}`),
      );
  });

  it.each(['missing', 'duplicates'] as const)(
    'keeps a no-op %s prompts row as a joinable first row',
    async (kind) => {
      const d = await createScopeSyncDevice();
      if (kind === 'duplicates')
        d.drive.put(SYNC_TEST_PROMPTS_FILE, {
          format: 'gemini-voyager.prompts.v1',
          items: [syncTestPrompt('local')],
        });
      const id = snapshotId(
        await d.request('gv.sync.pullPromptsMerge', { snapshotRun: 'start' }, sender()),
      );
      expect(
        snapshotId(
          await d.request(
            'gv.sync.download',
            { platform: 'aistudio', selection: 'site', snapshotRun: { snapshotId: id } },
            sender(),
          ),
        ),
      ).toBe(id);
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([syncTestPrompt('local')]);
    },
  );

  it.each(['gv.sync.download', 'gv.sync.pullPromptsMerge'])(
    'rejects a superseded continuation of %s before Drive reads',
    async (type) => {
      const d = await createScopeSyncDevice();
      const id = snapshotId(
        await d.request(
          'gv.sync.download',
          { selection: 'shared', snapshotRun: 'start' },
          sender(),
        ),
      );
      const next = snapshotId(
        await d.request(
          'gv.sync.download',
          { selection: 'shared', snapshotRun: 'start' },
          sender('another-popup'),
        ),
      );
      const calls = d.requests.length;
      const before = structuredClone(d.values);
      await expect(d.request(type, { snapshotRun: { snapshotId: id } }, sender())).resolves.toEqual(
        { ok: false, error: 'snapshot_superseded' },
      );
      expect(d.requests).toHaveLength(calls);
      expect(d.values).toEqual(before);
      expect(next).not.toBe(id);
    },
  );

  it('does not let another popup document join a current run', async () => {
    const d = await createScopeSyncDevice();
    const id = snapshotId(
      await d.request('gv.sync.download', { selection: 'shared', snapshotRun: 'start' }, sender()),
    );
    const calls = d.requests.length;
    await expect(
      d.request(
        'gv.sync.pullPromptsMerge',
        { snapshotRun: { snapshotId: id } },
        sender('other-document'),
      ),
    ).resolves.toEqual({ ok: false, error: 'snapshot_superseded' });
    expect(d.requests).toHaveLength(calls);
  });

  it.each(['gv.sync.download', 'gv.sync.pullPromptsMerge'])(
    'revalidates %s after Drive reads before an old run can apply or replace a newer snapshot',
    async (type) => {
      const d = await createScopeSyncDevice();
      const first = (await d.request(
        'gv.sync.download',
        { selection: 'shared', snapshotRun: 'start' },
        sender(),
      )) as Download;
      const id = snapshotId(first);
      await d.request(
        'gv.sync.completeDownload',
        { operationId: first.operationId, success: false },
        sender(),
      );
      d.drive.put(SYNC_TEST_PROMPTS_FILE, {
        format: 'gemini-voyager.prompts.v1',
        items: [syncTestPrompt('cloud')],
      });
      let newerId: string | undefined;
      d.drive.beforeRead = async (name) => {
        if (name !== SYNC_TEST_PROMPTS_FILE || newerId) return;
        const { captureCloudSyncSnapshot } =
          await import('@/core/services/CloudSyncSnapshotService');
        newerId = (
          await captureCloudSyncSnapshot({
            context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
            keys: [],
          })
        ).id;
      };
      const local = structuredClone(d.values[StorageKeys.PROMPT_ITEMS]);
      await expect(
        d.request(type, { selection: 'shared', snapshotRun: { snapshotId: id } }, sender()),
      ).resolves.toEqual({ ok: false, error: 'snapshot_superseded' });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(local);
      const { readCloudSyncSnapshot } = await import('@/core/services/CloudSyncSnapshotService');
      expect((await readCloudSyncSnapshot())?.id).toBe(newerId);
    },
  );
});
