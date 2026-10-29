import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';

import { cloudSyncFailureCode } from '../CloudSyncFailure';
import {
  captureCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '../CloudSyncSnapshotService';
import { registerCloudSyncUndoOwner } from '../CloudSyncUndoOwners';

function memoryStorage() {
  const stored: Record<string, unknown> = {};
  const area = {
    async get(keys: string | readonly string[]) {
      return structuredClone(
        Object.fromEntries(
          [keys]
            .flat()
            .filter((key) => key in stored)
            .map((key) => [key, stored[key]]),
        ),
      );
    },
    async set(items: Record<string, unknown>) {
      Object.assign(stored, structuredClone(items));
    },
    async remove(keys: string | readonly string[]) {
      for (const key of [keys].flat()) delete stored[key];
    },
  };
  vi.stubGlobal('chrome', { storage: { local: area, sync: area } });
  return { stored, area };
}

afterEach(() => vi.unstubAllGlobals());

it('undo keeps an edit queued after capture and before a prompt restore', async () => {
  const { stored, area } = memoryStorage();
  const owner = createPromptLibraryOwner({ area });
  const before = { id: 'before', text: 'before', tags: [], createdAt: 1 };
  const edit = { id: 'edit', text: 'another tab', tags: [], createdAt: 2 };
  const cloud = { id: 'cloud', text: 'cloud', tags: [], createdAt: 3 };
  await owner.apply({ kind: 'add', items: [before] });
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key: StorageKeys.PROMPT_ITEMS }],
  });
  await owner.apply({ kind: 'add', items: [edit] });
  await owner.apply({ kind: 'restore', mode: 'merge', items: [cloud], snapshotId: snapshot.id });
  expect(stored[StorageKeys.PROMPT_ITEMS]).toEqual([edit, before, cloud]);
  expect(await undoCloudSyncSnapshot()).toEqual({
    status: 'restored',
    snapshotId: snapshot.id,
    restoredKeys: 1,
    kept: [],
  });
  expect(await owner.read()).toEqual([edit, before]);
});

it('a later receipt keeps the original baseline from the first queued write', async () => {
  const { stored, area } = memoryStorage();
  const key = StorageKeys.PROMPT_ITEMS;
  stored[key] = ['before'];
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key }],
  });
  stored[key] = ['queued edit'];
  await recordCloudSyncWrites(snapshot.id, [
    { area: 'local', key, kind: 'prompts', value: ['first'] },
  ]);
  await area.set({ [key]: ['first'] });
  await recordCloudSyncWrites(snapshot.id, [
    { area: 'local', key, kind: 'prompts', value: ['second'] },
  ]);
  await area.set({ [key]: ['second'] });
  await undoCloudSyncSnapshot();
  expect(stored[key]).toEqual(['queued edit']);
});

it('an expected undo target cannot undo a newer download', async () => {
  const { stored, area } = memoryStorage();
  const key = StorageKeys.PROMPT_ITEMS;
  stored[key] = ['before'];
  const context = {
    source: 'popup-restore' as const,
    platform: 'gemini' as const,
    accountScope: null,
  };
  const first = await captureCloudSyncSnapshot({ context, keys: [{ area: 'local', key }] });
  const current = await captureCloudSyncSnapshot({ context, keys: [{ area: 'local', key }] });
  await recordCloudSyncWrites(current.id, [
    { area: 'local', key, kind: 'prompts', value: ['cloud'] },
  ]);
  await area.set({ [key]: ['cloud'] });
  const before = structuredClone(stored);
  expect(await undoCloudSyncSnapshot(first.id)).toEqual({
    status: 'superseded',
    snapshotId: first.id,
  });
  expect(stored).toEqual(before);
  expect(await undoCloudSyncSnapshot(current.id)).toEqual({
    status: 'restored',
    snapshotId: current.id,
    restoredKeys: 1,
    kept: [],
  });
  expect(stored[key]).toEqual(['before']);
});

it('a rejected receipt keeps its diagnostic and exposes the snapshot failure code', async () => {
  const { area } = memoryStorage();
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key: StorageKeys.PROMPT_ITEMS }],
  });
  const cause = new Error('quota exhausted');
  vi.spyOn(area, 'set').mockRejectedValue(cause);
  const error = await recordCloudSyncWrites(snapshot.id, [
    { area: 'local', key: StorageKeys.PROMPT_ITEMS, kind: 'prompts', value: [] },
  ]).catch((error: unknown) => error);
  expect(cloudSyncFailureCode(error)).toBe('snapshot_receipt_failed');
  expect(error).toMatchObject({ message: 'quota exhausted', cause });
});

it('a superseded receipt exposes its identity and leaves the new slot untouched', async () => {
  const { stored } = memoryStorage();
  const context = {
    source: 'popup-restore' as const,
    platform: 'gemini' as const,
    accountScope: null,
  };
  const old = await captureCloudSyncSnapshot({
    context,
    keys: [{ area: 'local', key: StorageKeys.PROMPT_ITEMS }],
  });
  await captureCloudSyncSnapshot({ context, keys: [] });
  const before = structuredClone(stored);
  const error = await recordCloudSyncWrites(old.id, [
    { area: 'local', key: StorageKeys.PROMPT_ITEMS, kind: 'prompts', value: [] },
  ]).catch((error: unknown) => error);
  expect(cloudSyncFailureCode(error)).toBe('snapshot_superseded');
  expect(error).toMatchObject({ message: 'Cloud snapshot is no longer current' });
  expect(stored).toEqual(before);
});

it('reports superseded when another download captures while undo waits for its owner', async () => {
  const { stored } = memoryStorage();
  const key = StorageKeys.PROMPT_ITEMS;
  const context = {
    source: 'popup-restore' as const,
    platform: 'gemini' as const,
    accountScope: null,
  };
  const old = await captureCloudSyncSnapshot({ context, keys: [{ area: 'local', key }] });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const unregister = registerCloudSyncUndoOwner(key, async (operation) => {
    entered.resolve();
    await release.promise;
    return operation();
  });
  try {
    const undo = undoCloudSyncSnapshot(old.id);
    await entered.promise;
    await captureCloudSyncSnapshot({ context, keys: [] });
    const newer = structuredClone(stored);
    release.resolve();
    expect(await undo).toEqual({ status: 'superseded', snapshotId: old.id });
    expect(stored).toEqual(newer);
  } finally {
    release.resolve();
    unregister();
  }
});
