import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  readCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import { createCatalogOutlineMessageHandler } from '@/pages/background/catalogOutlineMessages';

import { restoreCatalogTimelineBuckets } from '../catalogOutlineMessages';
import { restorePulledCatalogTimeline } from '../catalogTimelineCloud';

const key = 'gvCatalogTimelineHierarchy:chatgpt';
const secondKey = 'gvCatalogTimelineHierarchy:claude';
const cloud = {
  conversations: {
    'chatgpt:conv:downloaded': {
      conversationUrl: 'https://chatgpt.com/c/downloaded',
      levels: { turn: 1 as const },
      collapsed: [],
      updatedAt: 10,
    },
  },
};

async function setup(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => structuredClone(values));
  const set = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    Object.assign(values, structuredClone(items));
  });
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'chatgpt', accountScope: null },
    keys: [key, secondKey].map((key) => ({ area: 'local', key })),
  });
  const handle = createCatalogOutlineMessageHandler();
  const sender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('src/pages/popup/index.html'),
  };
  const send = async (message: unknown) => handle(message, sender);
  return { values, set, snapshot, send };
}

afterEach(() => vi.restoreAllMocks());

describe('catalog download write receipts', () => {
  it('records the owner merged bucket rather than a later edit and never stores receipt metadata', async () => {
    const { values, set, snapshot, send } = await setup({
      [key]: { conversations: {}, future: 1 },
    });
    const later = { conversations: {}, future: 2 };
    let written: unknown;
    let receiptBeforeWrite: unknown;
    set.mockImplementation(async (items) => {
      if (key in items)
        receiptBeforeWrite = structuredClone(values[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]);
      Object.assign(values, structuredClone(items));
      if (key in items) {
        written = structuredClone(items[key]);
        values[key] = later;
      }
    });
    expect(
      await restorePulledCatalogTimeline(
        send,
        { outlines: { [key]: cloud }, stars: {} },
        snapshot.id,
      ),
    ).toBe(true);
    const expected = { ...cloud, future: 1 };
    expect(written).toEqual(expected);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([
      expect.objectContaining({ key, hash: await hashValue(expected) }),
    ]);
    expect(receiptBeforeWrite).toMatchObject({
      kind: 'snapshot',
      appliedHashes: [expect.objectContaining({ key, hash: await hashValue(expected) })],
    });
    expect(values[key]).toEqual(later);
  });

  it('retains prepared receipts for successful and failed canonical buckets', async () => {
    const { values, set, snapshot, send } = await setup();
    set.mockImplementation(async (items) => {
      if (secondKey in items) throw new Error('quota');
      Object.assign(values, structuredClone(items));
    });
    await expect(
      restorePulledCatalogTimeline(
        send,
        { outlines: { [key]: cloud, [secondKey]: cloud }, stars: {} },
        snapshot.id,
      ),
    ).rejects.toThrow('Could not restore timeline outlines');
    const stored = await readCloudSyncSnapshot();
    expect(stored?.appliedHashes).toHaveLength(2);
    expect(stored?.appliedHashes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key, hash: await hashValue(cloud) }),
        expect.objectContaining({ key: secondKey, hash: await hashValue(cloud) }),
      ]),
    );
    expect(values[secondKey]).toBeUndefined();
  });

  it('reports a failed bucket and preserves its original content when receipt persistence fails', async () => {
    const previous = { conversations: {}, future: 'preserved' };
    const { values, set, snapshot, send } = await setup({ [key]: previous });
    set.mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items) throw new Error('receipt quota');
      Object.assign(values, structuredClone(items));
    });
    expect(await restoreCatalogTimelineBuckets(send, { [key]: cloud }, snapshot.id)).toEqual({
      restored: 0,
      failed: 1,
    });
    expect(values[key]).toEqual(previous);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([]);
  });

  it('does not claim a write for an unchanged bucket', async () => {
    const { snapshot, send } = await setup({ [key]: cloud });
    expect(await restoreCatalogTimelineBuckets(send, { [key]: cloud }, snapshot.id)).toEqual({
      restored: 1,
      failed: 0,
    });
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([]);
  });
});
