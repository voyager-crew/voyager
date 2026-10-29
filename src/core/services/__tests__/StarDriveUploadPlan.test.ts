import { afterEach, expect, it, vi } from 'vitest';

import type { SyncAccountScope } from '@/core/types/sync';
import {
  selectCatalogSiteStars,
  selectGeminiFileStars,
} from '@/features/savedLibrary/starSitePolicy';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { StarDriveSyncCoordinator, type StarTransferPort } from '../StarDriveSyncCoordinator';

const scope: SyncAccountScope = { accountKey: 'person', accountId: 2, routeUserId: '2' };
const item: StarredMessage = {
  conversationId: 'chatgpt:conv:abc',
  conversationUrl: 'https://chatgpt.com/c/abc',
  turnId: 'star',
  content: 'Saved text',
  starredAt: 50,
};

function local() {
  const values: Record<string, unknown> = {};
  let failNext = false;
  const area = {
    get: async () => {
      if (failNext) {
        failNext = false;
        throw new Error('storage unavailable');
      }
      return structuredClone(values);
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    },
  };
  return {
    store: createStarStore(area),
    values,
    failNextRead() {
      failNext = true;
    },
  };
}

function remote() {
  const files: { v1: unknown; v2: unknown } = { v1: null, v2: null };
  let failed = false;
  const port: StarTransferPort = {
    assertActive() {},
    read: async () => {
      if (failed) throw new Error('Drive unavailable');
      return structuredClone(files);
    },
    writeV2: async (payload) => {
      files.v2 = structuredClone(payload);
    },
    writeV1: async (payload) => {
      files.v1 = structuredClone(payload);
    },
  };
  return {
    files,
    port,
    failRead: () => {
      failed = true;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

it('a later star file read failure leaves every cloud file and the local library intact', async () => {
  const { store, values } = local();
  await store.add(item);
  const first = remote();
  first.files.v1 = { data: { messages: { [item.conversationId]: [item] } } };
  const second = remote();
  second.failRead();
  const before = structuredClone({ first: first.files, second: second.files, values });

  await expect(
    new StarDriveSyncCoordinator().prepare(store, [
      { port: first.port, scope: null },
      { port: second.port, scope: null },
    ]),
  ).rejects.toThrow('Drive unavailable');

  expect({ first: first.files, second: second.files, values }).toEqual(before);
});

it('a later local snapshot failure leaves every cloud file intact', async () => {
  const source = local();
  await source.store.add(item);
  const first = remote();
  const second = remote();
  // Storage becomes unavailable after cloud preflight, before any file can be written.
  const read = second.port.read;
  second.port.read = async () => {
    const value = await read();
    source.failNextRead();
    return value;
  };

  await expect(
    new StarDriveSyncCoordinator().prepare(source.store, [
      { port: first.port, scope: null },
      { port: second.port, scope: null },
    ]),
  ).rejects.toThrow('storage unavailable');

  expect(first.files).toEqual({ v1: null, v2: null });
  expect(second.files).toEqual({ v1: null, v2: null });
  expect((await source.store.getAll()).messages[item.conversationId]).toEqual([item]);
});

it('all sources merge before planning, so a catalog deletion reaches the Gemini legacy twin', async () => {
  const deletedAt = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(deletedAt);
  const { store } = local();
  const gemini = remote();
  const catalog = remote();
  const tombstone = { ...item, deletedAt };
  gemini.files.v1 = { data: { messages: { [item.conversationId]: [item] } } };
  catalog.files.v2 = buildStarsV2(
    { data: { messages: {} }, tombstones: [tombstone] },
    null,
    'test',
  );
  gemini.port.select = (state, held) => selectGeminiFileStars(state, scope, held);
  catalog.port.select = (state) => selectCatalogSiteStars(state, 'chatgpt');
  const before = structuredClone({ gemini: gemini.files, catalog: catalog.files });

  const commit = await new StarDriveSyncCoordinator().prepare(store, [
    { port: gemini.port, scope },
    { port: catalog.port, scope: null },
  ]);

  expect({ gemini: gemini.files, catalog: catalog.files }).toEqual(before);
  await commit();

  expect(gemini.files.v1).toHaveProperty('data.messages', {});
  expect(gemini.files.v2).toMatchObject({
    items: [],
    tombstones: [expect.objectContaining({ turnId: item.turnId, deletedAt })],
  });
  expect(catalog.files.v2).toMatchObject({
    items: [],
    tombstones: [expect.objectContaining({ turnId: item.turnId, deletedAt })],
  });
  expect(await store.getAll()).toEqual({ messages: {} });
});

it('a deletion during the catalog transfer also removes the previously verified Gemini copies', async () => {
  const deletedAt = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(deletedAt);
  const { store } = local();
  const gemini = remote();
  const catalog = remote();
  const state = { data: { messages: { [item.conversationId]: [item] } }, tombstones: [] };
  gemini.files.v1 = { data: state.data };
  gemini.files.v2 = buildStarsV2(state, scope, 'test');
  catalog.files.v2 = buildStarsV2(state, null, 'test');
  gemini.port.select = (local, held) => selectGeminiFileStars(local, scope, held);
  catalog.port.select = (local) => selectCatalogSiteStars(local, 'chatgpt');
  delete catalog.port.writeV1;
  catalog.port.writeV2 = async (payload) => {
    catalog.files.v2 = structuredClone(payload);
    await store.remove(item.conversationId, item.turnId);
  };

  const commit = await new StarDriveSyncCoordinator().prepare(store, [
    { port: gemini.port, scope },
    { port: catalog.port, scope: null },
  ]);
  await commit();

  expect(gemini.files.v1).toHaveProperty('data.messages', {});
  for (const files of [gemini.files, catalog.files]) {
    expect(files.v2).toMatchObject({
      items: [],
      tombstones: [expect.objectContaining({ turnId: item.turnId, deletedAt })],
    });
  }
  expect(await store.getAll()).toEqual({ messages: {} });
});

it('a successful plan writes the merged stars to every requested file', async () => {
  const { store } = local();
  await store.add(item);
  const first = remote();
  const second = remote();
  const cloud = { ...item, turnId: 'from-cloud', starredAt: 51 };
  second.files.v1 = { data: { messages: { [item.conversationId]: [cloud] } } };
  const commit = await new StarDriveSyncCoordinator().prepare(store, [
    { port: first.port, scope: null },
    { port: second.port, scope: null },
  ]);

  await commit();

  for (const { files } of [first, second]) {
    expect(files.v2).toMatchObject({ items: expect.arrayContaining([item, cloud]) });
    expect(files.v1).toMatchObject({
      data: { messages: { [item.conversationId]: expect.arrayContaining([item, cloud]) } },
    });
  }
  expect((await store.getAll()).messages[item.conversationId]).toEqual(
    expect.arrayContaining([item, cloud]),
  );
});
