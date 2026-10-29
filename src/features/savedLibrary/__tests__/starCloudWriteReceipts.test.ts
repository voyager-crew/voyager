import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  readCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

import { StarredMessagesService } from '../StarredMessagesService';
import { createStarStore } from '../starStore';
import type { StarredMessage } from '../starTypes';

const keys = [
  StorageKeys.SAVED_LIBRARY_STARS,
  StorageKeys.TIMELINE_STARRED_MESSAGES,
  StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
];
const star = (id: string, route: string): StarredMessage => ({
  conversationId: id,
  turnId: 'turn',
  content: 'Prompt',
  conversationUrl: `https://gemini.google.com/u/${route}/app/${id}`,
  starredAt: 10,
});

async function setup(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => structuredClone(values));
  const set = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    Object.assign(values, structuredClone(items));
  });
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: keys.map((key) => ({ area: 'local', key })),
  });
  const store = createStarStore({
    get: (keys) => chrome.storage.local.get<Record<string, unknown>>(keys),
    set: (items) => chrome.storage.local.set(items),
  });
  const handle = createStarredMessagesHandler(store);
  const sender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('src/pages/popup/index.html'),
  };
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message, respond) => {
    const pending = handle(message, sender);
    if (typeof respond === 'function') void pending?.then((value) => respond(value));
    return pending;
  });
  return { values, set, snapshot, store };
}

afterEach(() => vi.restoreAllMocks());

describe('star download write receipts', () => {
  it('records the full atomic payload even when another context changes storage before the reply', async () => {
    const other = star('other-account', '3');
    const incoming = { ...star('downloaded', '2'), text: 'Complete prompt' };
    const previous = { messages: { [other.conversationId]: [other] } };
    const { values, set, snapshot } = await setup({
      [keys[0]]: previous,
      [keys[1]]: previous,
      [keys[2]]: [],
    });
    const later = { messages: { later: [star('later', '2')] } };
    let receiptBeforeWrite: unknown;
    set.mockImplementation(async (items) => {
      if (keys[0] in items)
        receiptBeforeWrite = structuredClone(values[StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT]);
      Object.assign(values, structuredClone(items));
      if (keys[0] in items) values[keys[0]] = later;
    });
    await StarredMessagesService.mergeSync(
      { v1: { data: { messages: { downloaded: [incoming] } } } },
      { accountKey: 'account-two', accountId: 2, routeUserId: '2' },
      snapshot.id,
    );
    const stored = await readCloudSyncSnapshot();
    const { text: _text, ...legacyIncoming } = incoming;
    const expected = [
      { messages: { 'other-account': [other], downloaded: [incoming] } },
      { messages: { 'other-account': [other], downloaded: [legacyIncoming] } },
      [],
    ];
    expect(stored?.appliedHashes).toHaveLength(3);
    for (const [index, key] of keys.entries()) {
      expect(stored?.appliedHashes.find((receipt) => receipt.key === key)?.hash).toBe(
        await hashValue(expected[index]),
      );
    }
    expect(receiptBeforeWrite).toMatchObject({
      kind: 'snapshot',
      appliedHashes: stored?.appliedHashes,
    });
    expect(values[keys[0]]).toEqual(later);
  });

  it('leaves no applied receipt for a clean no-op', async () => {
    const { store, snapshot } = await setup();
    await store.mergeSync({ snapshotId: snapshot.id }, null);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([]);
  });

  it('retains a prepared receipt for every atomic key when the physical write fails', async () => {
    const { store, set, snapshot, values } = await setup();
    set.mockImplementation(async (items) => {
      if (keys[0] in items) throw new Error('quota');
      Object.assign(values, structuredClone(items));
    });
    await expect(
      store.mergeSync({ v1: { data: { messages: {} } }, snapshotId: snapshot.id }, null),
    ).rejects.toThrow('quota');
    await finishCloudSyncSnapshot(snapshot.id);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual(
      await Promise.all(
        keys.map(async (key, index) => ({
          area: 'local',
          key,
          kind: 'starred',
          hash: await hashValue(index === 2 ? [] : { messages: {} }),
        })),
      ),
    );
    for (const key of keys) expect(values[key]).toBeUndefined();
  });

  it('preserves all starred keys when the receipt cannot be saved', async () => {
    const previous = { messages: { local: [star('local', '2')] } };
    const initial = { [keys[0]]: previous, [keys[1]]: previous, [keys[2]]: [] };
    const { store, set, snapshot, values } = await setup(initial);
    set.mockImplementation(async (items) => {
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items) throw new Error('receipt quota');
      Object.assign(values, structuredClone(items));
    });
    await expect(
      store.mergeSync(
        {
          v1: { data: { messages: { downloaded: [star('downloaded', '2')] } } },
          snapshotId: snapshot.id,
        },
        null,
      ),
    ).rejects.toThrow('receipt quota');
    for (const key of keys) expect(values[key]).toEqual(initial[key]);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([]);
  });
});
