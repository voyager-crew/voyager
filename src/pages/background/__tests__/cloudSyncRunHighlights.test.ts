import { afterEach, expect, it, vi } from 'vitest';

import { scopedDriveFileName } from '@/core/services/GoogleDriveIdentity';
import {
  getHighlightAccountHash,
  getHighlightBucketStorageKey,
} from '@/core/services/highlightAnnotationData';
import { StorageKeys } from '@/core/types/common';
import type { HighlightRecordV1 } from '@/core/types/highlight';

import {
  createScopeSyncDevice,
  SYNC_TEST_PROMPTS_FILE,
  syncTestPrompt,
} from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const account = { accountKey: 'email:highlight-run', accountId: 1, routeUserId: '1' };
const scope = { ...account, platform: 'gemini' as const };
const name = scopedDriveFileName('gemini-voyager-highlights.json', account.accountKey);
function cloudRecord(): HighlightRecordV1 {
  return {
    id: 'remote',
    schemaVersion: 1,
    platform: 'gemini',
    accountHash: getHighlightAccountHash(scope),
    conversationId: 'remote',
    conversationUrl: 'https://gemini.google.com/u/1/app/remote',
    turnId: 'turn',
    role: 'assistant',
    anchor: {
      quote: { exact: 'selected', prefix: '', suffix: '' },
      position: { start: 0, end: 8 },
      sourceTextHash: 'hash',
    },
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    revision: { counter: 1, deviceId: 'cloud-device' },
  };
}
function idOf(response: unknown): string {
  if (
    !response ||
    typeof response !== 'object' ||
    !('snapshotId' in response) ||
    typeof response.snapshotId !== 'string'
  )
    throw new Error('Expected snapshot');
  return response.snapshotId;
}
async function setup() {
  const d = await createScopeSyncDevice();
  d.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
  d.drive.put(SYNC_TEST_PROMPTS_FILE, {
    format: 'gemini-voyager.prompts.v1',
    items: [syncTestPrompt('cloud')],
  });
  d.drive.put(name, {
    format: 'gemini-voyager.annotations.v1',
    version: '2.2.1',
    exportedAt: '2026-10-29T00:00:00Z',
    accountScope: { platform: 'gemini', accountHash: getHighlightAccountHash(scope) },
    items: [cloudRecord()],
  });
  const snapshotId = idOf(await d.request('gv.sync.pullPromptsMerge', { snapshotRun: 'start' }));
  return { ...d, snapshotId, snapshot: await import('@/core/services/CloudSyncSnapshotService') };
}

it('adds background highlights to the prompts run so one undo restores both owners', async () => {
  const d = await setup();
  const result = await d.request('gv.sync.download', {
    selection: 'site',
    includeHighlights: true,
    highlightAccountScope: account,
    snapshotRun: { snapshotId: d.snapshotId },
  });
  expect(result).toMatchObject({
    ok: true,
    snapshotId: d.snapshotId,
    highlights: { synced: true },
  });
  expect(d.values[getHighlightBucketStorageKey(scope, 'remote')]).toBeDefined();
  expect(await d.snapshot.undoCloudSyncSnapshot(d.snapshotId)).toMatchObject({
    status: 'restored',
  });
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([syncTestPrompt('local')]);
  expect(d.values[getHighlightBucketStorageKey(scope, 'remote')]).toBeUndefined();
});

it('does not apply highlights when a newer snapshot appears during its last cloud read', async () => {
  const d = await setup();
  let newerId: string | undefined;
  d.drive.beforeRead = async (file) => {
    if (file !== name || newerId) return;
    newerId = (
      await d.snapshot.captureCloudSyncSnapshot({
        context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
        keys: [],
      })
    ).id;
  };
  const before = structuredClone(d.values[StorageKeys.PROMPT_ITEMS]);
  await expect(
    d.request('gv.sync.download', {
      selection: 'site',
      includeHighlights: true,
      highlightAccountScope: account,
      snapshotRun: { snapshotId: d.snapshotId },
    }),
  ).resolves.toEqual({ ok: false, error: 'snapshot_superseded' });
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(before);
  expect(d.values[getHighlightBucketStorageKey(scope, 'remote')]).toBeUndefined();
  expect((await d.snapshot.readCloudSyncSnapshot())?.id).toBe(newerId);
});
