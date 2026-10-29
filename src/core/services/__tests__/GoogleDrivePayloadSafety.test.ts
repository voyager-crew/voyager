import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { CATALOG_TIMELINE_HIERARCHY_FORMAT } from '@/features/timeline/catalogHierarchySync';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const scope: SyncAccountScope = { accountKey: 'legacy-person', accountId: 2, routeUserId: '2' };
const scoped = (name: string) =>
  name.replace(/\.json$/, `.acct-${hashString(scope.accountKey)}.json`);
const exportedAt = '2026-10-29T00:00:00.000Z';
const prompts = [{ id: 'legacy', text: 'Legacy prompt', tags: [], createdAt: 1 }];
const folders = {
  folders: [
    {
      id: 'legacy',
      name: 'Legacy folder',
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: {},
};
const forks = {
  nodes: {
    saved: [
      {
        conversationId: 'saved',
        conversationUrl: 'https://gemini.google.com/u/2/app/saved',
        turnId: 'turn',
        forkGroupId: 'group',
        forkIndex: 0,
        createdAt: 1,
      },
    ],
  },
  groups: { group: ['saved:turn'] },
};
const hierarchy = {
  conversations: {
    saved: {
      conversationUrl: 'https://gemini.google.com/u/2/app/saved',
      levels: { turn: 2 as const },
      collapsed: [],
      updatedAt: 1,
    },
  },
};
const starred = {
  messages: {
    saved: [
      {
        conversationId: 'saved',
        conversationUrl: 'https://gemini.google.com/u/2/app/saved',
        turnId: 'turn',
        content: 'Legacy star',
        starredAt: 1,
      },
    ],
  },
};
const promptPayload = { format: 'gemini-voyager.prompts.v1', exportedAt, items: prompts };
const envelope = (format: string, data: unknown) => ({
  format,
  exportedAt,
  version: '2.2.1',
  data,
});
const PROMPTS = 'gemini-voyager-prompts.json';
const AI_FOLDERS = 'gemini-voyager-aistudio-folders.json';
const SETTINGS = 'gemini-voyager-settings.json';
const PLUGINS = 'gemini-voyager-plugins.json';

function device(drive: FakeSyncDrive) {
  const local = createSyncStorage({
    gvSyncMode: 'disabled',
    gvAccessToken: 'cached-test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.PROMPT_ITEMS]: prompts,
  });
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      getURL: (path: string) => `chrome-extension://payload-safety/${path}`,
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) =>
        callback('test-token'),
    },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  vi.stubGlobal('fetch', drive.fetch);
  return {
    service: new GoogleDriveSyncService(),
    values: local.values,
    store: createStarStore(local.area),
  };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('empty scoped Drive media', () => {
  it.each([
    ['folders', 'gemini-voyager-folders.json', envelope('gemini-voyager.folders.v1', folders)],
    ['prompts', PROMPTS, promptPayload],
    ['forks', 'gemini-voyager-forks.json', envelope('gemini-voyager.forks.v1', forks)],
    [
      'timelineHierarchy',
      'gemini-voyager-timeline-hierarchy.json',
      envelope('gemini-voyager.timeline-hierarchy.v1', hierarchy),
    ],
    ['starred', 'gemini-voyager-starred.json', envelope('gemini-voyager.starred.v1', starred)],
  ] as const)(
    'full download falls back to legacy %s when scoped media is empty',
    async (field, name, payload) => {
      const drive = new FakeSyncDrive();
      drive.put(name, payload);
      drive.files.set(scoped(name), '');
      const d = device(drive);
      const result = await d.service.runExclusive((port) =>
        port.download(false, 'gemini', scope, scope),
      );
      expect(result?.[field]).toEqual(payload);
    },
  );

  it('prompts-only download reads legacy items behind an empty scoped file', async () => {
    const drive = new FakeSyncDrive();
    drive.put(PROMPTS, promptPayload);
    drive.files.set(scoped(PROMPTS), '');
    const d = device(drive);
    const result = await d.service.runExclusive((port) => port.downloadPromptsOnly(scope, false));
    expect(result).toMatchObject({ kind: 'found', value: { items: prompts } });
  });

  it('does not treat malformed scoped prompts as missing and expose the legacy fallback', async () => {
    const drive = new FakeSyncDrive();
    drive.put(PROMPTS, promptPayload);
    drive.files.set(scoped(PROMPTS), '{invalid');
    const d = device(drive);
    const result = await d.service.runExclusive((port) => port.downloadPromptsOnly(scope, false));
    expect(result).toEqual({ kind: 'unrecognized' });
  });
});

describe('whole upload file discovery', () => {
  it.each(['existing', 'missing'] as const)(
    'a later file search failure preserves earlier %s targets before any content writes or creates',
    async (condition) => {
      const drive = new FakeSyncDrive();
      for (const name of [AI_FOLDERS, PROMPTS, SETTINGS, PLUGINS]) {
        drive.put(name, { kept: name });
      }
      if (condition === 'missing') {
        drive.files.delete(AI_FOLDERS);
        drive.files.delete(PROMPTS);
      }
      const d = device(drive);
      const beforeDrive = new Map(drive.files);
      const beforeLocal = structuredClone(d.values);
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const query = url.searchParams.get('q') ?? '';
        if (
          url.pathname === '/drive/v3/files' &&
          !query.startsWith('(') &&
          query.includes(`name='${PLUGINS}'`)
        )
          return Response.json({}, { status: 503 });
        return drive.fetch(input, init);
      });
      const result = await d.service.runExclusive((port) =>
        port.upload(
          folders,
          prompts,
          null,
          false,
          'aistudio',
          null,
          null,
          null,
          null,
          { gvTheme: 'dark' },
          { plugin: { enabled: true, installedAt: 1 } },
        ),
      );
      expect(result).toBe(false);
      expect(drive.files).toEqual(beforeDrive);
      expect(d.values).toEqual(beforeLocal);
    },
  );

  it('a successful plan writes every AI Studio content file after discovery', async () => {
    const drive = new FakeSyncDrive();
    for (const name of [AI_FOLDERS, PROMPTS, SETTINGS, PLUGINS]) drive.put(name, { kept: name });
    const d = device(drive);
    const result = await d.service.runExclusive((port) =>
      port.upload(
        folders,
        prompts,
        null,
        false,
        'aistudio',
        null,
        null,
        null,
        null,
        { gvTheme: 'dark' },
        { plugin: { enabled: true, installedAt: 1 } },
      ),
    );
    expect(result).toBe(true);
    expect(drive.payload(AI_FOLDERS)).toMatchObject({ data: folders });
    expect(drive.payload(PROMPTS)).toMatchObject({ items: prompts });
    expect(drive.payload(SETTINGS)).toMatchObject({ data: { gvTheme: 'dark' } });
    expect(drive.payload(PLUGINS)).toMatchObject({
      data: { plugin: { enabled: true, installedAt: 1 } },
    });
  });

  it('a late star target lookup failure leaves ordinary Gemini files intact', async () => {
    const drive = new FakeSyncDrive();
    const folderName = 'gemini-voyager-folders.json';
    const v1Name = 'gemini-voyager-starred.json';
    const v2Name = 'gemini-voyager-stars.json';
    drive.put(folderName, envelope('gemini-voyager.folders.v1', folders));
    drive.put(PROMPTS, promptPayload);
    drive.put(v1Name, envelope('gemini-voyager.starred.v1', { messages: {} }));
    drive.put(v2Name, { format: 'gemini-voyager.stars.v2', exportedAt, items: [], tombstones: [] });
    const d = device(drive);
    const saved = {
      conversationId: 'gemini:conv:saved',
      conversationUrl: 'https://gemini.google.com/app/saved',
      turnId: 'saved-turn',
      content: 'Keep this star',
      starredAt: 1,
    };
    await d.store.add(saved);
    const beforeDrive = new Map(drive.files);
    let v1Finds = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (
        url.pathname === '/drive/v3/files' &&
        !query.startsWith('(') &&
        query.includes(`name='${v1Name}'`)
      ) {
        v1Finds += 1;
        if (v1Finds > 1) return Response.json({}, { status: 503 });
      }
      return drive.fetch(input, init);
    });
    const result = await d.service.runExclusive((port) =>
      port.upload(
        folders,
        prompts,
        { messages: {} },
        false,
        'gemini',
        null,
        null,
        null,
        null,
        null,
        null,
        d.store,
      ),
    );
    expect(result).toBe(false);
    expect(drive.files).toEqual(beforeDrive);
    expect((await d.store.getAll()).messages[saved.conversationId]).toEqual([saved]);
  });

  it('a later catalog target search failure leaves every earlier target unchanged', async () => {
    const drive = new FakeSyncDrive();
    const bySite: Record<string, Record<string, typeof hierarchy>> = {};
    for (const site of ['chatgpt', 'claude']) {
      const key = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}${site}`;
      const name = `gemini-voyager-timeline-hierarchy.site-${site}.json`;
      bySite[site] = { [key]: hierarchy };
      drive.put(name, {
        format: CATALOG_TIMELINE_HIERARCHY_FORMAT,
        exportedAt,
        site,
        data: { [key]: { conversations: {} } },
      });
    }
    const d = device(drive);
    const beforeDrive = new Map(drive.files);
    const beforeLocal = structuredClone(d.values);
    let claudeFinds = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (
        url.pathname === '/drive/v3/files' &&
        !query.startsWith('(') &&
        query.includes("name='gemini-voyager-timeline-hierarchy.site-claude.json'")
      ) {
        claudeFinds += 1;
        // Reading the source succeeds; resolving the target before commit fails.
        if (claudeFinds > 1) return Response.json({}, { status: 503 });
      }
      return drive.fetch(input, init);
    });
    const result = await d.service.runExclusive((port) =>
      port.uploadCatalogData(bySite, undefined, [], false),
    );
    expect(result).toBe(false);
    expect(drive.files).toEqual(beforeDrive);
    expect(d.values).toEqual(beforeLocal);
  });
});
