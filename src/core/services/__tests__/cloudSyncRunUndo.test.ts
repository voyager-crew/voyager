import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createMemoryStorage, type MemoryStorage } from '@/tests/memoryStorage';

import { CloudSyncSnapshotService } from '../CloudSyncSnapshotService';
import type { SnapshotContext } from '../cloudSyncSnapshotTypes';

const first: SnapshotContext = {
  source: 'popup-restore',
  platform: 'gemini',
  accountScope: { accountKey: 'email:a', accountId: 0, routeUserId: '0' },
};
const second: SnapshotContext = {
  source: 'popup-restore',
  platform: 'aistudio',
  accountScope: { accountKey: 'email:b', accountId: 1, routeUserId: '1' },
};
const keyA = `${StorageKeys.FOLDER_DATA}:acct:a`;
const keyB = `${StorageKeys.FOLDER_DATA_AISTUDIO}:acct:b`;
let memory: MemoryStorage;
let service: CloudSyncSnapshotService;
beforeEach(() => {
  memory = createMemoryStorage();
  service = new CloudSyncSnapshotService(() => memory.api);
  memory.values.local.set(keyA, 'before A');
  memory.values.local.set(keyB, 'before B');
});
afterEach(() => vi.restoreAllMocks());

async function write(id: string, key: string, value: string) {
  await service.extend(id, [{ area: 'local', key }], {
    applied: [{ area: 'local', key, kind: 'folders', value }],
  });
  await memory.api.local.set({ [key]: value });
  await service.finish(id);
}

it('undoes two platforms and accounts from one run without losing the first row baseline', async () => {
  const run = await service.capture({
    context: first,
    keys: [{ area: 'local', key: keyA }],
    run: { owner: 'panel', operationId: 'row-a' },
  });
  await write(run.id, keyA, 'cloud A');
  await service.finishRunRow(run.id, 'row-a');
  await service.capture({
    context: second,
    keys: [{ area: 'local', key: keyB }],
    snapshotId: run.id,
    run: { owner: 'panel', operationId: 'row-b' },
  });
  await write(run.id, keyB, 'cloud B');
  await service.finishRunRow(run.id, 'row-b');
  expect(await service.undo(run.id)).toMatchObject({
    status: 'restored',
    restoredKeys: 2,
    kept: [],
  });
  expect(memory.values.local.get(keyA)).toBe('before A');
  expect(memory.values.local.get(keyB)).toBe('before B');
});

it('keeps a later edit per account while undoing another row', async () => {
  const run = await service.capture({
    context: first,
    keys: [{ area: 'local', key: keyA }],
    run: { owner: 'panel', operationId: 'row-a' },
  });
  await write(run.id, keyA, 'cloud A');
  await service.finishRunRow(run.id, 'row-a');
  await service.capture({
    context: second,
    keys: [{ area: 'local', key: keyB }],
    snapshotId: run.id,
    run: { owner: 'panel', operationId: 'row-b' },
  });
  await write(run.id, keyB, 'cloud B');
  await service.finishRunRow(run.id, 'row-b');
  memory.values.local.set(keyA, 'later user edit');
  expect(await service.undo(run.id)).toMatchObject({
    status: 'restored',
    restoredKeys: 1,
    kept: [
      {
        kind: 'folders',
        keys: [{ area: 'local', key: keyA, contexts: [first] }],
        reason: 'changed-since-download',
      },
    ],
  });
  expect(memory.values.local.get(keyA)).toBe('later user edit');
  expect(memory.values.local.get(keyB)).toBe('before B');
});

it('keeps an edit between rows even when a later row merges into that same physical key', async () => {
  const run = await service.capture({
    context: first,
    keys: [{ area: 'local', key: keyA }],
    run: { owner: 'panel', operationId: 'row-a' },
  });
  await write(run.id, keyA, 'cloud A');
  await service.finishRunRow(run.id, 'row-a');
  memory.values.local.set(keyA, 'cloud A + user edit');
  await service.capture({
    context: second,
    keys: [{ area: 'local', key: keyA }],
    snapshotId: run.id,
    run: { owner: 'panel', operationId: 'row-b' },
  });
  await write(run.id, keyA, 'cloud A + user edit + cloud B');
  await service.finishRunRow(run.id, 'row-b');
  expect(await service.undo(run.id)).toMatchObject({
    status: 'restored',
    restoredKeys: 0,
    kept: [{ kind: 'folders', reason: 'changed-since-download' }],
  });
  expect(memory.values.local.get(keyA)).toBe('cloud A + user edit + cloud B');
});

it('does not publish a late receipt into another row admitted by a different context', async () => {
  const run = await service.capture({
    context: first,
    keys: [{ area: 'local', key: keyA }],
    run: { owner: 'panel', operationId: 'row-a' },
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const get = memory.api.local.get;
  let held = false;
  vi.spyOn(memory.api.local, 'get').mockImplementation(async (keys: unknown) => {
    const names = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : [];
    const values = await get<Record<string, unknown>>(names);
    if (!held && names.includes(keyA)) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return values;
  });
  const recording = service.extend(run.id, [{ area: 'local', key: keyA }], {
    applied: [{ area: 'local', key: keyA, kind: 'folders', value: 'late A' }],
  });
  const rejected = expect(recording).rejects.toMatchObject({ code: 'snapshot_superseded' });
  await entered.promise;
  const other = new CloudSyncSnapshotService(() => memory.api);
  await other.finishRunRow(run.id, 'row-a');
  await other.capture({
    context: second,
    keys: [],
    snapshotId: run.id,
    run: { owner: 'panel', operationId: 'row-b' },
  });
  release.resolve();
  await rejected;
  expect((await service.read())?.run?.active?.operationId).toBe('row-b');
  expect(memory.values.local.get(keyA)).toBe('before A');
});
