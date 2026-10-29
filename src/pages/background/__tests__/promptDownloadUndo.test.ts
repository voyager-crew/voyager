import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/features/backup/types/backup';

import { createScopeSyncDevice, SYNC_TEST_PROMPTS_FILE } from './cloudSyncScopeHarness';

const KEY = StorageKeys.PROMPT_ITEMS;
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const local: PromptItem = {
  id: 'local',
  text: 'Local body',
  name: 'Review',
  tags: ['local'],
  createdAt: 1,
  updatedAt: 10,
  pinnedAt: 9,
};
const cloud: PromptItem = {
  id: 'cloud',
  text: 'Cloud body',
  name: 'Review',
  tags: [],
  createdAt: 1,
};

async function setup(existed = true) {
  const d = await createScopeSyncDevice();
  if (existed) d.values[KEY] = [structuredClone(local)];
  else delete d.values[KEY];
  const items = existed ? [{ ...local, id: 'duplicate', tags: ['cloud'] }, cloud] : [cloud];
  d.drive.put(SYNC_TEST_PROMPTS_FILE, { format: 'gemini-voyager.prompts.v1', items });
  return {
    ...d,
    snapshot: await import('@/core/services/CloudSyncSnapshotService'),
    owner: (await import('../promptLibraryOwner')).promptLibraryOwner,
    pull: () => d.request('gv.sync.pullPromptsMerge'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('prompts-only download undo through the real background owner', () => {
  it('keeps a successful pull and its undo target when bookkeeping cannot be stored', async () => {
    const d = await setup();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_BOOKKEEPING in items) throw new Error('bookkeeping quota');
      await set(items);
    });
    const result = await d.pull();
    expect(result).toMatchObject({
      ok: true,
      imported: 1,
      warning: 'sync_bookkeeping_failed',
      snapshotId: expect.any(String),
    });
    expect(result).not.toHaveProperty('error');
    expect(d.values[KEY]).toEqual([{ ...local, tags: ['local', 'cloud'] }, cloud]);
    expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(d.values[KEY]).toEqual([local]);
  });
  it.each([true, false])(
    'captures the library before the import writes it (existed: %s)',
    async (existed) => {
      const d = await setup(existed);
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      let protectedBeforeWrite = false;
      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        if (KEY in items) {
          const snapshot = parseCloudSyncSnapshotSlot(d.values[SLOT]);
          protectedBeforeWrite =
            snapshot?.kind === 'snapshot' &&
            snapshot.entries.some((entry) => entry.key === KEY) &&
            snapshot.appliedHashes.some((entry) => entry.key === KEY && entry.kind === 'prompts');
        }
        await set(items);
      });

      const result = await d.pull();
      expect(result).toMatchObject({
        ok: true,
        imported: 1,
        duplicates: existed ? 1 : 0,
        nameConflicts: existed ? 2 : 0,
      });
      expect(d.values[KEY]).toEqual(
        existed ? [{ ...local, tags: ['local', 'cloud'] }, cloud] : [cloud],
      );
      expect(protectedBeforeWrite).toBe(true);
      const snapshot = await d.snapshot.readCloudSyncSnapshot();
      expect(result).toMatchObject({ snapshotId: snapshot?.id });
      expect(snapshot?.entries).toEqual([
        existed
          ? { area: 'local', key: KEY, existed: true, value: [local] }
          : { area: 'local', key: KEY, existed: false },
      ]);
      expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({
        status: 'restored',
        restoredKeys: 1,
        kept: [],
      });
      expect(Object.hasOwn(d.values, KEY)).toBe(existed);
      expect(d.values[KEY]).toEqual(existed ? [local] : undefined);
    },
  );

  it('keeps a real later prompt edit when undo is requested', async () => {
    const d = await setup(false);
    await d.pull();
    await d.owner.apply({
      kind: 'update',
      id: cloud.id,
      changes: { text: 'Edited after pull', updatedAt: 30 },
    });

    expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'prompts', reason: 'changed-since-download' }],
    });
    expect(d.values[KEY]).toEqual([{ ...cloud, text: 'Edited after pull', updatedAt: 30 }]);
  });

  it('captures an earlier queued prompt edit so undo does not roll that edit back', async () => {
    const d = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementationOnce(async (items) => {
      entered.resolve();
      await release.promise;
      await set(items);
    });
    const edited = { ...local, tags: ['before-pull'] };
    const editing = d.owner.apply({ kind: 'update', id: local.id, changes: { tags: edited.tags } });
    await entered.promise;
    const mergeQueued = Promise.withResolvers<void>();
    const transact = d.owner.transact.bind(d.owner);
    vi.spyOn(d.owner, 'transact').mockImplementation((change, beforeWrite) => {
      mergeQueued.resolve();
      return transact(change, beforeWrite);
    });
    const pulling = d.pull();
    await mergeQueued.promise;
    release.resolve();
    await editing;
    expect(await pulling).toMatchObject({ ok: true });

    expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 1,
      kept: [],
    });
    expect(d.values[KEY]).toEqual([edited]);
  });

  it('leaves the library and older undo slot intact when capture exceeds quota', async () => {
    const d = await setup();
    const previous = await d.snapshot.captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: KEY }],
    });
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      if (SLOT in items) throw new Error('snapshot quota');
      await set(items);
    });

    expect(await d.pull()).toMatchObject({ ok: false, error: 'snapshot_failed' });
    expect(d.values[KEY]).toEqual([local]);
    expect(d.values[SLOT]).toEqual(previous);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });

  it('keeps the receipt failure and snapshot id when finish also fails', async () => {
    const d = await setup();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(
      async (items: Record<string, unknown>) => {
        const slot = parseCloudSyncSnapshotSlot(items[SLOT]);
        if (slot?.kind === 'snapshot' && slot.appliedHashes.length)
          throw new Error('receipt failed');
        if (slot?.kind === 'undone') throw new Error('cleanup failed');
        await set(items);
      },
    );

    const result = await d.pull();
    expect(result).toMatchObject({
      ok: false,
      error: 'snapshot_receipt_failed',
      snapshotId: expect.any(String),
    });
    expect(d.values[KEY]).toEqual([local]);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });

  it('does not report an unchanged library as a later edit after a canonical failure', async () => {
    const d = await setup();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    const fail = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      if (KEY in items) throw new Error('canonical failed');
      await set(items);
    });

    expect(await d.pull()).toMatchObject({
      ok: false,
      error: 'canonical failed',
      snapshotId: expect.any(String),
    });
    expect(d.values[KEY]).toEqual([local]);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
    fail.mockRestore();
    expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [],
    });
    expect(d.values[KEY]).toEqual([local]);
  });

  it.each(['scope refused', 'empty', 'duplicates only'] as const)(
    'preserves an older undo slot when no library write is needed: %s',
    async (kind) => {
      const d = await setup();
      const before = await d.snapshot.captureCloudSyncSnapshot({
        context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
        keys: [{ area: 'local', key: KEY }],
      });
      if (kind === 'scope refused')
        d.values[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: false, sites: {} };
      else
        d.drive.put(SYNC_TEST_PROMPTS_FILE, {
          format: 'gemini-voyager.prompts.v1',
          items: kind === 'empty' ? [] : [local],
        });

      expect(await d.pull()).toMatchObject(
        kind === 'scope refused' ? { ok: false, error: 'sync_scope_excluded' } : { ok: true },
      );
      expect(d.values[KEY]).toEqual([local]);
      expect(d.values[SLOT]).toEqual(before);
    },
  );
});
