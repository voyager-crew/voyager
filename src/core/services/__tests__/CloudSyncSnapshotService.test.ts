import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  type CloudSyncKind,
  CloudSyncSnapshotService,
  type SnapshotContext,
  type SnapshotStorage,
} from '../CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '../CloudSyncUndoMarkers';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const CONTEXT: SnapshotContext = {
  source: 'popup-restore',
  platform: 'gemini',
  accountScope: { accountKey: 'email:one', accountId: 0, routeUserId: '0' },
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setup(
  initial: {
    local?: Record<string, unknown>;
    sync?: Record<string, unknown>;
  } = {},
) {
  const stored = { local: copy(initial.local ?? {}), sync: copy(initial.sync ?? {}) };
  const failure = { snapshot: false, removal: false, syncWrite: false };
  const changes: Array<{ area: 'local' | 'sync'; key: string; value: unknown }> = [];
  const area = (name: 'local' | 'sync'): SnapshotStorage[typeof name] => ({
    async get(keys) {
      return copy(
        Object.fromEntries(
          keys.flatMap((key) =>
            Object.prototype.hasOwnProperty.call(stored[name], key)
              ? [[key, stored[name][key]]]
              : [],
          ),
        ),
      );
    },
    async set(values) {
      if (failure.snapshot && SLOT in values) throw new Error('snapshot quota exceeded');
      if (failure.syncWrite && name === 'sync') throw new Error('sync write failed');
      Object.assign(stored[name], copy(values));
      for (const [key, value] of Object.entries(values)) changes.push({ area: name, key, value });
    },
    async remove(keys) {
      if (failure.removal) throw new Error('remove failed');
      for (const key of keys) {
        delete stored[name][key];
        changes.push({ area: name, key, value: undefined });
      }
    },
  });
  const storage = { local: area('local'), sync: area('sync') };
  const service = new CloudSyncSnapshotService(() => storage);
  return {
    stored,
    storage,
    changes,
    failure,
    service,
    async apply(
      snapshotId: string,
      area: 'local' | 'sync',
      kind: CloudSyncKind,
      items: Record<string, unknown>,
    ) {
      const writes = Object.entries(items).map(([key, value]) => ({ area, key, kind, value }));
      const snapshot = await service.extend(snapshotId, writes, { applied: writes });
      await storage[area].set(items);
      return snapshot;
    },
  };
}

function withoutSlot(stored: Record<string, unknown>) {
  const { [SLOT]: _marker, ...data } = stored;
  return data;
}

function expectUndone(stored: Record<string, unknown>) {
  expect(stored[SLOT]).toMatchObject({ kind: 'undone', markers: expect.any(Array) });
  expect(stored[SLOT]).not.toHaveProperty('entries');
  expect(stored[SLOT]).not.toHaveProperty('appliedHashes');
  expect(stored[SLOT]).not.toHaveProperty('context');
}

function exposeMarkers(storage: SnapshotStorage) {
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys) =>
    storage.local.get(typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : []),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CloudSyncSnapshotService', () => {
  it('durably captures exact prior values and existence before the caller can apply', async () => {
    const initialLocal = {
      prompts: [{ id: 'old', text: 'keep', futureField: { value: null } }],
      folders: '{"folders":[],"folderContents":{}}',
      unrelated: 'keep',
    };
    const { service, stored, apply } = setup({
      local: initialLocal,
      sync: { enabled: false, value: null, unrelated: 'keep' },
    });
    const snapshot = await service.capture({
      context: CONTEXT,
      keys: [
        { area: 'local', key: 'prompts' },
        { area: 'local', key: 'folders' },
        { area: 'local', key: 'newHierarchy' },
        { area: 'sync', key: 'enabled' },
        { area: 'sync', key: 'value' },
        { area: 'local', key: 'prompts' },
      ],
    });

    expect(stored.local).toEqual({ ...initialLocal, [SLOT]: snapshot });
    expect(snapshot.context).toEqual(CONTEXT);
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.entries).toEqual([
      { area: 'local', key: 'prompts', existed: true, value: initialLocal.prompts },
      { area: 'local', key: 'folders', existed: true, value: initialLocal.folders },
      { area: 'local', key: 'newHierarchy', existed: false },
      { area: 'sync', key: 'enabled', existed: true, value: false },
      { area: 'sync', key: 'value', existed: true, value: null },
    ]);
    // An apply awaits capture; the durable slot already exists at its first write.
    await apply(snapshot.id, 'local', 'prompts', { prompts: [] });
    await apply(snapshot.id, 'local', 'hierarchy', { newHierarchy: { conversations: {} } });
    await apply(snapshot.id, 'sync', 'settings', { enabled: true, value: 1 });
    expect((await service.read())?.entries).toEqual(snapshot.entries);
    expect(stored.local.prompts).toEqual([]);
    expect(stored.sync.enabled).toBe(true);
  });

  it('leaves user data and an older usable slot untouched when persisting fails', async () => {
    const { service, stored, failure, storage } = setup({ local: { prompts: ['old'] } });
    const previous = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'prompts' }],
    });
    failure.snapshot = true;

    const apply = async () => {
      await service.capture({ context: CONTEXT, keys: [{ area: 'local', key: 'prompts' }] });
      await storage.local.set({ prompts: ['cloud'] });
    };
    await expect(apply()).rejects.toThrow('snapshot quota exceeded');
    expect(stored.local).toEqual({ prompts: ['old'], [SLOT]: previous });
    expect(stored.sync).toEqual({});
  });

  it('undo restores exact values, removes newly created keys and leaves only suppression hashes', async () => {
    const original = { prompts: ['old'], folders: 'legacy serialized folders', untouched: 7 };
    const { service, storage, stored, changes, apply } = setup({
      local: original,
      sync: { enabled: false, untouched: 'sync' },
    });
    const snapshot = await service.capture({
      context: CONTEXT,
      keys: [
        { area: 'local', key: 'prompts' },
        { area: 'local', key: 'folders' },
        { area: 'local', key: 'newKey' },
        { area: 'sync', key: 'enabled' },
        { area: 'sync', key: 'newKey' },
      ],
    });
    await apply(snapshot.id, 'local', 'prompts', { prompts: [] });
    await apply(snapshot.id, 'local', 'folders', { folders: {} });
    await apply(snapshot.id, 'local', 'forks', { newKey: 'new' });
    await apply(snapshot.id, 'sync', 'settings', { enabled: true, newKey: true });
    await storage.local.set({ untouched: 8 });
    changes.length = 0;

    expect(await service.undo()).toEqual({
      status: 'restored',
      snapshotId: snapshot.id,
      restoredKeys: 5,
      kept: [],
    });
    expect(withoutSlot(stored.local)).toEqual({ ...original, untouched: 8 });
    expectUndone(stored.local);
    expect(await service.read()).toBeNull();
    expect(stored.sync).toEqual({ enabled: false, untouched: 'sync' });
    expect(changes).toEqual(
      expect.arrayContaining([
        { area: 'local', key: 'prompts', value: ['old'] },
        { area: 'local', key: 'newKey', value: undefined },
        { area: 'sync', key: 'enabled', value: false },
        { area: 'sync', key: 'newKey', value: undefined },
      ]),
    );
    await storage.local.set({ prompts: ['a later edit'] });
    const writesBeforeSecondUndo = changes.length;
    expect(await service.undo()).toEqual({ status: 'absent' });
    expect(changes).toHaveLength(writesBeforeSecondUndo);
    expect(stored.local.prompts).toEqual(['a later edit']);
  });

  it('keeps only the latest download, so undo returns to its immediate prior state', async () => {
    const { service, stored, apply } = setup({ local: { prompts: ['first'] } });
    const first = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'prompts' }],
    });
    await apply(first.id, 'local', 'prompts', { prompts: ['second'] });
    const second = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'prompts' }],
    });
    await apply(second.id, 'local', 'prompts', { prompts: ['third'] });

    expect(second.id).not.toBe(first.id);
    await service.undo();
    expect(withoutSlot(stored.local)).toEqual({ prompts: ['second'] });
    expectUndone(stored.local);
  });

  it('adds background and caller keys to one slot without replacing the first captured value', async () => {
    const { service, stored, apply } = setup({
      local: { highlights: ['before'], prompts: ['old'] },
    });
    const beforeHighlights = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'highlights' }],
    });
    await apply(beforeHighlights.id, 'local', 'highlights', { highlights: ['downloaded'] });
    const extended = await service.capture({
      context: CONTEXT,
      snapshotId: beforeHighlights.id,
      keys: [
        { area: 'local', key: 'highlights' },
        { area: 'local', key: 'prompts' },
      ],
    });
    await apply(extended.id, 'local', 'prompts', { prompts: ['downloaded'] });
    const complete = await service.extend(extended.id, [{ area: 'sync', key: 'newSetting' }]);
    await apply(complete.id, 'sync', 'settings', { newSetting: true });

    expect(complete.id).toBe(beforeHighlights.id);
    expect(complete.timestamp).toBe(beforeHighlights.timestamp);
    expect(complete.entries).toEqual([
      { area: 'local', key: 'highlights', existed: true, value: ['before'] },
      { area: 'local', key: 'prompts', existed: true, value: ['old'] },
      { area: 'sync', key: 'newSetting', existed: false },
    ]);
    await service.undo();
    expect(withoutSlot(stored.local)).toEqual({ highlights: ['before'], prompts: ['old'] });
    expectUndone(stored.local);
    expect(stored.sync).toEqual({});
  });

  it('refuses a stale extension and an extension for a different account', async () => {
    const { service, stored } = setup({ local: { prompts: ['old'] } });
    const first = await service.capture({ context: CONTEXT, keys: [] });
    const latest = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'prompts' }],
    });

    await expect(service.extend(first.id, [{ area: 'local', key: 'extra' }])).rejects.toThrow(
      'no longer current',
    );
    await expect(
      service.capture({
        context: {
          ...CONTEXT,
          accountScope: { accountKey: 'email:two', accountId: 1, routeUserId: '1' },
        },
        snapshotId: latest.id,
        keys: [{ area: 'local', key: 'extra' }],
      }),
    ).rejects.toThrow('scope does not match');
    expect(stored.local).toEqual({ prompts: ['old'], [SLOT]: latest });
  });

  it.each([false, true])(
    'retries partial undo while preserving a later local edit: %s',
    async (edited) => {
      const { service, storage, stored, failure, apply } = setup({
        local: { prompts: ['old'] },
        sync: { enabled: false },
      });
      const snapshot = await service.capture({
        context: CONTEXT,
        keys: [
          { area: 'local', key: 'prompts' },
          { area: 'sync', key: 'enabled' },
        ],
      });
      await apply(snapshot.id, 'local', 'prompts', { prompts: ['cloud'] });
      const written = await apply(snapshot.id, 'sync', 'settings', { enabled: true });
      failure.syncWrite = true;

      expect(await service.undo()).toEqual({ status: 'failed', error: 'sync write failed' });
      expect(withoutSlot(stored.local)).toEqual({ prompts: ['old'] });
      expect(stored.local[SLOT]).toMatchObject({
        ...written,
        kind: 'undoing',
        markers: expect.any(Array),
      });
      expect(stored.sync).toEqual({ enabled: true });
      if (edited) await storage.local.set({ prompts: ['edit after partial undo'] });
      failure.syncWrite = false;
      expect(await service.undo()).toEqual({
        status: 'restored',
        snapshotId: snapshot.id,
        restoredKeys: edited ? 1 : 2,
        kept: edited
          ? [
              {
                kind: 'prompts',
                keys: [{ area: 'local', key: 'prompts' }],
                reason: 'changed-since-download',
              },
            ]
          : [],
      });
      expect(withoutSlot(stored.local)).toEqual({
        prompts: [edited ? 'edit after partial undo' : 'old'],
      });
      expectUndone(stored.local);
      expect(stored.sync).toEqual({ enabled: false });
    },
  );

  it('retains originals until absent keys are removed and the hash-only record is durable', async () => {
    const { service, stored, failure, apply } = setup();
    const snapshot = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'new' }],
    });
    const written = await apply(snapshot.id, 'local', 'forks', { new: 'cloud' });
    failure.removal = true;

    expect(await service.undo()).toEqual({ status: 'failed', error: 'remove failed' });
    expect(withoutSlot(stored.local)).toEqual({ new: 'cloud' });
    expect(stored.local[SLOT]).toMatchObject({
      ...written,
      kind: 'undoing',
      markers: expect.any(Array),
    });
    failure.removal = false;
    await service.undo();
    expect(withoutSlot(stored.local)).toEqual({});
    expectUndone(stored.local);
  });

  it('rejects a corrupt snapshot without modifying any user key or losing the slot', async () => {
    const corrupt = {
      id: 'bad',
      timestamp: 1,
      context: CONTEXT,
      entries: [{ area: 'session', key: 'prompt', existed: true, value: [] }],
    };
    const { service, stored } = setup({ local: { prompts: ['keep'], [SLOT]: corrupt } });

    expect(await service.undo()).toEqual({ status: 'failed', error: 'Invalid cloud snapshot' });
    expect(stored.local).toEqual({ prompts: ['keep'], [SLOT]: corrupt });
  });

  it('serializes repeated undo requests so only the first can restore data', async () => {
    const { service, stored, apply } = setup({ local: { prompts: ['old'] } });
    const snapshot = await service.capture({
      context: CONTEXT,
      keys: [{ area: 'local', key: 'prompts' }],
    });
    await apply(snapshot.id, 'local', 'prompts', { prompts: ['cloud'] });
    const [first, second] = await Promise.all([service.undo(), service.undo()]);

    expect(first.status).toBe('restored');
    expect(second.status).toBe('absent');
    expect(withoutSlot(stored.local)).toEqual({ prompts: ['old'] });
    expectUndone(stored.local);
  });

  it('keeps and reports a later edit without marking its content as undone', async () => {
    const before = { folders: [{ id: 'local', name: 'Before download' }], folderContents: {} };
    const applied = { folders: [{ id: 'cloud', name: 'From Drive' }], folderContents: {} };
    const later = { folders: [{ id: 'edited', name: 'Edited after apply' }], folderContents: {} };
    const key = StorageKeys.FOLDER_DATA;
    const h = setup({ local: { [key]: before } });
    exposeMarkers(h.storage);
    const keys = [{ area: 'local' as const, key }];
    const snapshot = await h.service.capture({ context: CONTEXT, keys });
    await h.apply(snapshot.id, 'local', 'folders', { [key]: applied });
    await h.storage.local.set({ [key]: later });

    expect(await h.service.undo()).toEqual({
      status: 'restored',
      snapshotId: snapshot.id,
      restoredKeys: 0,
      kept: [{ kind: 'folders', keys, reason: 'changed-since-download' }],
    });
    expect(h.stored.local[key]).toEqual(later);
    expectUndone(h.stored.local);
    expect(await h.service.read()).toBeNull();
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key, value: JSON.stringify(applied) }),
    ).toBe(false);
    expect(await isUndoneCloudSyncValue({ area: 'local', key, value: later })).toBe(false);
    expect(await isUndoneCloudSyncValue({ area: 'local', key, value: before })).toBe(false);
    expect(
      await isUndoneCloudSyncValue({ area: 'local', key: 'another account', value: applied }),
    ).toBe(false);
  });

  it.each(['digest', 'snapshot persistence'] as const)(
    'keeps a key edited during undo %s while restoring an unchanged sibling',
    async (phase) => {
      const key = StorageKeys.FOLDER_DATA;
      const prompts = StorageKeys.PROMPT_ITEMS;
      const h = setup({ local: { [key]: ['before'], [prompts]: ['before'] } });
      const keys = [
        { area: 'local' as const, key },
        { area: 'local' as const, key: prompts },
      ];
      const snapshot = await h.service.capture({ context: CONTEXT, keys });
      await h.apply(snapshot.id, 'local', 'folders', { [key]: ['downloaded'] });
      await h.apply(snapshot.id, 'local', 'prompts', { [prompts]: ['downloaded'] });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      if (phase === 'digest') {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
          entered.resolve();
          await release.promise;
          return digest(...args);
        });
      } else {
        const set = h.storage.local.set.bind(h.storage.local);
        vi.spyOn(h.storage.local, 'set').mockImplementationOnce(async (items) => {
          entered.resolve();
          await release.promise;
          await set(items);
        });
      }
      const undo = h.service.undo();
      await entered.promise;
      await h.storage.local.set({ [key]: ['later edit'] });
      release.resolve();

      expect(await undo).toEqual({
        status: 'restored',
        snapshotId: snapshot.id,
        restoredKeys: 1,
        kept: [
          { kind: 'folders', keys: [{ area: 'local', key }], reason: 'changed-since-download' },
        ],
      });
      expect(withoutSlot(h.stored.local)).toEqual({ [key]: ['later edit'], [prompts]: ['before'] });
      exposeMarkers(h.storage);
      expect(await isUndoneCloudSyncValue({ area: 'local', key, value: ['later edit'] })).toBe(
        false,
      );
      expect(await isUndoneCloudSyncValue({ area: 'local', key, value: ['downloaded'] })).toBe(
        false,
      );
      expect(
        await isUndoneCloudSyncValue({ area: 'local', key: prompts, value: ['downloaded'] }),
      ).toBe(true);
    },
  );

  it('keeps suppression through later edits and replacement downloads while undo remains single use', async () => {
    const key = StorageKeys.FOLDER_DATA;
    const applied = { folders: ['From Drive'], folderContents: {} };
    const h = setup();
    exposeMarkers(h.storage);
    const snapshot = await h.service.capture({ context: CONTEXT, keys: [{ area: 'local', key }] });
    await h.apply(snapshot.id, 'local', 'folders', { [key]: applied });
    expect((await h.service.undo()).status).toBe('restored');
    const markers = copy(h.stored.local[SLOT]);
    await h.storage.local.set({ unrelated: 'a new edit' });
    const writes = h.changes.length;

    expect(await h.service.undo()).toEqual({ status: 'absent' });
    expect(h.changes).toHaveLength(writes);
    expect(h.stored.local[SLOT]).toEqual(markers);
    expect(await isUndoneCloudSyncValue({ area: 'local', key, value: applied })).toBe(true);
    expect(withoutSlot(h.stored.local)).toEqual({ unrelated: 'a new edit' });
    await h.service.capture({ context: CONTEXT, keys: [{ area: 'local', key: 'unrelated' }] });
    expect(await isUndoneCloudSyncValue({ area: 'local', key, value: applied })).toBe(true);
    expect((await h.service.read())?.entries).toEqual([
      { area: 'local', key: 'unrelated', existed: true, value: 'a new edit' },
    ]);
  });
});
