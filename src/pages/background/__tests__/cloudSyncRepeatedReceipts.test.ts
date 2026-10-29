import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { createScopeSyncDevice } from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('records a completed multi-site star merge with several receipts of the same key', async () => {
  const d = await createScopeSyncDevice();
  const stars = ['chatgpt', 'claude'].map((site) => {
    const item: StarredMessage = {
      conversationId: `${site}:conv:one`,
      conversationUrl:
        site === 'chatgpt' ? 'https://chatgpt.com/c/one' : 'https://claude.ai/chat/one',
      turnId: 'turn',
      content: site,
      starredAt: 1,
    };
    const payload = buildStarsV2(
      { data: { messages: { [item.conversationId]: [item] } }, tombstones: [] },
      null,
      '2.2.1',
    );
    d.drive.put(`gemini-voyager-stars.site-${site}.json`, payload);
    return payload;
  });
  const download = (await d.request('gv.sync.download', { selection: 'all' })) as {
    ok: boolean;
    snapshotId: string;
    operationId: string;
  };
  expect(download.ok).toBe(true);
  const snapshot = await import('@/core/services/CloudSyncSnapshotService');
  const { STAR_RESTORE_KEYS } = await import('@/core/services/CloudSyncRestoreKeys');
  await snapshot.captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: STAR_RESTORE_KEYS,
    snapshotId: download.snapshotId,
  });
  for (const payload of stars)
    await d.stars.mergeSync({ v2: payload, snapshotId: download.snapshotId }, null);
  await snapshot.finishCloudSyncSnapshot(download.snapshotId);
  expect(Object.keys((await d.stars.getAll()).messages)).toEqual([
    'chatgpt:conv:one',
    'claude:conv:one',
  ]);
  expect(
    (await snapshot.readCloudSyncSnapshot())?.appliedHashes.filter(
      (entry) => entry.key === StorageKeys.SAVED_LIBRARY_STARS,
    ),
  ).toHaveLength(2);
  await expect(
    d.request('gv.sync.completeDownload', { operationId: download.operationId, success: true }),
  ).resolves.toEqual({ ok: true, recorded: true });
  const { readSyncBookkeeping } = await import('@/core/services/CloudSyncBookkeeping');
  expect(
    Object.values(await readSyncBookkeeping())
      .map((file) => file.name)
      .sort(),
  ).toEqual(['gemini-voyager-stars.site-chatgpt.json', 'gemini-voyager-stars.site-claude.json']);
});
