import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createScopeSyncDevice } from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('omits another isolated site instead of resolving its account from the popup URL', async () => {
  const d = await createScopeSyncDevice();
  d.syncValues[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO] = true;
  const result = await d.request('gv.sync.getStatus', { rows: ['aistudio'] });
  expect(result).toEqual({ ok: true, rows: [] });
  expect(d.requests).toEqual([]);
  expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
});
