import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import type { ForkNode } from '@/pages/content/fork/forkTypes';

import { createForkMessagesOwner } from '../forkMessages';

const key = StorageKeys.FORK_NODES;
const slot = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const node = (conversationId: string): ForkNode => ({
  conversationId,
  turnId: 'turn',
  conversationUrl: `https://gemini.google.com/app/${conversationId}`,
  forkGroupId: 'group',
  forkIndex: 0,
  createdAt: 1,
});
const previous = { nodes: { local: [node('local')] }, groups: { group: ['local:turn'] } };
const downloaded = {
  nodes: { ...previous.nodes, cloud: [node('cloud')] },
  groups: { group: ['local:turn', 'cloud:turn'] },
};

async function setup() {
  const values: Record<string, unknown> = { [key]: structuredClone(previous) };
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => structuredClone(values));
  const save = async (items: Record<string, unknown>) => {
    Object.assign(values, structuredClone(items));
  };
  const set = vi.spyOn(chrome.storage.local, 'set').mockImplementation(save);
  vi.spyOn(chrome.storage.local, 'remove').mockImplementation(async (keys) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
  });
  const owner = createForkMessagesOwner({
    get: (keys) => chrome.storage.local.get<Record<string, unknown>>(keys),
    set: (items) => chrome.storage.local.set(items),
  });
  const snapshot = await captureCloudSyncSnapshot({
    context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
    keys: [{ area: 'local', key }],
  });
  const merge = (data: unknown = { nodes: { cloud: [node('cloud')] }, groups: {} }) =>
    owner.handle({
      type: 'gv.fork.mergeCloud',
      payload: {
        format: 'gemini-voyager.forks.v1',
        data,
        cloudSyncSnapshotId: snapshot.id,
      },
    });
  return { values, set, save, owner, snapshot, merge };
}

afterEach(() => vi.restoreAllMocks());

describe('fork download write receipts', () => {
  it('keeps downloads and later queued edits separate while waiting for durable receipts', async () => {
    const { values, set, save, owner, merge } = await setup();
    const receiptStarted = Promise.withResolvers<void>();
    const releaseReceipt = Promise.withResolvers<void>();
    let receiptBeforeWrite: unknown;
    set.mockImplementation(async (items) => {
      if (slot in items) {
        receiptStarted.resolve();
        await releaseReceipt.promise;
      }
      if (key in items) receiptBeforeWrite ??= structuredClone(values[slot]);
      await save(items);
    });

    const restoring = merge();
    await receiptStarted.promise;
    const later = owner.handle({ type: 'gv.fork.add', payload: node('later') });
    const beforeReceipt = structuredClone(values[key]);
    releaseReceipt.resolve();
    await expect(restoring).resolves.toEqual({ ok: true, status: 'merged' });
    await expect(later).resolves.toEqual({ ok: true, added: true });
    expect(beforeReceipt).toEqual(previous);

    const receipt = { area: 'local', key, kind: 'forks', hash: await hashValue(downloaded) };
    expect(receiptBeforeWrite).toMatchObject({ kind: 'snapshot', appliedHashes: [receipt] });
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([receipt]);
    const edited = {
      nodes: { ...downloaded.nodes, later: [node('later')] },
      groups: { group: ['local:turn', 'cloud:turn', 'later:turn'] },
    };
    expect(values[key]).toEqual(edited);
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'forks', reason: 'changed-since-download' }],
    });
    expect(values[key]).toEqual(edited);
  });

  it('preserves local forks on receipt failure and allows the next queued edit', async () => {
    const { values, set, save, owner, merge } = await setup();
    set.mockImplementation(async (items) => {
      if (slot in items) throw new Error('receipt quota');
      await save(items);
    });

    await expect(merge()).rejects.toThrow('receipt quota');
    expect(values[key]).toEqual(previous);
    await expect(owner.handle({ type: 'gv.fork.add', payload: node('later') })).resolves.toEqual({
      ok: true,
      added: true,
    });
    expect(values[key]).toEqual({
      nodes: { ...previous.nodes, later: [node('later')] },
      groups: { group: ['local:turn', 'later:turn'] },
    });
  });

  it('can undo a canonical write whose error reply arrives after storage committed', async () => {
    const { values, set, save, snapshot, merge } = await setup();
    let loseReply = true;
    set.mockImplementation(async (items) => {
      await save(items);
      if (key in items && loseReply) {
        loseReply = false;
        throw new Error('write reply lost');
      }
    });

    await expect(merge()).rejects.toThrow('write reply lost');
    expect(values[key]).toEqual(downloaded);
    await finishCloudSyncSnapshot(snapshot.id);
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({
      status: 'restored',
      restoredKeys: 1,
    });
    expect(values[key]).toEqual(previous);
  });

  it('does not prepare a receipt for forks already stored', async () => {
    const { merge } = await setup();
    await expect(merge(previous)).resolves.toEqual({ ok: true, status: 'merged' });
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([]);
  });
});
