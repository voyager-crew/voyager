import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createStarStore } from '../starStore';
import type { StarredMessage, StarredMessagesData } from '../starTypes';

const neutral = StorageKeys.SAVED_LIBRARY_STARS;
const legacy = StorageKeys.TIMELINE_STARRED_MESSAGES;
const tombstones = StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES;
const keys = [neutral, legacy, tombstones];
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => vi.restoreAllMocks());
const star = (turnId: string, starredAt = 1): StarredMessage => ({
  turnId,
  starredAt,
  conversationId: 'chat',
  conversationUrl: 'https://gemini.google.com/u/2/app/chat',
  content: `preview ${turnId}`,
});
const data = (...items: StarredMessage[]): StarredMessagesData => ({ messages: { chat: items } });

function setup(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  const area = {
    get: vi.fn(async (requested: string[]) =>
      Object.fromEntries(
        requested.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { values, area, store: createStarStore(area) };
}

function expectProjections(values: Record<string, unknown>, expected: StarredMessagesData) {
  expect(values[neutral]).toEqual(expected);
  expect(values[legacy]).toEqual(expected);
}

describe('Saved Library dual projections', () => {
  it('the first queued read migrates legacy stars once and later clean reads do not write', async () => {
    const expected = data(star('old'));
    const { store, values, area } = setup({ [legacy]: expected });
    await expect(Promise.all([store.getAll(), store.getForConversation('chat')])).resolves.toEqual([
      expected,
      expected.messages.chat,
    ]);
    expectProjections(values, expected);
    expect(area.set).toHaveBeenCalledTimes(1);
    expect(area.set).toHaveBeenCalledWith({
      [neutral]: expected,
      [legacy]: expected,
      [tombstones]: [],
    });
    expect(area.get).toHaveBeenCalledTimes(2);
    expect(area.get).toHaveBeenCalledWith(keys);
  });

  it('an unused store stays absent until a mutation writes both projections in one call', async () => {
    const { store, area, values } = setup();
    await expect(store.getAll()).resolves.toEqual({ messages: {} });
    expect(area.set).not.toHaveBeenCalled();
    await store.add(star('first'));
    expect(area.set).toHaveBeenCalledTimes(1);
    expectProjections(values, data(star('first')));
  });

  it('a mutation folds initial migration into its one dual write', async () => {
    const { store, area, values } = setup({ [legacy]: data(star('old')) });
    await store.add(star('new'));
    expect(area.set).toHaveBeenCalledTimes(1);
    expectProjections(values, data(star('old'), star('new')));
    area.set.mockClear();
    await expect(store.add(star('old', 9))).resolves.toBe(false);
    await expect(store.remove('chat', 'missing')).resolves.toBe(false);
    expect(area.set).not.toHaveBeenCalled();
  });

  it('unions both copies with neutral ties, newer legacy values and preserved metadata', async () => {
    const rich = {
      ...star('tie', 5),
      content: 'neutral',
      account: 'opaque',
      conversationTitle: 'Title',
    };
    const { store, values } = setup({
      [neutral]: data(rich, star('newer', 3), star('neutral-only')),
      [legacy]: data(
        { ...star('tie', 5), content: 'legacy' },
        { turnId: 'newer', starredAt: 9 } as StarredMessage,
        star('legacy-only'),
      ),
    });
    const expected = data(rich, { ...star('newer', 9) }, star('legacy-only'), star('neutral-only'));
    await expect(store.getAll()).resolves.toEqual(expected);
    expectProjections(values, expected);
  });

  it('imports downgrade additions even when neutral exists and revives accepted legacy-only deletions', async () => {
    const original = data(star('kept'));
    const { store, values } = setup({ [neutral]: original, [legacy]: original });
    values[legacy] = data(star('kept'), star('downgrade-added'));
    await expect(store.getAll()).resolves.toEqual(data(star('kept'), star('downgrade-added')));
    values[legacy] = data(star('downgrade-added'));
    await expect(store.getAll()).resolves.toEqual(data(star('downgrade-added'), star('kept')));
    expectProjections(values, data(star('downgrade-added'), star('kept')));
    await store.remove('chat', 'kept');
    expectProjections(values, data(star('downgrade-added')));
  });

  it('successful reconciliation removes source buckets through later reads and owner restart', async () => {
    const draft = { ...star('draft-turn'), conversationId: 'draft' };
    const { store, values, area } = setup({
      [neutral]: data(star('existing')),
      [legacy]: { messages: { draft: [draft] } },
    });
    const result = await store.reconcile('chat', ['draft'], star('existing').conversationUrl);
    const expected = data(star('existing'), { ...draft, conversationId: 'chat' });
    expect(result).toEqual(expected.messages.chat);
    expect(area.set).toHaveBeenCalledTimes(1);
    await expect(store.getAll()).resolves.toEqual(expected);
    await expect(createStarStore(area).getAll()).resolves.toEqual(expected);
    expectProjections(values, expected);
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it.each([neutral, legacy])(
    'a valid bucket beside corrupt data in %s remains readable and editable',
    async (brokenKey) => {
      const { store, values } = setup({
        [neutral]: data(star('safe')),
        [legacy]: data(star('safe')),
        [brokenKey]: { messages: { chat: [star('safe'), null, {}, 3], broken: null } },
      });
      await expect(store.getAll()).resolves.toEqual(data(star('safe')));
      await expect(store.add(star('new'))).resolves.toBe(true);
      expectProjections(values, data(star('safe'), star('new')));
    },
  );

  it('prototype-like conversation IDs survive cloud merge, add, reconciliation and removal', async () => {
    const { store, values, area } = setup();
    const cloudStar = { ...star('cloud'), conversationId: '__proto__' };
    const addedStar = { ...star('added'), conversationId: 'constructor' };
    await expect(
      store.mergeCloud(
        JSON.parse(JSON.stringify({ data: { messages: { ['__proto__']: [cloudStar] } } })),
      ),
    ).resolves.toEqual({ status: 'merged', count: 1 });
    await expect(store.add(addedStar)).resolves.toBe(true);
    await expect(store.getForConversation('__proto__')).resolves.toEqual([cloudStar]);
    await expect(store.getForConversation('constructor')).resolves.toEqual([addedStar]);
    const restarted = createStarStore(setup(values).area);
    await expect(restarted.getForConversation('__proto__')).resolves.toEqual([cloudStar]);
    await expect(restarted.getForConversation('constructor')).resolves.toEqual([addedStar]);
    await store.reconcile('constructor', ['__proto__']);
    await expect(store.getForConversation('__proto__')).resolves.toEqual([]);
    await expect(store.getForConversation('constructor')).resolves.toEqual([
      addedStar,
      { ...cloudStar, conversationId: 'constructor' },
    ]);
    await expect(store.remove('constructor', 'cloud')).resolves.toBe(true);
    await expect(store.remove('__proto__', 'missing')).resolves.toBe(false);
    expectProjections(values, { messages: { constructor: [addedStar] } });
    await store.mergeCloud({
      data: {
        messages: {
          ['__proto__']: [cloudStar],
          constructor: [{ ...cloudStar, conversationId: 'constructor' }],
        },
      },
    });
    await expect(createStarStore(area).getAll()).resolves.toEqual({
      messages: { constructor: [addedStar] },
    });
  });

  it('migration quota failure retains legacy bytes and a later queued read retries successfully', async () => {
    const expected = data(star('legacy'));
    const { store, area, values } = setup({ [legacy]: expected });
    area.set.mockRejectedValueOnce(new Error('quota'));
    await expect(store.getAll()).rejects.toThrow('quota');
    expect(values).toEqual({ [legacy]: expected });
    await expect(store.getAll()).resolves.toEqual(expected);
    expectProjections(values, expected);
  });

  it.each([neutral, legacy])(
    'a partial write to %s rejects removal and the next operation rereads both copies',
    async (writtenKey) => {
      const expected = data(star('kept'));
      const { store, area, values } = setup({ [neutral]: expected, [legacy]: expected });
      area.set.mockImplementationOnce(async (items) => {
        values[writtenKey] = structuredClone(items[writtenKey]);
        throw new Error('partial write');
      });
      await expect(store.remove('chat', 'kept')).rejects.toThrow('partial write');
      await expect(store.getAll()).resolves.toEqual(expected);
      expectProjections(values, expected);
      await expect(store.remove('chat', 'kept')).resolves.toBe(true);
      expectProjections(values, { messages: {} });
    },
  );
});

describe('Saved Library deletion persistence', () => {
  it('a removed star stays removed when a legacy or v1 copy arrives after owner restart', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const deleted = { ...star('deleted', 50), account: 'opaque-account' };
    const { store, area, values } = setup({ [legacy]: data(deleted) });
    await store.remove('chat', 'deleted');
    expect(values[tombstones]).toEqual([
      {
        conversationId: deleted.conversationId,
        turnId: deleted.turnId,
        conversationUrl: deleted.conversationUrl,
        starredAt: 50,
        deletedAt: NOW,
        account: 'opaque-account',
      },
    ]);
    values[legacy] = data(deleted);
    const restarted = createStarStore(area);
    await expect(restarted.getForConversation('chat')).resolves.toEqual([]);
    await restarted.mergeCloud({ format: 'gemini-voyager.starred.v1', data: data(deleted) });
    await expect(restarted.getAll()).resolves.toEqual({ messages: {} });
    expectProjections(values, { messages: {} });
  });

  it('a queued re-star survives a known clock rollback instead of staying deleted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const original = star('same', 500);
    const { store, area } = setup({ [legacy]: data(original) });
    await Promise.all([store.remove('chat', 'same'), store.add(star('same', 100))]);
    await expect(store.getForConversation('chat')).resolves.toEqual([star('same', 501)]);
    await store.mergeCloud({ data: data(original) });
    await expect(createStarStore(area).getForConversation('chat')).resolves.toEqual([
      star('same', 501),
    ]);
  });

  it('a valid deletion beside malformed local entries remains effective and editable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const deleted = star('deleted', 50);
    const valid = {
      conversationId: 'chat',
      turnId: 'deleted',
      conversationUrl: deleted.conversationUrl,
      starredAt: 50,
      deletedAt: NOW,
      account: 'opaque',
    };
    const { store, values } = setup({
      [legacy]: data(deleted, star('kept')),
      [tombstones]: [
        valid,
        null,
        {},
        { ...valid, turnId: 'bad', starredAt: NaN },
        { ...valid, turnId: 'bad-date', deletedAt: 'yesterday' },
      ],
    });
    await expect(store.getForConversation('chat')).resolves.toEqual([star('kept')]);
    await store.add(star('new'));
    expectProjections(values, data(star('kept'), star('new')));
    expect(values[tombstones]).toEqual([valid]);
  });

  it('deleting a turn in one conversation keeps the same turn in another conversation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const first = star('same', 50);
    const second = {
      ...first,
      conversationId: 'other',
      conversationUrl: 'https://gemini.google.com/u/3/app/other',
      account: 'other-account',
    };
    const expected = { messages: { other: [second] } };
    const { store, values } = setup({ [legacy]: { messages: { chat: [first], other: [second] } } });
    await store.remove('chat', 'same');
    await store.mergeCloud({ data: { messages: { chat: [first], other: [second] } } });
    await expect(store.getAll()).resolves.toEqual(expected);
    expectProjections(values, expected);
  });

  it('reconciling a deleted legacy conversation suppresses both source and canonical stale copies', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const source = {
      ...star('deleted', 50),
      conversationId: 'draft',
      conversationUrl: 'https://gemini.google.com/u/2/app/draft',
    };
    const targetUrl = star('deleted').conversationUrl;
    const target = { ...source, conversationId: 'chat', conversationUrl: targetUrl };
    const { store, area, values } = setup({ [legacy]: { messages: { draft: [source] } } });
    await store.remove('draft', 'deleted');
    await expect(store.reconcile('chat', ['draft'], targetUrl)).resolves.toEqual([]);
    expect(values[tombstones]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: 'draft', turnId: 'deleted', starredAt: 50 }),
        expect.objectContaining({
          conversationId: 'chat',
          turnId: 'deleted',
          conversationUrl: targetUrl,
          starredAt: 50,
        }),
      ]),
    );
    const restarted = createStarStore(area);
    await restarted.mergeCloud({ data: { messages: { draft: [source], chat: [target] } } });
    await expect(restarted.getAll()).resolves.toEqual({ messages: {} });
    await restarted.add({ ...target, starredAt: 10 });
    await expect(restarted.getForConversation('chat')).resolves.toEqual([
      { ...target, starredAt: 51 },
    ]);
  });

  it('a migrated live source cannot reappear from legacy storage while its canonical star stays live', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const source = {
      ...star('moved', 50),
      conversationId: 'draft',
      conversationUrl: 'https://gemini.google.com/u/2/app/draft',
    };
    const canonical = {
      ...source,
      conversationId: 'chat',
      conversationUrl: star('moved').conversationUrl,
    };
    const { store, area, values } = setup({ [legacy]: { messages: { draft: [source] } } });
    await expect(store.reconcile('chat', ['draft'], canonical.conversationUrl)).resolves.toEqual([
      canonical,
    ]);
    values[legacy] = { messages: { draft: [source] } };
    const restarted = createStarStore(area);
    await expect(restarted.getAll()).resolves.toEqual(data(canonical));
    await restarted.mergeCloud({ data: { messages: { draft: [source] } } });
    await expect(restarted.getAll()).resolves.toEqual(data(canonical));
    expectProjections(values, data(canonical));
  });

  it('repeated alias reconciliation after restart keeps a migrated canonical star live', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const source = { ...star('moved', 50), conversationId: 'draft' };
    const canonical = { ...source, conversationId: 'chat' };
    const { store, area, values } = setup({ [legacy]: { messages: { draft: [source] } } });
    await expect(store.reconcile('chat', ['draft'])).resolves.toEqual([canonical]);
    const restarted = createStarStore(area);
    await expect(restarted.reconcile('chat', ['draft'])).resolves.toEqual([canonical]);
    await restarted.mergeCloud({ data: { messages: { draft: [source] } } });
    await expect(restarted.reconcile('chat', ['draft'])).resolves.toEqual([canonical]);
    const final = { ...canonical, conversationId: 'final' };
    await expect(restarted.reconcile('final', ['chat', 'draft'])).resolves.toEqual([final]);
    await expect(createStarStore(area).reconcile('final', ['chat', 'draft'])).resolves.toEqual([
      final,
    ]);
    expectProjections(values, { messages: { final: [final] } });
    await restarted.remove('final', 'moved');
    await restarted.mergeCloud({
      data: { messages: { draft: [source], chat: [canonical], final: [final] } },
    });
    await expect(restarted.reconcile('final', ['chat', 'draft'])).resolves.toEqual([]);
  });

  it('an imported newer re-star survives duplicate older deletions without changing its timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const deletion = {
      conversationId: 'chat',
      turnId: 'same',
      conversationUrl: star('same').conversationUrl,
      starredAt: 50,
      deletedAt: NOW - DAY,
    };
    const latest = { ...deletion, deletedAt: NOW };
    const { store, values } = setup({
      [legacy]: data(star('same', 49)),
      [tombstones]: [deletion, { ...latest, starredAt: 40, deletedAt: NOW + DAY }, latest],
    });
    await store.mergeCloud({ data: data(star('same', 51)) });
    await expect(store.getForConversation('chat')).resolves.toEqual([star('same', 51)]);
    expect(values[tombstones]).toEqual([latest]);
  });

  it('a rejected deletion write leaves both live projections and prior deletions unchanged', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { store, area, values } = setup();
    await store.add(star('old', 10));
    await store.remove('chat', 'old');
    await store.add(star('kept', 20));
    const before = structuredClone(values);
    area.set.mockRejectedValueOnce(new Error('quota'));
    await expect(store.remove('chat', 'kept')).rejects.toThrow('quota');
    expect(values).toEqual(before);
    await expect(createStarStore(area).getForConversation('chat')).resolves.toEqual([
      star('kept', 20),
    ]);
    await expect(store.remove('chat', 'kept')).resolves.toBe(true);
    await expect(store.getForConversation('chat')).resolves.toEqual([]);
  });

  it.each([180 * DAY - 1, 180 * DAY, -DAY])(
    'a deletion aged %s milliseconds still suppresses later stale imports',
    async (age) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const stale = star('deleted', 50);
      const deletion = {
        conversationId: 'chat',
        turnId: 'deleted',
        conversationUrl: stale.conversationUrl,
        starredAt: 50,
        deletedAt: NOW - age,
      };
      const { store, values } = setup({ [legacy]: data(stale), [tombstones]: [deletion] });
      await expect(store.getAll()).resolves.toEqual({ messages: {} });
      expect(values[tombstones]).toEqual([deletion]);
      await store.mergeCloud({ data: data(stale) });
      await expect(store.getForConversation('chat')).resolves.toEqual([]);
    },
  );

  it.each(['legacy read', 'v1 merge'] as const)(
    'an expired deletion suppresses the current %s before pruning but a future stale import may revive it',
    async (kind) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const stale = star('deleted', 50);
      const deletion = {
        conversationId: 'chat',
        turnId: 'deleted',
        conversationUrl: stale.conversationUrl,
        starredAt: 50,
        deletedAt: NOW - 180 * DAY - 1,
      };
      const { store, values } = setup({
        ...(kind === 'legacy read' ? { [legacy]: data(stale) } : {}),
        [tombstones]: [deletion],
      });
      if (kind === 'v1 merge') await store.mergeCloud({ data: data(stale) });
      await expect(store.getAll()).resolves.toEqual({ messages: {} });
      expect(values[tombstones]).toEqual([]);
      expectProjections(values, { messages: {} });
      await store.mergeCloud({ data: data(stale) });
      await expect(store.getForConversation('chat')).resolves.toEqual([stale]);
    },
  );
});
