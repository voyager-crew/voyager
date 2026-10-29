import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { PromptExportPayload, PromptItem } from '@/core/types/sync';
import { createStarStore } from '@/features/savedLibrary/starStore';
import type { StarsExportPayloadV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import {
  CATALOG_TIMELINE_HIERARCHY_FORMAT,
  type CatalogTimelineHierarchyExportPayload,
} from '@/features/timeline/catalogHierarchySync';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { createDriveTestClient } from './fixtures/driveTestClient';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const PROMPTS = 'gemini-voyager-prompts.json';
const TIMELINE = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
const CLAUDE_TIMELINE = 'gemini-voyager-timeline-hierarchy.site-claude.json';
const STARS = 'gemini-voyager-stars.site-chatgpt.json';
const CLAUDE_STARS = 'gemini-voyager-stars.site-claude.json';
const CHATGPT_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
const CLAUDE_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}claude`;

const prompt = (id: string): PromptItem => ({ id, text: id, tags: [], createdAt: 1 });
const prompts = (items: PromptItem[]): PromptExportPayload => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: '2026-10-28T00:00:00.000Z',
  items,
});
const outline = (id: string) => ({
  conversationUrl: `https://chatgpt.com/c/${id}`,
  levels: { [`turn-${id}`]: 2 as const },
  collapsed: [],
  updatedAt: 1,
});
const buckets = (id: string) => ({
  [CHATGPT_KEY]: { conversations: { [id]: outline(id) } },
});
const star = (id: string): StarredMessage => ({
  conversationId: `chatgpt:conv:${id}`,
  conversationUrl: `https://chatgpt.com/c/${id}`,
  turnId: `turn-${id}`,
  content: id,
  starredAt: 1,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function device() {
  const local = createSyncStorage({ [StorageKeys.PROMPT_ITEMS]: [prompt('local')] });
  const sync = createSyncStorage();
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      getURL: (path: string) => `chrome-extension://sync-safety/${path}`,
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) => callback('token'),
    },
    storage: { local: local.area, sync: sync.area },
  });
  return {
    service: createDriveTestClient(new GoogleDriveSyncService()),
    store: createStarStore(local.area),
    values: local.values,
  };
}

let drive: FakeSyncDrive;

beforeEach(() => {
  vi.useFakeTimers();
  drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prompts-only read safety', () => {
  it.each([
    { body: undefined, kind: 'missing' },
    { body: '', kind: 'missing' },
    { body: '{', kind: 'unrecognized' },
    { body: '{"format":"unrelated","items":[]}', kind: 'unrecognized' },
    { body: 'null', kind: 'unrecognized' },
  ])(
    'distinguishes $kind for a cloud body "$body" without changing local data',
    async ({ body, kind }) => {
      if (body !== undefined) drive.files.set(PROMPTS, body);
      const before = new Map(drive.files);
      const d = device();

      await expect(d.service.downloadPromptsOnly()).resolves.toEqual({ kind });

      expect(drive.files).toEqual(before);
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
    },
  );

  it.each([prompts([]), { items: [] }])(
    'recognizes a compatible empty prompts envelope as found: %j',
    async (payload) => {
      drive.put(PROMPTS, payload);
      const d = device();

      await expect(d.service.downloadPromptsOnly()).resolves.toMatchObject({
        kind: 'found',
        value: { items: [] },
      });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
    },
  );

  it('reports a failed read distinctly and lets the next operation upload', async () => {
    drive.put(PROMPTS, prompts([prompt('cloud')]));
    drive.failReads.add(PROMPTS);
    const d = device();
    const first = d.service.downloadPromptsOnly();
    const next = d.service.uploadPromptsOnly([prompt('next')]);

    await vi.runAllTimersAsync();

    await expect(first).resolves.toMatchObject({ kind: 'failed' });
    await expect(next).resolves.toBe(true);
    expect(drive.payload<PromptExportPayload>(PROMPTS).items).toEqual([prompt('next')]);
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
  });
});

it('a download started beside an upload sees that upload, not the previous cloud copy', async () => {
  drive.put(PROMPTS, prompts([prompt('old')]));
  const d = device();
  const writing = deferred();
  const finishWrite = deferred();
  drive.beforeWrite = async (name) => {
    if (name !== PROMPTS) return;
    writing.resolve();
    await finishWrite.promise;
  };

  const uploaded = d.service.uploadPromptsOnly([prompt('new')]);
  await writing.promise;
  const downloaded = d.service.downloadPromptsOnly();
  finishWrite.resolve();

  await expect(uploaded).resolves.toBe(true);
  await expect(downloaded).resolves.toMatchObject({
    kind: 'found',
    value: { items: [prompt('new')] },
  });
  expect(drive.payload<PromptExportPayload>(PROMPTS).items).toEqual([prompt('new')]);
});

it('a rejected composite releases its queue turn for the next sync', async () => {
  drive.put(PROMPTS, prompts([prompt('old')]));
  const d = device();
  const entered = deferred();
  const release = deferred();
  const failed = d.service.runExclusive(async () => {
    entered.resolve();
    await release.promise;
    throw new Error('Merge rejected');
  });
  const rejected = expect(failed).rejects.toThrow('Merge rejected');
  await entered.promise;
  const next = d.service.uploadPromptsOnly([prompt('after')]);
  release.resolve();

  await rejected;
  await expect(next).resolves.toBe(true);
  expect(drive.payload<PromptExportPayload>(PROMPTS).items).toEqual([prompt('after')]);
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
});

it('signing out during a prompt merge prevents that composite from uploading its old cloud data', async () => {
  drive.put(PROMPTS, prompts([prompt('cloud')]));
  const before = new Map(drive.files);
  const d = device();
  const merging = deferred();
  const resumeMerge = deferred();
  const oldSync = d.service.runExclusive(async (transfer) => {
    const cloud = await transfer.downloadPromptsOnly();
    if (cloud.kind !== 'found') throw new Error('Expected cloud prompts');
    merging.resolve();
    await resumeMerge.promise;
    return transfer.uploadPromptsOnly([...cloud.value.items, prompt('stale-merge')]);
  });
  const cancelled = expect(oldSync).rejects.toThrow();
  await merging.promise;

  await d.service.signOut();
  resumeMerge.resolve();

  await cancelled;
  expect(drive.files).toEqual(before);
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
  await expect(d.service.uploadPromptsOnly([prompt('fresh-session')])).resolves.toBe(true);
  expect(drive.payload<PromptExportPayload>(PROMPTS).items).toEqual([prompt('fresh-session')]);
});

it('signing out during a cloud read refuses the stale response and releases the queue', async () => {
  drive.put(PROMPTS, prompts([prompt('old-session')]));
  const before = new Map(drive.files);
  const d = device();
  const reading = deferred();
  const finishRead = deferred();
  drive.beforeRead = async (name) => {
    if (name !== PROMPTS) return;
    reading.resolve();
    await finishRead.promise;
  };
  const oldRead = d.service.downloadPromptsOnly();
  await reading.promise;

  await d.service.signOut();
  finishRead.resolve();

  await expect(oldRead).resolves.toMatchObject({ kind: 'failed' });
  expect(drive.files).toEqual(before);
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
  await expect(d.service.uploadPromptsOnly([prompt('after-sign-out')])).resolves.toBe(true);
  expect(drive.payload<PromptExportPayload>(PROMPTS).items).toEqual([prompt('after-sign-out')]);
});

it('one composite retains its turn across prompt merge, catalog timeline and star transfers', async () => {
  drive.put(PROMPTS, prompts([prompt('cloud')]));
  const d = device();
  const entered = deferred();
  const release = deferred();
  const composite = d.service.runExclusive(async (transfer) => {
    const cloud = await transfer.downloadPromptsOnly();
    if (cloud.kind !== 'found') throw new Error('Expected cloud prompts');
    entered.resolve();
    await release.promise;
    const merged = [...cloud.value.items, prompt('inside')];
    await chrome.storage.local.set({ [StorageKeys.PROMPT_ITEMS]: merged });
    if (!(await transfer.uploadPromptsOnly(merged))) return false;
    if (!(await transfer.uploadCatalogData({ chatgpt: buckets('inside') }, undefined, [])))
      return false;
    await d.store.add(star('inside'));
    return transfer.uploadCatalogData({}, d.store, ['chatgpt']);
  });
  await entered.promise;

  const promptDownload = d.service.downloadPromptsOnly();
  const timelineUpload = d.service.uploadCatalogTimeline({ chatgpt: buckets('outside') });
  const starUpload = d.service.syncCatalogStars(d.store, ['chatgpt']);
  const timelineDownload = d.service.downloadCatalogTimeline(['chatgpt']);
  const starDownload = d.service.downloadCatalogStars(['chatgpt']);
  await vi.advanceTimersByTimeAsync(0);

  // Other syncs must not create or change Drive files while the merge is still in progress.
  expect(drive.files).toEqual(new Map([[PROMPTS, JSON.stringify(prompts([prompt('cloud')]))]]));
  release.resolve();

  await expect(composite).resolves.toBe(true);
  await expect(promptDownload).resolves.toMatchObject({
    kind: 'found',
    value: { items: [prompt('cloud'), prompt('inside')] },
  });
  await expect(timelineUpload).resolves.toBe(true);
  await expect(starUpload).resolves.toBe(true);
  await expect(timelineDownload).resolves.toEqual({
    [CHATGPT_KEY]: { conversations: { inside: outline('inside'), outside: outline('outside') } },
  });
  await expect(starDownload).resolves.toMatchObject({ chatgpt: { items: [star('inside')] } });
  expect(drive.payload<CatalogTimelineHierarchyExportPayload>(TIMELINE).data).toEqual({
    [CHATGPT_KEY]: { conversations: { inside: outline('inside'), outside: outline('outside') } },
  });
  expect(drive.payload<StarsExportPayloadV2>(STARS).items).toEqual([star('inside')]);
  expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('cloud'), prompt('inside')]);
  expect(d.values[StorageKeys.SAVED_LIBRARY_STARS]).toMatchObject({
    messages: { 'chatgpt:conv:inside': [star('inside')] },
  });
});

describe.each(['timeline', 'stars'] as const)('multi-site %s uploads', (kind) => {
  it('leaves every Drive file unchanged when a later site cannot be read', async () => {
    const d = device();
    if (kind === 'timeline') {
      drive.put(TIMELINE, {
        format: CATALOG_TIMELINE_HIERARCHY_FORMAT,
        site: 'chatgpt',
        data: buckets('cloud'),
      });
      drive.put(CLAUDE_TIMELINE, {
        format: CATALOG_TIMELINE_HIERARCHY_FORMAT,
        site: 'claude',
        data: { [CLAUDE_KEY]: { conversations: {} } },
      });
      drive.failReads.add(CLAUDE_TIMELINE);
    } else {
      const payload = {
        format: 'gemini-voyager.stars.v2',
        exportedAt: '2026-10-28T00:00:00.000Z',
        version: '2.2.1',
        items: [],
        tombstones: [],
      };
      drive.put(STARS, payload);
      drive.put(CLAUDE_STARS, payload);
      drive.failReads.add(CLAUDE_STARS);
      await d.store.add(star('local'));
    }
    const before = new Map(drive.files);
    const pending =
      kind === 'timeline'
        ? d.service.uploadCatalogTimeline({
            chatgpt: buckets('local'),
            claude: { [CLAUDE_KEY]: { conversations: {} } },
          })
        : d.service.syncCatalogStars(d.store, ['chatgpt', 'claude']);

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(false);
    expect(drive.files).toEqual(before);
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
  });
});
