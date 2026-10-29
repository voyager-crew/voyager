import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  createScopeSyncDevice,
  SYNC_TEST_EXTENSION,
  SYNC_TEST_FOLDER_FILE,
  SYNC_TEST_PROMPTS_FILE,
} from './cloudSyncScopeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['all', 'shared'])('content senders cannot select %s shared data', async (selection) => {
  const d = await createScopeSyncDevice();
  const before = structuredClone(d.values);
  await expect(
    d.request(
      'gv.sync.upload',
      { selection },
      { id: SYNC_TEST_EXTENSION, url: 'https://gemini.google.com/app/test' },
    ),
  ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
  expect(d.requests).toEqual([]);
  expect(d.values).toEqual(before);
});

it.each([
  {
    scope: { shared: false, sites: {} },
    file: SYNC_TEST_PROMPTS_FILE,
    excludedRows: [{ kind: 'shared' }],
  },
  {
    scope: { shared: true, sites: { gemini: false } },
    file: SYNC_TEST_FOLDER_FILE,
    excludedRows: [{ kind: 'site', siteId: 'gemini' }],
  },
])(
  'history restore respects scope for $file before contacting Drive',
  async ({ scope, file, excludedRows }) => {
    const d = await createScopeSyncDevice();
    d.values[StorageKeys.CLOUD_SYNC_SCOPE] = scope;
    const before = structuredClone(d.values);
    await expect(d.request('gv.sync.restorePreviousVersion', { files: [file] })).resolves.toEqual({
      ok: false,
      error: 'sync_scope_excluded',
      excludedRows,
    });
    expect(d.requests).toEqual([]);
    expect(d.values).toEqual(before);
  },
);
