import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveSyncPayloads } from '@/core/services/GoogleDriveSyncPayloads';
import { StarDriveSyncCoordinator } from '@/core/services/StarDriveSyncCoordinator';
import { StorageKeys } from '@/core/types/common';

import { createStarStore } from '../starStore';
import type { StarredMessage, StarredMessagesData } from '../starTypes';

const legacy = StorageKeys.TIMELINE_STARRED_MESSAGES;
const star = (turnId: string): StarredMessage => ({
  turnId,
  starredAt: 1,
  conversationId: 'chat',
  conversationUrl: 'https://gemini.google.com/u/2/app/chat',
  content: `preview ${turnId}`,
});
const data = (...items: StarredMessage[]): StarredMessagesData => ({ messages: { chat: items } });
function setup() {
  const values: Record<string, unknown> = {};
  const store = createStarStore({
    get: async (keys) =>
      Object.fromEntries(
        keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]),
      ),
    set: async (items) => {
      Object.assign(values, structuredClone(items));
    },
  });
  return { values, store };
}
afterEach(() => vi.restoreAllMocks());

describe('Saved Library Drive compatibility', () => {
  it('the unchanged v1 Drive reader accepts a legacy projection with opaque account metadata', async () => {
    const saved = { ...star('account-star'), account: 'opaque-account' };
    const { store, values } = setup();
    await store.add(saved);
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
    const downloaded = await payloads.download('token', 'gemini', null, null);
    expect(downloaded?.starred).toEqual(
      expect.objectContaining({
        format: 'gemini-voyager.starred.v1',
        data: data(saved),
      }),
    );
    expect(Object.keys(values[legacy] as object)).toEqual(['messages']);
  });
});
