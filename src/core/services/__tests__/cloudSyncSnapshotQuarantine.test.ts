import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { CloudSyncSnapshotService } from '../CloudSyncSnapshotService';
import { parseCloudSyncSnapshotSlot } from '../cloudSyncSnapshotTypes';

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: async () => undefined } },
}));

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const QUARANTINE = StorageKeys.CLOUD_SYNC_SNAPSHOT_QUARANTINE;
const KEY = StorageKeys.PROMPT_ITEMS;
const CONTEXT = { source: 'popup-restore', platform: 'gemini', accountScope: null } as const;
const CORRUPT = { unreadable: ['Keep until a replacement has finished'] };
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let service: CloudSyncSnapshotService;

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  service = new CloudSyncSnapshotService(() => memory.api);
  memory.values.local.set(SLOT, CORRUPT);
  memory.values.local.set(KEY, ['Original']);
});
afterEach(() => {
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

async function capture(applied = false) {
  const snapshot = await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
  if (applied) {
    await service.extend(snapshot.id, [{ area: 'local', key: KEY }], {
      applied: [{ area: 'local', key: KEY, kind: 'prompts', value: ['Downloaded'] }],
    });
    await memory.api.local.set({ [KEY]: ['Downloaded'] });
  }
  return snapshot;
}

it.each(['receipted', 'unreceipted', 'no targets'])(
  'releases quarantine only after the replacement capture finishes (%s)',
  async (kind) => {
    const snapshot =
      kind === 'no targets'
        ? await service.capture({ context: CONTEXT, keys: [] })
        : await capture(kind === 'receipted');
    expect(memory.values.local.get(QUARANTINE)).toEqual(CORRUPT);

    await service.finish(snapshot.id);

    expect(memory.values.local.has(QUARANTINE)).toBe(false);
    expect(memory.values.local.get(KEY)).toEqual(
      kind === 'receipted' ? ['Downloaded'] : ['Original'],
    );
    expect(parseCloudSyncSnapshotSlot(memory.values.local.get(SLOT))).not.toBeNull();
  },
);

it('keeps quarantine when finish cannot persist its result and releases it after a successful retry', async () => {
  const snapshot = await capture();
  const failure = vi
    .spyOn(memory.api.local, 'set')
    .mockRejectedValue(new Error('Finish unavailable'));

  await expect(service.finish(snapshot.id)).rejects.toThrow('Finish unavailable');
  expect(memory.values.local.get(QUARANTINE)).toEqual(CORRUPT);
  expect(memory.values.local.get(SLOT)).toEqual(snapshot);
  expect(memory.values.local.get(KEY)).toEqual(['Original']);
  failure.mockRestore();

  await service.finish(snapshot.id);
  expect(memory.values.local.has(QUARANTINE)).toBe(false);
});

it.each(['newer capture', 'newer quarantine'])(
  'does not reclaim a %s published while finish persists its result',
  async (change) => {
    const snapshot = await capture();
    const newer = { unreadable: ['A later failure'] };
    const set = memory.api.local.set.bind(memory.api.local);
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      await set(items);
      if (parseCloudSyncSnapshotSlot(items[SLOT])?.kind !== 'undone') return;
      if (change === 'newer quarantine') await set({ [QUARANTINE]: newer });
      else {
        await set({ [SLOT]: newer });
        const other = new CloudSyncSnapshotService(() => memory.api);
        await other.capture({ context: CONTEXT, keys: [{ area: 'local', key: KEY }] });
      }
    });

    await service.finish(snapshot.id);

    expect(memory.values.local.get(QUARANTINE)).toEqual(newer);
    expect(memory.values.local.get(KEY)).toEqual(['Original']);
    expect(parseCloudSyncSnapshotSlot(memory.values.local.get(SLOT))?.kind).toBe(
      change === 'newer capture' ? 'snapshot' : 'undone',
    );
  },
);

it('keeps a newer quarantine when an older capture tries to finish', async () => {
  const snapshot = await capture();
  const newer = { unreadable: ['A newer broken slot'] };
  memory.values.local.set(SLOT, newer);
  const next = await service.capture({ context: CONTEXT, keys: [] });

  await service.finish(snapshot.id);
  expect(memory.values.local.get(QUARANTINE)).toEqual(newer);
  expect(memory.values.local.get(SLOT)).toEqual(next);

  await service.finish(next.id);
  expect(memory.values.local.has(QUARANTINE)).toBe(false);
});

it('keeps successful apply and its Undo usable if quarantine removal fails, then retries on finish', async () => {
  const snapshot = await capture(true);
  const failure = vi
    .spyOn(memory.api.local, 'remove')
    .mockRejectedValue(new Error('Remove unavailable'));
  const before = memory.values.local.get(SLOT);

  await expect(service.finish(snapshot.id)).resolves.toBeUndefined();
  expect(memory.values.local.get(QUARANTINE)).toEqual(CORRUPT);
  expect(memory.values.local.get(SLOT)).toEqual(before);
  expect(memory.values.local.get(KEY)).toEqual(['Downloaded']);
  failure.mockRestore();

  await service.finish(snapshot.id);
  expect(memory.values.local.has(QUARANTINE)).toBe(false);
  expect(await service.undo(snapshot.id)).toMatchObject({ status: 'restored', restoredKeys: 1 });
  expect(memory.values.local.get(KEY)).toEqual(['Original']);
});
