import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type {
  HighlightExportPayloadV1,
  HighlightPlatform,
  HighlightRecordV1,
} from '@/core/types/highlight';
import { createMemoryStorage, type MemoryStorage } from '@/tests/memoryStorage';

import {
  captureCloudSyncSnapshot,
  finishCloudSyncRunRow,
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '../CloudSyncSnapshotService';
import { HighlightAnnotationService } from '../HighlightAnnotationService';
import { pullCloudSyncHighlights } from '../cloudSyncHighlights';
import type { SnapshotContext } from '../cloudSyncSnapshotTypes';
import {
  getHighlightAccountHash,
  getHighlightBucketStorageKey,
  getHighlightIndexStorageKey,
} from '../highlightAnnotationData';

const ACCOUNT = { accountKey: 'email:shared-account', accountId: 0, routeUserId: '0' };
const GEMINI = { ...ACCOUNT, platform: 'gemini' as const };
const AISTUDIO = { ...ACCOUNT, platform: 'aistudio' as const };
const CLEAR = {
  clearedAt: 10,
  revision: { counter: 2, deviceId: 'cloud-device' },
  generation: { counter: 1, id: 'cloud-generation' },
};
let memory: MemoryStorage;
let owner: HighlightAnnotationService;

function record(id: string, platform: HighlightPlatform = 'gemini'): HighlightRecordV1 {
  return {
    id,
    schemaVersion: 1,
    platform,
    accountHash: getHighlightAccountHash({ ...ACCOUNT, platform }),
    conversationId: id,
    conversationUrl:
      platform === 'gemini'
        ? `https://gemini.google.com/app/${id}`
        : `https://aistudio.google.com/prompts/${id}`,
    turnId: `turn-${id}`,
    role: 'assistant',
    anchor: {
      quote: { exact: id, prefix: '', suffix: '' },
      position: { start: 0, end: id.length },
      sourceTextHash: 'hash',
    },
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    revision: { counter: 1, deviceId: 'cloud-device' },
  };
}

function payload(
  platform: HighlightPlatform,
  items: HighlightRecordV1[],
): HighlightExportPayloadV1 {
  return {
    format: 'gemini-voyager.annotations.v1',
    exportedAt: '2026-10-29T00:00:00Z',
    version: '2.2.1',
    accountScope: { platform, accountHash: getHighlightAccountHash({ ...ACCOUNT, platform }) },
    ...(platform === 'gemini' ? { clearMarker: CLEAR } : {}),
    items,
  };
}

async function row(
  platform: HighlightPlatform,
  operationId: string,
  remote: HighlightExportPayloadV1,
  snapshotId?: string,
) {
  const context: SnapshotContext = {
    source: 'popup-restore',
    platform,
    accountScope: ACCOUNT,
    selection: 'site',
  };
  const snapshot = await captureCloudSyncSnapshot({
    context,
    keys: [],
    snapshotId,
    run: { owner: 'panel', operationId },
  });
  const result = await pullCloudSyncHighlights({
    drive: {
      kind: 'sync-turn',
      async downloadHighlightsOnly() {
        throw new Error('Remote was preflighted');
      },
      async uploadHighlightsOnly() {
        throw new Error('Undo test cannot upload');
      },
      async getState() {
        return { error: null };
      },
    },
    local: owner,
    remote: { kind: 'found', value: remote },
    interactive: false,
    accountScope: ACCOUNT,
    context,
    snapshotId: snapshot.id,
  });
  expect(result).toMatchObject({ ok: true, snapshotId: snapshot.id });
  await finishCloudSyncRunRow(snapshot.id, operationId);
  return snapshot.id;
}

beforeEach(() => {
  memory = createMemoryStorage();
  vi.stubGlobal('chrome', { ...chrome, storage: memory.api });
  owner = new HighlightAnnotationService({
    now: () => 20,
    storage: {
      get: async (keys) =>
        memory.api.local.get(keys === null ? null : typeof keys === 'string' ? keys : [...keys]),
      set: (values) => memory.api.local.set(values),
      remove: (keys) => memory.api.local.remove(typeof keys === 'string' ? keys : [...keys]),
      getEffectiveQuotaBytes: async () => null,
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps the whole highlight account readable when another site row preserves its shared index', async () => {
  await owner.importMerge(GEMINI, [record('old')]);
  const run = await row(
    'gemini',
    'first',
    payload('gemini', [{ ...record('downloaded'), clearGeneration: CLEAR.generation.id }]),
  );
  const userRecord = {
    ...record('user-added'),
    note: 'Keep between-row edit',
    clearGeneration: CLEAR.generation.id,
  };
  await owner.importMerge(GEMINI, [userRecord]);
  await row('aistudio', 'second', payload('aistudio', [record('studio-cloud', 'aistudio')]), run);
  const snapshot = await readCloudSyncSnapshot();
  expect(
    snapshot?.entries.find(({ key }) => key === getHighlightIndexStorageKey(GEMINI)),
  ).toMatchObject({ preserve: true });

  const before = highlightValues();
  expect(await undoCloudSyncSnapshot(run)).toMatchObject({
    status: 'restored',
    restoredKeys: 0,
    kept: [{ kind: 'highlights' }],
  });
  expect(highlightValues()).toEqual(before);
  expect((await owner.getAll(GEMINI)).map(({ id }) => id).sort()).toEqual([
    'downloaded',
    'user-added',
  ]);
  expect((await owner.getAllAccounts()).map(({ id }) => id).sort()).toEqual([
    'downloaded',
    'studio-cloud',
    'user-added',
  ]);
  expect(await owner.getConversation(GEMINI, 'old')).toEqual([]);
  expect(await owner.getConversation(GEMINI, 'user-added')).toEqual([userRecord]);
  expect(await owner.getAll(AISTUDIO)).toEqual([record('studio-cloud', 'aistudio')]);
});

it('keeps a preserved note bucket indexed when a later row receipts its edited value again', async () => {
  await owner.importMerge(GEMINI, [record('old')]);
  const remote = payload('gemini', [
    { ...record('downloaded'), clearGeneration: CLEAR.generation.id },
  ]);
  const run = await row('gemini', 'first', remote);
  const edited = await owner.update(GEMINI, 'downloaded', 'downloaded', { note: 'Keep my note' });
  await row('gemini', 'second', remote, run);
  const snapshot = await readCloudSyncSnapshot();
  expect(
    snapshot?.entries.find(({ key }) => key === getHighlightBucketStorageKey(GEMINI, 'downloaded')),
  ).toMatchObject({ preserve: true });

  const before = highlightValues();
  expect(await undoCloudSyncSnapshot(run)).toMatchObject({
    status: 'restored',
    restoredKeys: 0,
    kept: [{ kind: 'highlights' }],
  });
  expect(highlightValues()).toEqual(before);
  expect((await owner.getAll(GEMINI)).map(({ id }) => id).sort()).toEqual(['downloaded']);
  expect((await owner.getAllAccounts()).map(({ id }) => id).sort()).toEqual(['downloaded']);
  expect(await owner.getConversation(GEMINI, 'downloaded')).toEqual([edited]);
  expect(await owner.getConversation(GEMINI, 'old')).toEqual([]);
});

it('does not resurrect a user clear that a later row carries into a fresh receipt', async () => {
  await owner.importMerge(GEMINI, [record('old')]);
  const remote = payload('gemini', [
    { ...record('downloaded'), clearGeneration: CLEAR.generation.id },
  ]);
  const run = await row('gemini', 'first', remote);
  const cleared = await owner.clearAll(GEMINI);
  await row('gemini', 'second', remote, run);
  expect((await owner.getAccountSnapshot(GEMINI)).clearMarker).toEqual(cleared.clearMarker);

  expect(await undoCloudSyncSnapshot(run)).toMatchObject({ status: 'restored' });
  expect(await owner.getAll(GEMINI)).toEqual([]);
  expect(await owner.getAllAccounts()).toEqual([]);
  expect(await owner.getConversation(GEMINI, 'old')).toEqual([]);
  expect(memory.values.local.has(getHighlightBucketStorageKey(GEMINI, 'old'))).toBe(false);
});

function highlightValues() {
  return structuredClone(
    Object.fromEntries([...memory.values.local].filter(([key]) => key.startsWith('gvAnnotation:'))),
  );
}
