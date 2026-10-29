import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { HighlightExportPayloadV1, HighlightRecordV1 } from '@/core/types/highlight';
import type { DriveReadResult } from '@/core/utils/driveReadResult';

import { applyCloudRestore } from '../CloudSyncApplyService';
import {
  captureCloudSyncSnapshot,
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
  type SnapshotContext,
} from '../CloudSyncSnapshotService';
import {
  HighlightAnnotationService,
  type HighlightStorageAdapter,
} from '../HighlightAnnotationService';
import { pullCloudSyncHighlights } from '../cloudSyncHighlights';
import { getHighlightAccountHash, getHighlightBucketStorageKey } from '../highlightAnnotationData';

const ACCOUNT = { accountKey: 'email:confirmed', accountId: 1, routeUserId: '1' };
const SCOPE = { ...ACCOUNT, platform: 'gemini' as const };
const CONTEXT: SnapshotContext = {
  source: 'popup-restore',
  platform: 'gemini',
  accountScope: ACCOUNT,
};
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;

function record(id: string, conversationId = id): HighlightRecordV1 {
  return {
    id,
    schemaVersion: 1,
    platform: 'gemini',
    accountHash: getHighlightAccountHash(SCOPE),
    conversationId,
    conversationUrl: `https://gemini.google.com/u/1/app/${conversationId}`,
    turnId: 'turn-one',
    role: 'assistant',
    anchor: {
      quote: { exact: 'selected text', prefix: '', suffix: '' },
      position: { start: 0, end: 13 },
      sourceTextHash: 'source-hash',
    },
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    revision: { counter: 1, deviceId: 'remote-device' },
  };
}

function payload(items: HighlightRecordV1[]): HighlightExportPayloadV1 {
  return {
    format: 'gemini-voyager.annotations.v1',
    exportedAt: '2026-10-29T00:00:00.000Z',
    version: '2.2.1',
    accountScope: { platform: 'gemini', accountHash: getHighlightAccountHash(SCOPE) },
    items,
  };
}

function harness() {
  const stored: Record<string, unknown> = {
    unrelated: 'keep',
    [StorageKeys.PROMPT_ITEMS]: ['before'],
  };
  const storage: HighlightStorageAdapter = {
    async get(keys) {
      if (keys === null) return structuredClone(stored);
      const requested = typeof keys === 'string' ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(requested.flatMap((key) => (key in stored ? [[key, stored[key]]] : []))),
      );
    },
    async set(values) {
      Object.assign(stored, structuredClone(values));
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete stored[key];
    },
    async getEffectiveQuotaBytes() {
      return null;
    },
  };
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) =>
    storage.get(
      keys === undefined
        ? null
        : typeof keys === 'string' || Array.isArray(keys)
          ? keys
          : Object.keys(keys),
    ),
  );
  vi.mocked(chrome.storage.local.set).mockImplementation((items) => storage.set(items));
  vi.mocked(chrome.storage.local.remove).mockImplementation((keys) => storage.remove(keys));
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({}));
  const local = new HighlightAnnotationService({ storage, now: () => 50 });
  const remote: { read: DriveReadResult<HighlightExportPayloadV1> } = { read: { kind: 'missing' } };
  const drive = {
    kind: 'sync-turn' as const,
    async downloadHighlightsResult() {
      return remote.read;
    },
    async downloadHighlightsOnly() {
      throw new Error('Expected strict read');
    },
    async uploadHighlightsOnly() {
      return true;
    },
    async getState() {
      return { error: null };
    },
  };
  return {
    stored,
    storage,
    local,
    remote,
    pull: () =>
      pullCloudSyncHighlights({
        drive,
        local,
        accountScope: ACCOUNT,
        interactive: false,
        context: CONTEXT,
      }),
    values: () =>
      structuredClone(Object.fromEntries(Object.entries(stored).filter(([key]) => key !== SLOT))),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('cloud download highlight snapshot through the annotation owner', () => {
  it('undo restores old buckets, removes new buckets, and shares one slot with the later popup apply', async () => {
    const h = harness();
    const original = record('old');
    await h.local.importMerge(SCOPE, [original]);
    const before = h.values();
    h.remote.read = {
      kind: 'found',
      value: payload([
        { ...original, note: 'Cloud edit', revision: { counter: 2, deviceId: 'remote-device' } },
        record('new'),
      ]),
    };

    const result = await h.pull();
    expect(result).toMatchObject({ ok: true, status: 'found', count: 2 });
    if (!result.ok || result.status !== 'found') throw new Error('Expected a successful import');
    expect((await h.local.getAll(SCOPE)).map((item) => item.id).sort()).toEqual(['new', 'old']);
    await applyCloudRestore({
      mode: 'overwrite',
      highlightsRestored: true,
      storageUpdate: { [StorageKeys.PROMPT_ITEMS]: ['from cloud'] },
      storageParts: ['prompts'],
      snapshot: CONTEXT,
      snapshotId: result.snapshotId,
    });
    expect((await readCloudSyncSnapshot())?.id).toBe(result.snapshotId);

    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 4,
      kept: [],
    });
    expect(h.values()).toEqual(before);
    expect(h.stored[SLOT]).toMatchObject({ kind: 'undone' });
    expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
  });

  it('undo restores a bucket removed by the downloaded clear marker', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    const before = h.values();
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
        clearMarker: {
          clearedAt: 100,
          revision: { counter: 2, deviceId: 'remote-device' },
          generation: { counter: 1, id: 'cloud-generation' },
        },
      },
    };
    expect(await h.pull()).toMatchObject({ ok: true, count: 1 });
    expect(h.stored[getHighlightBucketStorageKey(SCOPE, 'old')]).toBeUndefined();
    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 3,
      kept: [],
    });
    expect(h.values()).toEqual(before);
  });

  it('undo still recognizes the import when its source object changes while the receipt is hashed', async () => {
    const h = harness();
    const before = h.values();
    const incoming = record('new');
    h.remote.read = { kind: 'found', value: payload([incoming]) };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
      incoming.note = 'Changed while awaiting the receipt';
      return digest(...args);
    });

    expect(await h.pull()).toMatchObject({ ok: true, count: 1 });
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored', kept: [] });
    expect(h.values()).toEqual(before);
  });

  it('partial undo makes restored highlights readable while keeping a later note and clear generation', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
        clearMarker: {
          clearedAt: 100,
          revision: { counter: 2, deviceId: 'remote-device' },
          generation: { counter: 1, id: 'cloud-generation' },
        },
      },
    };
    expect(await h.pull()).toMatchObject({ ok: true, count: 1 });
    const edited = await h.local.update(SCOPE, 'new', 'new', { note: 'Keep my later note' });
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect((await h.local.getAll(SCOPE)).map((item) => item.id).sort()).toEqual(['new', 'old']);
    expect((await h.local.getAllAccounts()).map((item) => item.id).sort()).toEqual(['new', 'old']);
    expect(await h.local.getConversation(SCOPE, 'new')).toEqual([edited]);
    expect(await h.local.getConversation(SCOPE, 'old')).toEqual([
      { ...record('old'), clearGeneration: 'cloud-generation' },
    ]);
  });

  it('undo does not resurrect highlights after the user clears them again', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
        clearMarker: {
          clearedAt: 100,
          revision: { counter: 2, deviceId: 'remote-device' },
          generation: { counter: 1, id: 'cloud-generation' },
        },
      },
    };
    await h.pull();
    await h.local.clearAll(SCOPE);
    const cleared = h.values();
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect(h.values()).toEqual(cleared);
    expect(await h.local.getAll(SCOPE)).toEqual([]);
    expect(await h.local.getAllAccounts()).toEqual([]);
    expect(await h.local.getConversation(SCOPE, 'old')).toEqual([]);
  });

  it('partial undo keeps a new conversation added after the download while making old highlights readable', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([{ ...record('downloaded'), clearGeneration: 'cloud-generation' }]),
        clearMarker: {
          clearedAt: 100,
          revision: { counter: 2, deviceId: 'remote-device' },
          generation: { counter: 1, id: 'cloud-generation' },
        },
      },
    };
    await h.pull();
    const later = {
      ...record('later'),
      clearGeneration: 'cloud-generation',
      note: 'A new local highlight',
    };
    await h.local.importMerge(SCOPE, [later]);
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect((await h.local.getAll(SCOPE)).map((item) => item.id).sort()).toEqual(['later', 'old']);
    expect((await h.local.getAllAccounts()).map((item) => item.id).sort()).toEqual([
      'later',
      'old',
    ]);
    expect(await h.local.getConversation(SCOPE, 'later')).toEqual([later]);
    expect(await h.local.getConversation(SCOPE, 'old')).toEqual([
      { ...record('old'), clearGeneration: 'cloud-generation' },
    ]);
  });

  it('resumes a partial highlight undo if rebuilding its index fails', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
        clearMarker: {
          clearedAt: 100,
          revision: { counter: 2, deviceId: 'remote-device' },
          generation: { counter: 1, id: 'cloud-generation' },
        },
      },
    };
    await h.pull();
    const edited = await h.local.update(SCOPE, 'new', 'new', { note: 'Keep my note' });
    const set = h.storage.set.bind(h.storage);
    const failure = vi.spyOn(h.storage, 'set').mockImplementation(async (items) => {
      if (Object.keys(items).some((key) => key.startsWith('gvAnnotation:index:')))
        throw new Error('Index write failed');
      await set(items);
    });
    expect(await undoCloudSyncSnapshot()).toEqual({
      status: 'failed',
      error: 'Index write failed',
    });
    expect(await readCloudSyncSnapshot()).toMatchObject({ kind: 'undoing' });
    failure.mockRestore();
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect((await h.local.getAll(SCOPE)).map((item) => item.id).sort()).toEqual(['new', 'old']);
    expect(await h.local.getConversation(SCOPE, 'new')).toEqual([edited]);
  });

  it('keeps both restored and edited highlights readable with a legacy clear marker', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = {
      kind: 'found',
      value: {
        ...payload([
          { ...record('new'), updatedAt: 20, revision: { counter: 3, deviceId: 'remote-device' } },
        ]),
        clearMarker: { clearedAt: 10, revision: { counter: 2, deviceId: 'remote-device' } },
      },
    };
    await h.pull();
    const edited = await h.local.update(SCOPE, 'new', 'new', { note: 'Keep my note' });
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    expect((await h.local.getAll(SCOPE)).map((item) => item.id).sort()).toEqual(['new', 'old']);
    expect((await h.local.getAllAccounts()).map((item) => item.id).sort()).toEqual(['new', 'old']);
    expect(await h.local.getConversation(SCOPE, 'new')).toEqual([edited]);
    expect(await h.local.getConversation(SCOPE, 'old')).toEqual([
      {
        ...record('old'),
        updatedAt: 11,
        revision: { counter: 3, deviceId: 'remote-device' },
      },
    ]);
  });

  it.each(['capture', 'set receipt', 'remove receipt'] as const)(
    'keeps every prior highlight recoverable when the %s cannot be saved',
    async (failure) => {
      const h = harness();
      await h.local.importMerge(SCOPE, [record('old')]);
      const before = h.values();
      const oldBucket = getHighlightBucketStorageKey(SCOPE, 'old');
      h.remote.read = {
        kind: 'found',
        value: {
          ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
          clearMarker: {
            clearedAt: 100,
            revision: { counter: 2, deviceId: 'remote-device' },
            generation: { counter: 1, id: 'cloud-generation' },
          },
        },
      };
      const set = h.storage.set.bind(h.storage);
      vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
        const slot: unknown = Reflect.get(items, SLOT);
        if (
          slot &&
          typeof slot === 'object' &&
          'appliedHashes' in slot &&
          Array.isArray(slot.appliedHashes)
        ) {
          const receipts = slot.appliedHashes;
          const shouldFail =
            failure === 'capture'
              ? receipts.length === 0
              : failure === 'set receipt'
                ? receipts.length > 0
                : receipts.some(
                    (item: unknown) =>
                      typeof item === 'object' &&
                      item !== null &&
                      'key' in item &&
                      item.key === oldBucket,
                  );
          if (shouldFail) throw new Error('storage quota');
        }
        await set(items);
      });

      const result = await h.pull();
      expect(result).toMatchObject({
        ok: false,
        error: failure === 'capture' ? 'snapshot_failed' : 'snapshot_receipt_failed',
      });
      expect(h.stored[oldBucket]).toEqual(before[oldBucket]);
      if (failure !== 'remove receipt') expect(h.values()).toEqual(before);
      vi.mocked(chrome.storage.local.set).mockImplementation((items) => set(items));
      await undoCloudSyncSnapshot();
      expect(h.values()).toEqual(before);
    },
  );

  it.each(['set', 'remove'] as const)(
    'undo keeps unchanged originals unreported after a receipted canonical %s fails',
    async (phase) => {
      const h = harness();
      await h.local.importMerge(SCOPE, [record('old')]);
      const before = h.values();
      h.remote.read = {
        kind: 'found',
        value: {
          ...payload([{ ...record('new'), clearGeneration: 'cloud-generation' }]),
          clearMarker: {
            clearedAt: 100,
            revision: { counter: 2, deviceId: 'remote-device' },
            generation: { counter: 1, id: 'cloud-generation' },
          },
        },
      };
      const set = h.storage.set.bind(h.storage);
      const failedWrite =
        phase === 'set'
          ? vi.spyOn(h.storage, 'set').mockImplementation(async (items) => {
              if (Object.keys(items).some((key) => key.startsWith('gvAnnotation:')))
                throw new Error('canonical set quota');
              await set(items);
            })
          : vi.spyOn(h.storage, 'remove').mockRejectedValue(new Error('canonical remove quota'));

      const result = await h.pull();
      expect(result).toMatchObject({ ok: false, error: `canonical ${phase} quota` });
      if (result.ok) throw new Error('Expected the canonical write to fail');
      expect((await readCloudSyncSnapshot())?.id).toBe(result.snapshotId);
      failedWrite.mockRestore();

      expect(await undoCloudSyncSnapshot()).toMatchObject({
        status: 'restored',
        restoredKeys: phase === 'set' ? 0 : 2,
        kept: [],
      });
      expect(h.values()).toEqual(before);
      expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
    },
  );

  it('keeps later highlight edits and reports their kind while removing an unchanged new bucket', async () => {
    const h = harness();
    await h.local.importMerge(SCOPE, [record('old')]);
    h.remote.read = { kind: 'found', value: payload([record('new')]) };
    expect(await h.pull()).toMatchObject({ ok: true });
    await h.local.update(SCOPE, 'old', 'old', { note: 'Edited after download' });

    const result = await undoCloudSyncSnapshot();
    expect(result).toMatchObject({
      status: 'restored',
      kept: [{ kind: 'highlights', reason: 'changed-since-download' }],
    });
    expect(h.stored[getHighlightBucketStorageKey(SCOPE, 'new')]).toBeUndefined();
    expect(await h.local.getConversation(SCOPE, 'old')).toEqual([
      expect.objectContaining({ note: 'Edited after download' }),
    ]);
  });

  it.each(['missing', 'unrecognized', 'failed'] as const)(
    'does not replace the previous snapshot on a %s read',
    async (kind) => {
      const h = harness();
      await h.local.importMerge(SCOPE, [record('old')]);
      await captureCloudSyncSnapshot({ context: CONTEXT, keys: [] });
      const before = structuredClone(h.stored);
      h.remote.read =
        kind === 'failed' ? { kind, error: new Error('Drive unavailable') } : { kind };
      expect(await h.pull()).toMatchObject(
        kind === 'failed'
          ? { ok: false, status: 'failed', error: 'Drive unavailable' }
          : { ok: true, status: kind, empty: true },
      );
      expect(h.stored).toEqual(before);
    },
  );
});
