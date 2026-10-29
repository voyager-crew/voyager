import { afterEach, expect, it, vi } from 'vitest';

import type { SyncAccountScope } from '@/core/types/sync';
import { buildLegacyConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { GoogleDriveSyncPayloads } from '../GoogleDriveSyncPayloads';
import { StarDriveSyncCoordinator } from '../StarDriveSyncCoordinator';

const source: SyncAccountScope = { accountKey: 'same-person', accountId: 2, routeUserId: '0' };
const destination = { ...source, routeUserId: '2' };
const remoteStar: StarredMessage = {
  conversationId: 'gemini:conv:abc',
  turnId: 's-1111111111111111',
  starredAt: 50,
  conversationUrl: 'https://gemini.google.com/u/0/app/abc?hl=en#turn',
  content: 'Prompt',
  text: 'Full\nprompt',
};
const localStar = {
  ...remoteStar,
  conversationUrl: remoteStar.conversationUrl.replace('/u/0/', '/u/2/'),
};
const backup = (items = [remoteStar]) =>
  buildStarsV2(
    { data: { messages: { [remoteStar.conversationId]: items } }, tombstones: [] },
    source,
    'test',
  );
function fixture() {
  const values: Record<string, unknown> = {};
  const store = createStarStore({
    get: async () => structuredClone(values),
    set: async (items) => {
      Object.assign(values, structuredClone(items));
    },
  });
  const remote = new Map<string, unknown>();
  const writes: string[] = [];
  const payloads = new GoogleDriveSyncPayloads({
    ensure: async (_token, name) => name,
    find: async (_token, name) => (remote.has(name) ? name : null),
    upload: async (_token, name, payload) => {
      writes.push(name);
      remote.set(name, structuredClone(payload));
    },
    download: async <T>(_token: string, name: string): Promise<T | null> =>
      (remote.get(name) as T) ?? null,
    prepareDownload: async () => {},
  });
  return { store, remote, writes, payloads };
}
afterEach(() => vi.restoreAllMocks());

it('a backup from the same account on another /u/ slot restores its stars', async () => {
  const { store } = fixture();
  const noSlot = {
    ...remoteStar,
    turnId: 's-no-slot',
    conversationUrl: 'https://gemini.google.com/app/abc',
  };
  await store.mergeSync({ v2: backup([remoteStar, noSlot]) }, destination);
  expect((await store.getAll()).messages[remoteStar.conversationId]).toEqual([localStar, noSlot]);
});

it('a deletion from the same account on another /u/ slot removes the local star', async () => {
  const { store } = fixture();
  const now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  await store.add(localStar);
  const payload = {
    ...backup([]),
    tombstones: [
      {
        conversationId: remoteStar.conversationId,
        turnId: remoteStar.turnId,
        conversationUrl: remoteStar.conversationUrl,
        starredAt: 50,
        deletedAt: now,
      },
    ],
  };
  await store.mergeSync({ v2: payload }, destination);
  expect(await store.getAll()).toEqual({ messages: {} });
  expect((await store.getSyncSnapshot(destination)).tombstones).toEqual([
    { ...payload.tombstones[0], conversationUrl: localStar.conversationUrl },
  ]);
});

it('a following push does not empty a same-account backup from another /u/ slot', async () => {
  const { store, remote, payloads, writes } = fixture();
  await payloads.writeStars('token', backup(), source, true);
  const { text: _text, ...preview } = remoteStar;
  await payloads.writeStars(
    'token',
    {
      format: 'gemini-voyager.starred.v1',
      data: { messages: { [preview.conversationId]: [preview] } },
    },
    source,
    false,
  );
  const initial = await payloads.readStars('token', destination);
  await store.mergeSync(initial, destination);
  writes.length = 0;
  const commit = await new StarDriveSyncCoordinator().prepare(store, [
    {
      port: {
        assertActive: () => {},
        read: () => payloads.readStars('token', destination),
        writeV2: (payload) => payloads.writeStars('token', payload, destination, true),
        writeV1: (payload) => payloads.writeStars('token', payload, destination, false),
      },
      scope: destination,
    },
  ]);
  await commit();
  const restored = await payloads.readStars('token', destination);
  expect(restored.v2).toMatchObject({ items: [localStar] });
  expect(restored.v1).toMatchObject({
    data: {
      messages: {
        [preview.conversationId]: [{ ...preview, conversationUrl: localStar.conversationUrl }],
      },
    },
  });
  expect(writes).toHaveLength(2);
  expect(remote.size).toBe(2);
});

it('restoring a same-account star repairs its cached navigation slot without changing its identity', async () => {
  const { store } = fixture();
  await store.add(remoteStar);
  await store.mergeSync({ v2: backup() }, destination);
  expect((await store.getAll()).messages[remoteStar.conversationId]).toEqual([localStar]);
});

it('a newer legacy re-star survives a canonical deletion import and the following push', async () => {
  const { store, payloads } = fixture();
  const now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const newer = {
    ...remoteStar,
    conversationId: buildLegacyConversationIdFromUrl(remoteStar.conversationUrl),
    starredAt: 60,
  };
  await store.add(newer);
  const payload = {
    ...backup([]),
    tombstones: [
      {
        conversationId: remoteStar.conversationId,
        turnId: remoteStar.turnId,
        conversationUrl: remoteStar.conversationUrl,
        starredAt: 50,
        deletedAt: now,
      },
    ],
  };
  await payloads.writeStars('token', payload, source, true);
  const commit = await new StarDriveSyncCoordinator().prepare(store, [
    {
      port: {
        assertActive: () => {},
        read: () => payloads.readStars('token', destination),
        writeV2: (value) => payloads.writeStars('token', value, destination, true),
        writeV1: (value) => payloads.writeStars('token', value, destination, false),
      },
      scope: destination,
    },
  ]);
  await commit();
  const expected = { ...newer, conversationUrl: localStar.conversationUrl };
  expect((await store.getSyncSnapshot(destination)).data.messages[newer.conversationId]).toEqual([
    expected,
  ]);
  expect((await payloads.readStars('token', destination)).v2).toMatchObject({ items: [expected] });
});

it('a newer legacy deletion keeps both aliases when its backup uses the canonical id', async () => {
  const { store } = fixture();
  const now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now + 100);
  const legacy = {
    ...remoteStar,
    conversationId: buildLegacyConversationIdFromUrl(remoteStar.conversationUrl),
  };
  await store.add(legacy);
  await store.remove(legacy.conversationId, legacy.turnId);
  await store.mergeSync(
    {
      v2: {
        ...backup([]),
        tombstones: [
          {
            conversationId: remoteStar.conversationId,
            turnId: remoteStar.turnId,
            conversationUrl: remoteStar.conversationUrl,
            starredAt: 50,
            deletedAt: now,
          },
        ],
      },
    },
    destination,
  );
  const snapshot = await store.getSyncSnapshot(destination);
  expect(snapshot.tombstones.map((item) => item.conversationId)).toEqual([
    legacy.conversationId,
    remoteStar.conversationId,
  ]);
  expect(
    snapshot.tombstones.every(
      (item) => item.conversationUrl === localStar.conversationUrl && item.deletedAt === now + 100,
    ),
  ).toBe(true);
});

it.each(['live', 'deleted'] as const)(
  'a newer re-star from an old version on another /u/ slot survives the v2 merge (%s)',
  async (mode) => {
    const { store, payloads, writes } = fixture();
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await payloads.writeStars(
      'token',
      {
        ...backup(mode === 'live' ? [remoteStar] : []),
        tombstones:
          mode === 'deleted'
            ? [
                {
                  conversationId: remoteStar.conversationId,
                  turnId: remoteStar.turnId,
                  conversationUrl: remoteStar.conversationUrl,
                  starredAt: 50,
                  deletedAt: now,
                },
              ]
            : [],
      },
      source,
      true,
    );
    const { text: _text, ...preview } = remoteStar;
    await payloads.writeStars(
      'token',
      {
        format: 'gemini-voyager.starred.v1',
        data: { messages: { [preview.conversationId]: [{ ...preview, starredAt: 60 }] } },
      },
      source,
      false,
    );
    await store.mergeSync(await payloads.readStars('token', destination), destination);
    const expected = {
      ...preview,
      conversationUrl: localStar.conversationUrl,
      starredAt: 60,
      ...(mode === 'live' ? { text: remoteStar.text } : {}),
    };
    expect((await store.getAll()).messages[remoteStar.conversationId]).toEqual([expected]);
    writes.length = 0;
    const commit = await new StarDriveSyncCoordinator().prepare(store, [
      {
        port: {
          assertActive: () => {},
          read: () => payloads.readStars('token', destination),
          writeV2: (value) => payloads.writeStars('token', value, destination, true),
          writeV1: (value) => payloads.writeStars('token', value, destination, false),
        },
        scope: destination,
      },
    ]);
    await commit();
    const after = await payloads.readStars('token', destination);
    expect(after.v2).toMatchObject({ items: [expected] });
    expect(after.v1).toMatchObject({
      data: {
        messages: {
          [preview.conversationId]: [
            { ...preview, starredAt: 60, conversationUrl: localStar.conversationUrl },
          ],
        },
      },
    });
    expect(writes).toHaveLength(2);
  },
);
