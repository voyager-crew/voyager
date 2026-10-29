import { afterEach, describe, expect, it, vi } from 'vitest';

import { scopedDriveFileName } from '@/core/services/GoogleDriveIdentity';
import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import {
  getHighlightAccountHash,
  getHighlightBucketStorageKey,
} from '@/core/services/highlightAnnotationData';
import { StorageKeys } from '@/core/types/common';
import type { HighlightExportPayloadV1, HighlightRecordV1 } from '@/core/types/highlight';

vi.mock('@/core/utils/browser', async (original) => ({
  ...(await original<typeof import('@/core/utils/browser')>()),
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const ACCOUNT = { accountKey: 'email:confirmed-account', accountId: 1, routeUserId: '1' };
const SCOPE = { ...ACCOUNT, platform: 'gemini' as const };
const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const HIGHLIGHTS = scopedDriveFileName('gemini-voyager-highlights.json', ACCOUNT.accountKey);
const FOLDERS = 'gemini-voyager-folders.json';
const BEFORE_FOLDERS = {
  folders: [
    { id: 'before', name: 'Before', parentId: null, isExpanded: false, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: {},
};
const CLOUD_FOLDERS = {
  folders: [
    { id: 'cloud', name: 'Cloud', parentId: null, isExpanded: false, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: {},
};

function record(id: string): HighlightRecordV1 {
  return {
    id,
    schemaVersion: 1,
    platform: 'gemini',
    accountHash: getHighlightAccountHash(SCOPE),
    conversationId: id,
    conversationUrl: `https://gemini.google.com/u/1/app/${id}`,
    turnId: 'turn',
    role: 'assistant',
    anchor: {
      quote: { exact: 'selected', prefix: '', suffix: '' },
      position: { start: 0, end: 8 },
      sourceTextHash: 'hash',
    },
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    revision: { counter: 1, deviceId: 'cloud-device' },
  };
}

function payload(items: HighlightRecordV1[]): HighlightExportPayloadV1 {
  return {
    format: 'gemini-voyager.annotations.v1',
    version: '2.2.1',
    exportedAt: '2026-10-29T00:00:00Z',
    accountScope: { platform: 'gemini', accountHash: getHighlightAccountHash(SCOPE) },
    items,
  };
}

function readReply(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a sync response');
  return Object.fromEntries(Object.entries(value));
}

async function device() {
  const stored: Record<string, unknown> = {
    [StorageKeys.FOLDER_DATA]: structuredClone(BEFORE_FOLDERS),
    [StorageKeys.PROMPT_ITEMS]: [{ id: 'local', text: 'Keep prompt', tags: [], createdAt: 1 }],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    unrelated: 'keep',
  };
  const failures = { receipt: false, metadata: false };
  const metadataEntered = Promise.withResolvers<void>();
  const area = {
    async get(keys: unknown) {
      const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      const names =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys ?? stored);
      return structuredClone({
        ...defaults,
        ...Object.fromEntries(
          names
            .filter((key): key is string => typeof key === 'string' && key in stored)
            .map((key) => [key, stored[key]]),
        ),
      });
    },
    async set(items: Record<string, unknown>) {
      const slot = readReply(items[SLOT] ?? {});
      if (failures.receipt && Array.isArray(slot.appliedHashes) && slot.appliedHashes.length)
        throw new Error('Receipt quota exceeded');
      Object.assign(stored, structuredClone(items));
    },
    async remove(keys: string | string[]) {
      for (const key of [keys].flat()) delete stored[key];
    },
  };
  const extensionId = 'sync-highlight-undo';
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      getManifest: () => ({ permissions: ['unlimitedStorage'] }),
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) =>
        callback('fake-token'),
    },
    storage: {
      local: area,
      sync: {
        get: async () => ({
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
        }),
        set: async () => {},
      },
    },
    tabs: { query: async () => [], sendMessage: async () => undefined },
  });
  const drive = new FakeSyncDrive();
  drive.put(FOLDERS, {
    format: 'gemini-voyager.folders.v1',
    exportedAt: '2026-10-29T00:00:00Z',
    version: '2.2.1',
    data: CLOUD_FOLDERS,
  });
  drive.put(HIGHLIGHTS, payload([record('new')]));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (failures.metadata && url.searchParams.get('fields')?.includes('md5Checksum')) {
      metadataEntered.resolve();
      return new Response('', { status: 503 });
    }
    return drive.fetch(input, init);
  });
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../cloudSyncMessages');
  const { highlightAnnotationService } = await import('@/core/services/HighlightAnnotationService');
  const snapshot = await import('@/core/services/CloudSyncSnapshotService');
  const { applyCloudRestore } = await import('@/core/services/CloudSyncApplyService');
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: async () => ({ messages: {} }),
    getAllForkNodes: async () => ({ nodes: {}, groups: {} }),
  });
  const sender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/src/pages/popup/index.html`,
  };
  await highlightAnnotationService.importMerge(SCOPE, [record('old')]);
  const userValues = () =>
    structuredClone(
      Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            key.startsWith('gvAnnotation:') ||
            key === StorageKeys.FOLDER_DATA ||
            key === StorageKeys.PROMPT_ITEMS ||
            key === 'unrelated',
        ),
      ),
    );
  return {
    stored,
    drive,
    failures,
    metadataEntered,
    userValues,
    snapshot,
    applyCloudRestore,
    highlightAnnotationService,
    async complete(operationId: unknown, differentSender = false) {
      return handler(
        { type: 'gv.sync.completeDownload', payload: { operationId, success: true } },
        differentSender
          ? { ...sender, url: `chrome-extension://${extensionId}/src/pages/options/index.html` }
          : sender,
      );
    },
    async download() {
      return readReply(
        await handler(
          {
            type: 'gv.sync.download',
            payload: {
              platform: 'gemini',
              selection: 'all',
              interactive: false,
              includeHighlights: true,
              highlightAccountScope: ACCOUNT,
            },
          },
          sender,
        ),
      );
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('background download highlight undo', () => {
  it('applies highlights before replying and extends that same snapshot for the caller restore', async () => {
    const d = await device();
    const before = d.userValues();
    const result = await d.download();
    expect(result).toMatchObject({
      ok: true,
      highlights: { status: 'found', synced: true, count: 2 },
    });
    const captured = await d.snapshot.readCloudSyncSnapshot();
    expect(captured?.id).toBe(result.snapshotId);
    expect(await d.highlightAnnotationService.getAll(SCOPE)).toHaveLength(2);
    if (!captured) throw new Error('Expected the background snapshot');
    await d.applyCloudRestore({
      mode: 'overwrite',
      highlightsRestored: true,
      storageUpdate: { [StorageKeys.FOLDER_DATA]: CLOUD_FOLDERS },
      snapshot: captured.context,
      snapshotId: captured.id,
    });
    expect((await d.snapshot.readCloudSyncSnapshot())?.id).toBe(captured.id);

    expect(await d.snapshot.undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      kept: [],
    });
    expect(d.userValues()).toEqual(before);
    expect(d.stored[getHighlightBucketStorageKey(SCOPE, 'new')]).toBeUndefined();
  });

  it('does not apply a highlight or replace the previous snapshot when metadata preflight fails', async () => {
    const d = await device();
    const before = d.userValues();
    const snapshot = await d.snapshot.captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [],
    });
    d.failures.metadata = true;
    vi.useFakeTimers();
    const outcome = d.download().catch((error: unknown) => ({ ok: false, error }));
    await d.metadataEntered.promise;
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ ok: false });
    expect(d.userValues()).toEqual(before);
    expect((await d.snapshot.readCloudSyncSnapshot())?.id).toBe(snapshot.id);
  });

  it('reports a receipt failure without any canonical highlight write', async () => {
    const d = await device();
    const before = d.userValues();
    d.failures.receipt = true;
    expect(await d.download()).toMatchObject({ ok: false, error: 'snapshot_receipt_failed' });
    expect(d.userValues()).toEqual(before);
  });

  it('reports unrecognized folders and highlights without applying either kind', async () => {
    const d = await device();
    const before = d.userValues();
    d.drive.files.set(HIGHLIGHTS, '{');
    d.drive.files.set(FOLDERS, '{');
    expect(await d.download()).toMatchObject({
      ok: true,
      data: { folders: null, kindStatus: { folders: 'unrecognized' } },
      highlights: { status: 'unrecognized', synced: false },
    });
    expect(d.userValues()).toEqual(before);
  });

  it('skips a valid highlight envelope belonging to a different site', async () => {
    const d = await device();
    const before = d.userValues();
    d.drive.put(HIGHLIGHTS, {
      ...payload([]),
      accountScope: { platform: 'aistudio', accountHash: getHighlightAccountHash(SCOPE) },
      items: [{ ...record('other-site'), platform: 'aistudio' }],
    });
    expect(await d.download()).toMatchObject({
      ok: true,
      highlights: { status: 'unrecognized', synced: false },
    });
    expect(d.userValues()).toEqual(before);
  });

  it('records the recognized outline only, and a different sender cannot consume its completion ticket', async () => {
    const d = await device();
    const recognized = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
    const unrecognized = 'gemini-voyager-timeline-hierarchy.site-claude.json';
    const key = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
    const bucket = {
      conversations: {
        chat: {
          conversationUrl: 'https://chatgpt.com/c/chat',
          levels: { turn: 1 },
          collapsed: [],
          updatedAt: 1,
        },
      },
    };
    d.drive.put(recognized, {
      format: 'gemini-voyager.catalog-timeline-hierarchy.v1',
      site: 'chatgpt',
      data: { [key]: bucket },
    });
    // Valid JSON reaches metadata tracking, but its unknown envelope must never become a baseline.
    d.drive.put(unrecognized, { format: 'future-outline', site: 'claude', data: {} });
    const result = await d.download();
    expect(result).toMatchObject({
      ok: true,
      catalogStatus: {
        chatgpt: { timelineHierarchy: 'found' },
        claude: { timelineHierarchy: 'unrecognized' },
      },
    });
    const captured = await d.snapshot.readCloudSyncSnapshot();
    if (!captured) throw new Error('Expected the background snapshot');
    await d.applyCloudRestore({
      mode: 'merge',
      highlightsRestored: true,
      storageUpdate: { [key]: bucket },
      storageParts: ['outlines'],
      snapshot: captured.context,
      snapshotId: captured.id,
    });
    expect(await d.complete(result.operationId, true)).toEqual({
      ok: false,
      error: 'stale_download',
    });
    expect(d.stored[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
    expect(await d.complete(result.operationId)).toMatchObject({ ok: true, recorded: true });
    const baselines = Object.values(readReply(d.stored[StorageKeys.CLOUD_SYNC_BOOKKEEPING])).map(
      readReply,
    );
    expect(baselines.some((file) => file.name === recognized)).toBe(true);
    expect(baselines.some((file) => file.name === unrecognized)).toBe(false);
    expect(await d.complete(result.operationId)).toEqual({ ok: false, error: 'stale_download' });
  });
});
