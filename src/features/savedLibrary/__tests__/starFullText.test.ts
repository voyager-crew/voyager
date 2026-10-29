import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveSyncPayloads } from '@/core/services/GoogleDriveSyncPayloads';
import { StarDriveSyncCoordinator } from '@/core/services/StarDriveSyncCoordinator';
import { StorageKeys } from '@/core/types/common';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

import { StarredMessagesService } from '../StarredMessagesService';
import { mergeStarredMessages } from '../starData';
import { createStarStore } from '../starStore';
import type { StarredMessage, StarredMessagesData } from '../starTypes';

const neutral = StorageKeys.SAVED_LIBRARY_STARS;
const legacy = StorageKeys.TIMELINE_STARRED_MESSAGES;
const deletionKey = StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES;
const star = (turnId: string, content = 'First line', starredAt = 1): StarredMessage => ({
  turnId,
  content,
  starredAt,
  conversationId: 'chat',
  conversationUrl: 'https://gemini.google.com/app/chat',
});
const data = (...items: StarredMessage[]): StarredMessagesData => ({ messages: { chat: items } });

function setup(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  const area = {
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { values, area, store: createStarStore(area) };
}

afterEach(() => vi.restoreAllMocks());

describe('Saved Library full prompt text', () => {
  it('a starred prompt keeps its line breaks while the legacy key stays small', async () => {
    const { store, values, area } = setup();
    const item = {
      ...star('one'),
      text: 'First line\nSecond line\n\nLast line',
      account: 'opaque',
    };
    await store.add(item);
    await expect(store.getForConversation('chat')).resolves.toEqual([item]);
    expect(values[neutral]).toEqual(data(item));
    const { text: _text, ...oldRecord } = item;
    expect(values[legacy]).toEqual(data(oldRecord));
    expect(area.set).toHaveBeenCalledTimes(1);
    await expect(createStarStore(area).getForConversation('chat')).resolves.toEqual([item]);
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it.each([
    { text: 'a'.repeat(16383) + '😀' + 'z', expected: 'a'.repeat(16383) },
    { text: '😀'.repeat(5000), expected: '😀'.repeat(4096) },
    { text: '界'.repeat(6000), expected: '界'.repeat(5461) },
  ])(
    'full prompt text stops before a code point would exceed 16 KiB',
    async ({ text, expected }) => {
      const { store, values } = setup();
      await store.add({ ...star('bounded'), text });
      const saved = (await store.getForConversation('chat'))[0]!.text;
      expect(saved).toBe(expected);
      expect(new TextEncoder().encode(saved).byteLength).toBeLessThanOrEqual(16384);
      expect((values[legacy] as StarredMessagesData).messages.chat[0]).not.toHaveProperty('text');
    },
  );

  it('malformed optional text does not make a valid star unreadable', async () => {
    const item = star('one');
    const { store, values } = setup({
      [neutral]: data({ ...item, text: 3 } as unknown as StarredMessage),
    });
    await expect(store.getForConversation('chat')).resolves.toEqual([item]);
    expect(values[neutral]).toEqual(data(item));
    await store.backfill('chat', [{ turnId: 'one', text: 'First line\nRecovered' }]);
    expect((await store.getForConversation('chat'))[0]!.text).toBe('First line\nRecovered');
  });

  it.each([
    {
      localText: 'First line',
      localTime: 9,
      incomingText: 'First line\nMore',
      incomingTime: 1,
      expected: 'First line\nMore',
    },
    {
      localText: 'First line\nMore',
      localTime: 1,
      incomingText: 'First line',
      incomingTime: 9,
      expected: 'First line\nMore',
    },
    {
      localText: 'Old branch',
      localTime: 1,
      incomingText: 'New branch',
      incomingTime: 9,
      expected: 'New branch',
    },
    {
      localText: 'New branch',
      localTime: 9,
      incomingText: 'Old branch',
      incomingTime: 1,
      expected: 'New branch',
    },
    {
      localText: 'Known full text',
      localTime: 1,
      incomingText: undefined,
      incomingTime: 9,
      expected: 'Known full text',
    },
    {
      localText: undefined,
      localTime: 9,
      incomingText: 'Known full text',
      incomingTime: 1,
      expected: 'Known full text',
    },
  ])(
    'merging live copies preserves the chosen full text',
    ({ localText, localTime, incomingText, incomingTime, expected }) => {
      const merged = mergeStarredMessages(
        data({
          ...star('one', 'local', localTime),
          ...(localText !== undefined ? { text: localText } : {}),
        }),
        data({
          ...star('one', 'incoming', incomingTime),
          ...(incomingText !== undefined ? { text: incomingText } : {}),
        }),
      );
      expect(merged.messages.chat[0]!.text).toBe(expected);
      expect(merged.messages.chat[0]!.starredAt).toBe(Math.max(localTime, incomingTime));
    },
  );

  it('reconciling aliases keeps longer text without changing the newer star instance', async () => {
    const stable = { ...star('one', 'First line', 9), text: 'First line' };
    const draft = {
      ...star('one', 'First line', 1),
      conversationId: 'draft',
      text: 'First line\nMore',
    };
    const { store, values } = setup({
      [neutral]: { messages: { chat: [stable], draft: [draft] } },
    });
    await expect(store.reconcile('chat', ['draft'])).resolves.toMatchObject([
      { conversationId: 'chat', starredAt: 9, text: 'First line\nMore' },
    ]);
    expect((values[legacy] as StarredMessagesData).messages.chat[0]).not.toHaveProperty('text');
    await store.mergeCloud({
      format: 'gemini-voyager.starred.v1',
      data: data(star('one', 'preview', 20)),
    });
    expect((await store.getForConversation('chat'))[0]).toMatchObject({
      starredAt: 20,
      text: 'First line\nMore',
    });
  });

  it('opening an old conversation fills in the full text of matching stars in one write', async () => {
    const firstText = `First\nline\n${'x'.repeat(80)}\nRest`;
    const first = star('one', `First line ${'x'.repeat(49)}...`);
    const second = star('two', 'Second line');
    const other = { ...star('one', 'Other preview'), conversationId: 'other' };
    const { store, area } = setup({
      [legacy]: { messages: { chat: [first, second], other: [other] } },
    });
    await store.backfill('chat', [
      { turnId: 'one', text: firstText },
      { turnId: 'two', text: 'Second line\nMore' },
      { turnId: 'absent', text: 'Unstored prompt' },
    ]);
    expect(area.set).toHaveBeenCalledTimes(1);
    await expect(store.getForConversation('chat')).resolves.toEqual([
      { ...first, text: firstText },
      { ...second, text: 'Second line\nMore' },
    ]);
    await expect(store.getForConversation('other')).resolves.toEqual([other]);
    await store.backfill('chat', [{ turnId: 'one', text: firstText }]);
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it('a literal ellipsis does not let backfill attach a different prompt', async () => {
    const item = star('one', 'First...');
    const { store, area } = setup({
      [neutral]: data(item),
      [legacy]: data(item),
      [deletionKey]: [],
    });
    await store.backfill('chat', [{ turnId: 'one', text: 'First changed\nAnother prompt' }]);
    await expect(store.getForConversation('chat')).resolves.toEqual([item]);
    expect(area.set).not.toHaveBeenCalled();
    await store.backfill('chat', [{ turnId: 'one', text: 'First...\nActual continuation' }]);
    expect((await store.getForConversation('chat'))[0]!.text).toBe('First...\nActual continuation');
  });

  it('a backfill cannot replace distinct known text or attach a different prompt preview', async () => {
    const item = { ...star('one'), text: 'First line\nStored branch' };
    const { store, area } = setup({
      [neutral]: data(item),
      [legacy]: data(star('one')),
      [deletionKey]: [],
    });
    await store.backfill('chat', [{ turnId: 'one', text: 'First line\nDifferent branch' }]);
    await store.backfill('chat', [{ turnId: 'one', text: 'Entirely different prompt' }]);
    expect(area.set).not.toHaveBeenCalled();
    await expect(store.getForConversation('chat')).resolves.toEqual([item]);
    await store.backfill('chat', [{ turnId: 'one', text: item.text + '\nMore' }]);
    expect((await store.getForConversation('chat'))[0]!.text).toBe(item.text + '\nMore');
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it('a backfill queued behind deletion cannot recreate the removed star', async () => {
    const item = star('one');
    const { store, area, values } = setup({
      [neutral]: data(item),
      [legacy]: data(item),
      [deletionKey]: [],
    });
    await Promise.all([
      store.remove('chat', 'one'),
      store.backfill('chat', [{ turnId: 'one', text: 'First line\nMore' }]),
    ]);
    await expect(store.getForConversation('chat')).resolves.toEqual([]);
    expect(values[neutral]).toEqual({ messages: {} });
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it('the client dispatches one batch to the real serialized owner', async () => {
    const item = star('one');
    const { store, area } = setup({
      [neutral]: data(item),
      [legacy]: data(item),
      [deletionKey]: [],
    });
    const handle = createStarredMessagesHandler(store);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      request: unknown,
      reply: (response: unknown) => void,
    ) => {
      void handle(request)?.then(reply, (error: Error) =>
        reply({ ok: false, error: error.message }),
      );
    }) as typeof chrome.runtime.sendMessage);
    await StarredMessagesService.backfillStarredTexts('chat', [
      { turnId: 'one', text: 'First line\nClient capture' },
    ]);
    expect((await store.getForConversation('chat'))[0]!.text).toBe('First line\nClient capture');
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it('the unchanged v1 cloud projection never uploads full prompt text', async () => {
    const { store } = setup();
    const item = {
      ...star('one', 'p'.repeat(80)),
      text: 'Private full prompt\nSecond line',
      account: 'opaque',
    };
    await store.add(item);
    const remote = new Map<string, unknown>();
    const payloads = new GoogleDriveSyncPayloads({
      ensure: async (_token, name) => name,
      find: async (_token, name) => (remote.has(name) ? name : null),
      upload: async (_token, name, payload) => {
        remote.set(name, structuredClone(payload));
      },
      download: async <T>(_token: string, name: string): Promise<T | null> =>
        (remote.get(name) as T) ?? null,
      prepareDownload: async () => {},
    });
    const commit = await new StarDriveSyncCoordinator().prepare(store, [
      {
        port: {
          assertActive: () => {},
          read: () => payloads.readStars('token', null),
          writeV2: (payload) => payloads.writeStars('token', payload, null, true),
          writeV1: (payload) => payloads.writeStars('token', payload, null, false),
        },
        scope: null,
      },
    ]);
    await commit();
    const { text: _text, ...oldRecord } = item;
    expect(remote.get('gemini-voyager-starred.json')).toMatchObject({
      format: 'gemini-voyager.starred.v1',
      data: data({ ...oldRecord, content: 'p'.repeat(60) + '...' }),
    });
    expect(JSON.stringify(remote.get('gemini-voyager-starred.json'))).not.toContain(
      'Private full prompt',
    );
    expect((await store.getForConversation('chat'))[0]!.text).toBe(item.text);
  });
});
