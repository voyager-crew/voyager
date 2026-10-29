import { afterEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { readSyncBookkeeping } from '../CloudSyncBookkeeping';
import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import type { DriveTransferSelection } from '../GoogleDriveTransferSelection';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';
import { createHighlightPayload } from './fixtures/googleDriveServiceFixture';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const promptsFile = 'gemini-voyager-prompts.json';
const foldersFile = 'gemini-voyager-folders.json';
const catalogFile = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
const prompt = (id: string) => ({ id, text: id, tags: [], createdAt: 1 });

function device() {
  const local = createSyncStorage();
  const sync = createSyncStorage();
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      getURL: (path: string) => `chrome-extension://bookkeeping/${path}`,
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) => callback('token'),
    },
    storage: { local: local.area, sync: sync.area },
  });
  const drive = new FakeSyncDrive();
  const mediaReads: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.searchParams.get('alt') === 'media') mediaReads.push(url.pathname);
    return drive.fetch(input, init);
  });
  const service = new GoogleDriveSyncService();
  const upload = (items = [prompt('one')]) =>
    service.runExclusive(async (port) => {
      const ok = await port.uploadPromptsOnly(items);
      if (ok) await port.commitBookkeeping();
      return ok;
    });
  const status = (items = [prompt('one')]) =>
    service.runExclusive((port) =>
      port.getFileStatus([{ row: 'shared', name: promptsFile, content: items }]),
    );
  const uploadSelection = (selection: DriveTransferSelection) =>
    service.runExclusive((port) =>
      port.upload(
        { folders: [], folderContents: {} },
        [prompt('one')],
        null,
        true,
        'gemini',
        null,
        { conversations: {} },
        null,
        null,
        {},
        {},
        undefined,
        {},
        undefined,
        selection,
      ),
    );
  return { service, local, drive, mediaReads, upload, status, uploadSelection };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reports no file, first cloud merge, synced, local, cloud and both changes without downloading status media', async () => {
  const d = device();
  expect((await d.status())[0].status).toBe('not_uploaded');
  d.drive.put(promptsFile, { format: 'gemini-voyager.prompts.v1', items: [prompt('remote')] });
  expect((await d.status())[0].status).toBe('to_merge');
  await expect(d.upload()).resolves.toBe(true);
  const readsAfterUpload = d.mediaReads.length;
  expect((await d.status())[0].status).toBe('synced');
  expect((await d.status([prompt('two')]))[0]).toMatchObject({
    status: 'newer_here',
    localChanged: true,
    cloudChanged: false,
  });
  d.drive.put(promptsFile, { format: 'gemini-voyager.prompts.v1', items: [prompt('cloud-edit')] });
  expect((await d.status())[0]).toMatchObject({
    status: 'newer_in_cloud',
    localChanged: false,
    cloudChanged: true,
  });
  expect((await d.status([prompt('two')]))[0]).toMatchObject({
    status: 'newer_in_cloud',
    localChanged: true,
    cloudChanged: true,
  });
  expect(d.mediaReads.length).toBe(readsAfterUpload);
});

it('keeps the last complete baseline after a partial multi-file operation', async () => {
  const d = device();
  await d.upload();
  const before = structuredClone(d.local.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]);
  vi.useFakeTimers();
  d.drive.failWrites.add('gemini-voyager-settings.json');
  const failed = d.service.runExclusive(async (port) => {
    const result = await port.upload(
      { folders: [], folderContents: {} },
      [prompt('two')],
      null,
      true,
      'gemini',
      null,
      null,
      null,
      null,
      {},
      null,
    );
    if (result.kind === 'uploaded') await port.commitBookkeeping();
    return result;
  });
  await vi.runAllTimersAsync();
  expect(await failed).toEqual({ kind: 'failed' });
  expect(d.drive.payload<{ items: unknown[] }>(promptsFile).items).toEqual([prompt('two')]);
  expect(d.local.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toEqual(before);
});

it('retains separate baselines for same-named files in different connected Drive accounts', async () => {
  const d = device();
  await d.upload();
  const first = await readSyncBookkeeping();
  const oldMetadata = d.drive.metadata.get(promptsFile)!;
  d.drive.metadata.set(promptsFile, { ...oldMetadata, id: 'second-account-file' });
  d.drive.files.set('second-account-file', d.drive.files.get(promptsFile)!);
  d.drive.metadata.set('second-account-file', { ...oldMetadata, id: 'second-account-file' });
  expect((await d.status())[0].status).toBe('to_merge');
  await d.upload();
  const baselines = d.local.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING];
  expect(baselines).toMatchObject(first);
  expect(Object.keys(baselines as object)).toHaveLength(2);
  expect((await d.status())[0].status).toBe('synced');
});

it('commits an apply baseline using the actual merged local content and metadata seen by the download', async () => {
  const d = device();
  d.drive.put(promptsFile, { format: 'gemini-voyager.prompts.v1', items: [prompt('remote')] });
  const downloaded = await d.service.runExclusive(async (port) => {
    port.beginDownloadBookkeeping();
    await port.downloadPromptsOnly();
    return port.getDownloadBookkeeping();
  });
  const merged = [prompt('local'), prompt('remote')];
  await d.service.runExclusive((port) =>
    port.commitAppliedBookkeeping(downloaded.map((file) => ({ ...file, content: merged }))),
  );
  expect((await d.status(merged))[0].status).toBe('synced');
  expect((await d.status([prompt('remote')]))[0].status).toBe('newer_here');
});

it('keeps a cloud edit after the downloaded body newer than the completed apply', async () => {
  const d = device();
  // The read receipt follows Drive's bytes, including formatting this build did not generate.
  d.drive.files.set(
    promptsFile,
    '{ "format": "gemini-voyager.prompts.v1", "items": [{ "id":"one", "text":"one", "tags":[], "createdAt":1 }] }',
  );
  const fetch = globalThis.fetch;
  let edited = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const url = new URL(String(input));
    if (!edited && url.searchParams.get('alt') === 'media' && url.pathname.endsWith(promptsFile)) {
      edited = true;
      d.drive.put(promptsFile, {
        format: 'gemini-voyager.prompts.v1',
        items: [prompt('later-cloud-edit')],
      });
    }
    return response;
  });
  const downloaded = await d.service.runExclusive(async (port) => {
    port.beginDownloadBookkeeping();
    expect(await port.downloadPromptsOnly()).toMatchObject({
      kind: 'found',
      value: { items: [prompt('one')] },
    });
    return port.getDownloadBookkeeping();
  });
  await d.service.runExclusive((port) =>
    port.commitAppliedBookkeeping(
      downloaded.map((file) => ({ ...file, content: [prompt('one')] })),
    ),
  );
  expect((await d.status())[0]).toMatchObject({
    status: 'newer_in_cloud',
    localChanged: false,
    cloudChanged: true,
  });
});

it('keeps another device’s overwrite after the upload newer than the uploaded version', async () => {
  const d = device();
  const fetch = globalThis.fetch;
  let edited = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const url = new URL(String(input));
    if (
      !edited &&
      url.pathname.startsWith('/upload/drive/v3/files/') &&
      url.pathname.endsWith(promptsFile)
    ) {
      edited = true;
      d.drive.put(promptsFile, {
        format: 'gemini-voyager.prompts.v1',
        items: [prompt('other-device')],
      });
    }
    return response;
  });
  expect(await d.upload()).toBe(true);
  expect((await d.status())[0]).toMatchObject({
    status: 'newer_in_cloud',
    localChanged: false,
    cloudChanged: true,
  });
});

it('reports uploaded route-first highlights as synced when the local owner has no clear marker', async () => {
  const d = device();
  const scope = { accountKey: 'route:2', accountId: 2, routeUserId: '2' };
  d.local.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
    profiles: { 'route:2': { emailHash: 'confirmed-person' } },
  };
  const payload = createHighlightPayload(scope);
  await d.service.runExclusive(async (port) => {
    expect(await port.uploadHighlightsOnly(payload, scope)).toBe(true);
    await port.commitBookkeeping();
  });
  const result = await d.service.runExclusive((port) =>
    port.getFileStatus([
      {
        row: 'gemini',
        name: 'gemini-voyager-highlights.json',
        accountScope: scope,
        content: { ...payload, clearMarker: undefined },
      },
    ]),
  );
  expect(result[0].status).toBe('synced');
});

it('uses the captured local projection for a merged catalog upload while retaining the uploaded content hash', async () => {
  const d = device();
  const key = 'gvCatalogTimelineHierarchy:chatgpt';
  const remote = {
    [key]: {
      conversations: {
        remote: {
          levels: { turn: 2 },
          collapsed: [],
          updatedAt: 1,
          conversationUrl: 'https://chatgpt.com/c/remote',
        },
      },
    },
  };
  d.drive.put(catalogFile, {
    format: 'gemini-voyager.catalog-timeline-hierarchy.v1',
    exportedAt: '2026-10-29T00:00:00Z',
    version: '2',
    site: 'chatgpt',
    data: remote,
  });
  const request = { row: 'chatgpt', name: catalogFile, content: {} };
  await d.service.runExclusive(async (port) => {
    expect(await port.uploadCatalogData({ chatgpt: {} }, undefined, [])).toBe(true);
    await port.commitBookkeeping([request]);
  });
  const baselines = Object.values(await readSyncBookkeeping());
  expect(baselines[0].contentHash).not.toBe(baselines[0].localContentHash);
  expect((await d.service.runExclusive((port) => port.getFileStatus([request])))[0].status).toBe(
    'synced',
  );
});

it('preflights a catalog outline with the folder upload before any cloud write', async () => {
  const d = device();
  d.drive.put(foldersFile, {
    format: 'gemini-voyager.folders.v1',
    data: { folders: [], folderContents: {} },
  });
  d.drive.files.set(catalogFile, '{');
  const before = [...d.drive.files];
  expect(
    await d.uploadSelection({ catalog: { outlines: { chatgpt: {} }, starSites: [] } }),
  ).toEqual({ kind: 'failed' });
  expect([...d.drive.files]).toEqual(before);
  expect(d.drive.writes).toEqual([]);
});

it('a folder-only selection uploads and downloads only its folders and hierarchy', async () => {
  const d = device();
  const selection = { shared: false, conversationExtras: false, timelineHierarchy: true };
  expect(await d.uploadSelection(selection)).toEqual({ kind: 'uploaded' });
  expect([...d.drive.files.keys()].sort()).toEqual([
    foldersFile,
    'gemini-voyager-timeline-hierarchy.json',
  ]);
  d.drive.files.set(promptsFile, '{');
  const result = await d.service.runExclusive((port) =>
    port.download(true, 'gemini', null, null, selection),
  );
  expect(result).toMatchObject({
    folders: { data: { folders: [], folderContents: {} } },
    prompts: null,
    settings: null,
    plugins: null,
  });
  expect(result?.kindStatus).toEqual({ folders: 'found', timelineHierarchy: 'found' });
});

it('keeps unrecognized payload status distinct from missing and aborts a failed read', async () => {
  const d = device();
  d.drive.files.set(promptsFile, '{');
  d.drive.put('gemini-voyager-plugins.json', { format: 'future-plugins', data: {} });
  const data = await d.service.runExclusive((port) => port.download());
  expect(data?.kindStatus).toMatchObject({
    folders: 'missing',
    prompts: 'unrecognized',
    plugins: 'unrecognized',
  });
  vi.useFakeTimers();
  d.drive.failFinds.add(foldersFile);
  expect(await d.service.runExclusive((port) => port.download())).toBeNull();
});

it('leaves excluded catalog stars in their old cloud compatibility copy without importing or uploading local edits', async () => {
  const d = device();
  const excluded: StarredMessage = {
    conversationId: 'chatgpt:conv:old',
    conversationUrl: 'https://chatgpt.com/c/old',
    turnId: 'old',
    content: 'cloud',
    starredAt: 1,
  };
  d.drive.put(
    'gemini-voyager-stars.json',
    buildStarsV2(
      { data: { messages: { [excluded.conversationId]: [excluded] } }, tombstones: [] },
      null,
      'old',
    ),
  );
  const store = createStarStore(d.local.area);
  await store.add({ ...excluded, content: 'local change', starredAt: 2 });
  const outcome = await d.service.runExclusive(async (port) => {
    const result = await port.upload(
      { folders: [], folderContents: {} },
      [],
      null,
      true,
      'gemini',
      null,
      null,
      null,
      null,
      null,
      null,
      store,
      {},
      undefined,
      { includedCatalogSites: [] },
    );
    if (result.kind === 'uploaded') await port.commitBookkeeping();
    return result;
  });
  expect(outcome).toEqual({ kind: 'uploaded' });
  expect(d.drive.payload<{ items: StarredMessage[] }>('gemini-voyager-stars.json').items).toEqual([
    excluded,
  ]);
  expect([...d.drive.files.keys()].some((name) => name.includes('stars.site-chatgpt'))).toBe(false);
  expect((await store.getAll()).messages[excluded.conversationId][0].content).toBe('local change');
  const status = await d.service.runExclusive((port) =>
    port.getFileStatus([
      {
        row: 'gemini',
        name: 'gemini-voyager-stars.json',
        content: buildStarsV2({ data: { messages: {} }, tombstones: [] }, null, ''),
      },
      { row: 'gemini', name: 'gemini-voyager-starred.json', content: { messages: {} } },
    ]),
  );
  expect(status.map((file) => file.status)).toEqual(['synced', 'synced']);
  const downloaded = await d.service.runExclusive((port) =>
    port.download(true, 'gemini', null, null, { includedCatalogSites: [] }),
  );
  expect(downloaded?.stars?.items).toEqual([]);
  expect(downloaded?.starred?.data.messages).toEqual({});
});

it('reports unrecognized catalog kinds independently and aborts failed catalog reads', async () => {
  const d = device();
  d.drive.files.set(catalogFile, '{');
  const report = await d.service.runExclusive((port) =>
    port.downloadCatalogDataResult(['chatgpt', 'claude']),
  );
  expect(report).toEqual({
    outlines: {},
    stars: {},
    statuses: {
      chatgpt: { timelineHierarchy: 'unrecognized', stars: 'missing' },
      claude: { timelineHierarchy: 'missing', stars: 'missing' },
    },
  });
  d.drive.failFinds.add(catalogFile);
  expect(
    await d.service.runExclusive((port) => port.downloadCatalogDataResult(['chatgpt'])),
  ).toBeNull();
});

it('notices a newer Drive modification time even when media content is unchanged', async () => {
  const d = device();
  await d.upload();
  const before = d.drive.metadata.get(promptsFile);
  if (!before) throw new Error('Missing uploaded metadata');
  d.drive.metadata.set(promptsFile, { ...before, modifiedTime: '2099-01-01T00:00:00Z' });
  const reads = d.mediaReads.length;
  expect((await d.status())[0]).toMatchObject({
    status: 'newer_in_cloud',
    localChanged: false,
    cloudChanged: true,
  });
  expect(d.mediaReads.length).toBe(reads);
});
