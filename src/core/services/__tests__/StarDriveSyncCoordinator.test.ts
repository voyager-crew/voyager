import { afterEach, expect, it, vi } from 'vitest';

import type { SyncAccountScope } from '@/core/types/sync';
import { buildLegacyConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { SafariICloudSyncError } from '@/core/utils/safariICloudSync';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { buildStarsV2, type StarsExportPayloadV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { StarDriveSyncCoordinator, type StarTransferPort } from '../StarDriveSyncCoordinator';

const scope: SyncAccountScope = { accountKey: 'person', accountId: 2, routeUserId: '2' };
const item: StarredMessage = {
  conversationId: 'gemini:conv:abc',
  conversationUrl: 'https://gemini.google.com/u/2/app/abc',
  turnId: 's-one',
  content: 'prompt',
  text: 'prompt\nfull text',
  starredAt: 50,
};
const v1 = (items = [item]) => ({
  format: 'gemini-voyager.starred.v1',
  data: { messages: { [item.conversationId]: items.map(({ text: _text, ...record }) => record) } },
});
const v2 = (items = [item], tombstones: StarsExportPayloadV2['tombstones'] = []) =>
  buildStarsV2({ data: { messages: { [item.conversationId]: items } }, tombstones }, scope, 'test');
const deletion = {
  conversationId: item.conversationId,
  conversationUrl: item.conversationUrl,
  turnId: item.turnId,
  starredAt: 50,
  deletedAt: 1_800_000_000_000,
};

function local() {
  const values: Record<string, unknown> = {};
  const area = {
    get: async () => structuredClone(values),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { store: createStarStore(area), area, values };
}
function remote() {
  const files: { v1: unknown; v2: unknown } = { v1: null, v2: null };
  const port = {
    identity: 'drive:person',
    assertActive: vi.fn(),
    read: vi.fn(async () => structuredClone(files)),
    writeV2: vi.fn(async (payload) => {
      files.v2 = structuredClone(payload);
    }),
    writeV1: vi.fn(async (payload: unknown) => {
      files.v1 = structuredClone(payload);
    }),
  } satisfies StarTransferPort;
  return { files, port };
}
const push = (store: ReturnType<typeof local>['store'], port: StarTransferPort) =>
  new StarDriveSyncCoordinator().push(store, port, scope);
afterEach(() => vi.restoreAllMocks());

it('an empty v2 backup seeds from v1 without losing local stars', async () => {
  const { store } = local();
  const { files, port } = remote();
  await store.add({ ...item, turnId: 'local' });
  files.v1 = v1();
  files.v2 = v2([]);
  await push(store, port);
  expect((files.v2 as StarsExportPayloadV2).items.map((record) => record.turnId).sort()).toEqual([
    'local',
    's-one',
  ]);
  expect(
    (files.v2 as StarsExportPayloadV2).items.find((record) => record.turnId === 'local')?.text,
  ).toBe(item.text);
});

it('a failed cloud read never overwrites the backup', async () => {
  const { store, area } = local();
  const { port } = remote();
  vi.mocked(port.read).mockRejectedValue(new Error('offline'));
  await expect(push(store, port)).rejects.toThrow('offline');
  expect(port.writeV2).not.toHaveBeenCalled();
  expect(port.writeV1).not.toHaveBeenCalled();
  expect(area.set).not.toHaveBeenCalled();
});

it.each(['scope', 'item', 'deletion', 'v1'])(
  'a malformed %s backup stops before upload or local mutation',
  async (kind) => {
    const { store, area } = local();
    const { files, port } = remote();
    files.v2 =
      kind === 'scope'
        ? { ...v2(), accountScope: { accountHash: 'other' } }
        : kind === 'item'
          ? { ...v2(), items: [{ ...item, starredAt: 'bad' }] }
          : kind === 'deletion'
            ? { ...v2(), tombstones: [{ ...deletion, deletedAt: null }] }
            : v2();
    if (kind === 'v1') files.v1 = { format: 'gemini-voyager.starred.v1', data: null };
    await expect(push(store, port)).rejects.toThrow();
    expect(port.writeV2).not.toHaveBeenCalled();
    expect(area.set).not.toHaveBeenCalled();
  },
);

it('a tombstone-only upload clears the unchanged full v1 projection', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(deletion.deletedAt);
  const { store } = local();
  const { files, port } = remote();
  await store.add(item);
  await store.remove(item.conversationId, item.turnId);
  files.v1 = v1();
  await push(store, port);
  expect(files.v2).toMatchObject({ items: [], tombstones: [deletion] });
  expect(files.v1).toMatchObject({ format: 'gemini-voyager.starred.v1', data: { messages: {} } });
  expect(JSON.stringify(files.v2)).not.toContain(item.text!);
});

it('the v1 projection keeps its original preview and omits full text forever', async () => {
  const { store } = local();
  const { files, port } = remote();
  const long = { ...item, content: 'x'.repeat(70) };
  await store.mergeCloud({ data: { messages: { [item.conversationId]: [long] } } });
  await push(store, port);
  expect(files.v1).toMatchObject({
    data: {
      messages: {
        [item.conversationId]: [
          expect.objectContaining({ turnId: item.turnId, content: 'x'.repeat(60) + '...' }),
        ],
      },
    },
  });
  expect(JSON.stringify(files.v1)).not.toContain('full text');
  expect((files.v2 as StarsExportPayloadV2).items[0].text).toBe(item.text);
});

it('an iCloud conflict re-merges the remote deletion before retrying', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(deletion.deletedAt);
  const { store } = local();
  const { files, port } = remote();
  await store.add(item);
  vi.mocked(port.writeV2).mockImplementationOnce(async () => {
    files.v2 = v2([], [deletion]);
    throw new SafariICloudSyncError('conflict', 'icloud_conflict', null);
  });
  await push(store, port);
  expect(port.writeV2).toHaveBeenCalledTimes(2);
  expect(files.v2).toMatchObject({ items: [], tombstones: [deletion] });
  expect(await store.getAll()).toEqual({ messages: {} });
});

it.each(['add', 'delete'])(
  'a local %s during upload reaches both files before success',
  async (edit) => {
    const { store } = local();
    const { files, port } = remote();
    await store.add(item);
    vi.mocked(port.writeV2).mockImplementationOnce(async (payload) => {
      files.v2 = structuredClone(payload);
      if (edit === 'add') await store.add({ ...item, turnId: 'new', starredAt: 51 });
      else await store.remove(item.conversationId, item.turnId);
    });
    await push(store, port);
    expect(port.writeV2).toHaveBeenCalledTimes(2);
    expect((files.v2 as StarsExportPayloadV2).items.map((record) => record.turnId)).toEqual(
      edit === 'add' ? ['s-one', 'new'] : [],
    );
    expect(files.v1).toMatchObject({
      data:
        edit === 'add'
          ? { messages: { [item.conversationId]: expect.any(Array) } }
          : { messages: {} },
    });
  },
);

it('readback missing expected state causes a fresh merge and bounded retries', async () => {
  const { store } = local();
  const { files, port } = remote();
  await store.add(item);
  vi.mocked(port.writeV2).mockImplementation(async () => {
    files.v2 = v2([]);
  });
  await expect(push(store, port)).rejects.toThrow('after 3 merge attempts');
  expect(port.writeV2).toHaveBeenCalledTimes(3);
  expect(port.read).toHaveBeenCalledTimes(6);
  expect((await store.getAll()).messages[item.conversationId][0].text).toBe(item.text);
});

it('a v2 success followed by v1 failure is repaired on the next push', async () => {
  const { store } = local();
  const { files, port } = remote();
  await store.add(item);
  vi.mocked(port.writeV1).mockRejectedValueOnce(new Error('v1 failed'));
  await expect(push(store, port)).rejects.toThrow('v1 failed');
  expect(files.v2).toMatchObject({ items: [item] });
  expect(files.v1).toBeNull();
  await push(store, port);
  expect(files.v1).toMatchObject(v1());
});

it('a rejected local merge prevents cloud writes', async () => {
  const { store, area } = local();
  const { files, port } = remote();
  files.v1 = v1();
  area.set.mockRejectedValue(new Error('quota'));
  await expect(push(store, port)).rejects.toThrow('quota');
  expect(port.writeV2).not.toHaveBeenCalled();
});

it('a changed session during a read prevents retargeting or applying the read', async () => {
  const { store, area } = local();
  const { port } = remote();
  let active = true;
  port.assertActive.mockImplementation(() => {
    if (!active) throw new Error('session changed');
  });
  vi.mocked(port.read).mockImplementation(async () => {
    active = false;
    return { v1: v1(), v2: null };
  });
  await expect(push(store, port)).rejects.toThrow('session changed');
  expect(area.set).not.toHaveBeenCalled();
  expect(port.writeV2).not.toHaveBeenCalled();
});

it('concurrent pushes to one transfer scope are serialized', async () => {
  const { store } = local();
  const { port } = remote();
  const coordinator = new StarDriveSyncCoordinator();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(port.read).mockImplementationOnce(async () => {
    await held;
    return { v1: null, v2: null };
  });
  const first = coordinator.push(store, port, scope);
  const second = coordinator.push(store, port, scope);
  await Promise.resolve();
  await Promise.resolve();
  expect(port.read).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  expect(port.writeV2).toHaveBeenCalledTimes(2);
});

it('a later sync repairs a stale two-device overwrite without claiming atomic writes', async () => {
  const a = local();
  const b = local();
  const { files, port } = remote();
  await a.store.add(item);
  await push(a.store, port);
  const stale = structuredClone(files);
  await b.store.mergeSync(files, scope);
  await a.store.add({ ...item, turnId: 'second', starredAt: 51 });
  await push(a.store, port);
  Object.assign(files, stale);
  await push(a.store, port);
  await b.store.mergeSync(files, scope);
  expect(
    (await b.store.getAll()).messages[item.conversationId].map((record) => record.turnId),
  ).toEqual(['s-one', 'second']);
  expect(JSON.stringify(await b.store.getAll())).toContain('full text');
});

it('a deleted legacy alias uploads and verifies without duplicate canonical deletions', async () => {
  const { store } = local();
  const { files, port } = remote();
  const legacy = {
    ...item,
    conversationId: buildLegacyConversationIdFromUrl(item.conversationUrl),
  };
  await store.add(legacy);
  await store.remove(legacy.conversationId, legacy.turnId);
  await push(store, port);
  const uploaded = files.v2 as StarsExportPayloadV2;
  expect(uploaded.items).toEqual([]);
  expect(uploaded.tombstones.map((record) => record.conversationId)).toEqual([
    legacy.conversationId,
    item.conversationId,
  ]);
  expect(port.writeV2).toHaveBeenCalledTimes(1);
});
