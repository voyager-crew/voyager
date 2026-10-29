import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';
import { HIGHLIGHT_EXPORT_FORMAT, HIGHLIGHT_INDEX_KEY_PREFIX } from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

const extensionId = 'sync-safety-extension';
const promptsFile = 'gemini-voyager-prompts.json';
const foldersFile = 'gemini-voyager-folders.json';
const hierarchyFile = 'gemini-voyager-timeline-hierarchy.json';
const pluginsFile = 'gemini-voyager-plugins.json';
const highlightScope: SyncAccountScope = {
  accountKey: 'email:person',
  accountId: 2,
  routeUserId: '2',
};
const highlightHash = hashString(highlightScope.accountKey);
const highlightsFile = `gemini-voyager-highlights.acct-${highlightHash}.json`;
const catalogOutlineFile = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
const catalogStarsFile = 'gemini-voyager-stars.site-chatgpt.json';
const catalogKey = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
const timestamp = '2026-10-28T00:00:00.000Z';
const prompt = (id: string) => ({ id, text: `${id} text`, tags: [], createdAt: 1 });
const folders = (name: string) => ({
  folders: [{ id: 'folder', name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
  folderContents: {},
});
const hierarchy = (id: string) => ({
  conversations: {
    [id]: {
      conversationUrl: `https://gemini.google.com/app/${id}`,
      levels: { turn: 2 },
      collapsed: [],
      updatedAt: 1,
    },
  },
});
const envelope = (format: string, data: unknown) => ({
  format,
  exportedAt: timestamp,
  version: '2.2.1',
  data,
});
const promptEnvelope = (id: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: timestamp,
  version: '2.2.1',
  items: [prompt(id)],
});

/** Real owners/service with only their browser storage and HTTP boundaries replaced. */
async function device() {
  const values: Record<string, unknown> = {
    gvSyncMode: 'disabled',
    gvAccessToken: 'already-authorized-test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.FOLDER_DATA]: folders('Local folders'),
    [StorageKeys.PROMPT_ITEMS]: [prompt('local')],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: hierarchy('local'),
    [StorageKeys.PLUGINS_STATE]: { 'test.plugin': { enabled: true, installedAt: 1 } },
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
  };
  const seedFiles = new Map<string, string>([
    [foldersFile, JSON.stringify(envelope('gemini-voyager.folders.v1', folders('Cloud folders')))],
    [promptsFile, JSON.stringify(promptEnvelope('cloud'))],
    [
      'gemini-voyager-settings.json',
      JSON.stringify(envelope('gemini-voyager.settings.v1', { gvTheme: 'light' })),
    ],
    [
      pluginsFile,
      JSON.stringify(
        envelope('gemini-voyager.plugins.v1', {
          'cloud.plugin': { enabled: false, installedAt: 1 },
        }),
      ),
    ],
    [
      'gemini-voyager-forks.json',
      JSON.stringify(envelope('gemini-voyager.forks.v1', { nodes: {}, groups: {} })),
    ],
    [
      hierarchyFile,
      JSON.stringify(envelope('gemini-voyager.timeline-hierarchy.v1', hierarchy('cloud'))),
    ],
    [
      'gemini-voyager-starred.json',
      JSON.stringify(envelope('gemini-voyager.starred.v1', { messages: {} })),
    ],
    [
      'gemini-voyager-stars.json',
      JSON.stringify({
        format: 'gemini-voyager.stars.v2',
        exportedAt: timestamp,
        version: '2.2.1',
        items: [],
        tombstones: [],
      }),
    ],
  ]);
  const fakeDrive = new FakeSyncDrive();
  const drive = fakeDrive.files;
  for (const [name, body] of seedFiles) drive.set(name, body);
  let failedLocalKey: string | null = null;
  let failedCloudFile: string | null = null;
  let driveWrites = 0;
  const area = {
    get: vi.fn(async (keys: unknown) => {
      const names =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys ?? values);
      if (failedLocalKey !== null && names.includes(failedLocalKey)) {
        throw new Error('Storage unavailable');
      }
      const defaults =
        typeof keys === 'object' && keys !== null && !Array.isArray(keys) ? keys : {};
      return structuredClone({
        ...defaults,
        ...Object.fromEntries(
          names
            .filter((key) => typeof key === 'string' && key in values)
            .map((key) => [key, values[key]]),
        ),
      });
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
    remove: vi.fn(async () => {}),
  };
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    },
    storage: {
      local: area,
      sync: {
        get: vi.fn(async () => ({ [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false })),
        set: vi.fn(async () => {}),
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        driveWrites += 1;
      }
      if (url.searchParams.get('alt') === 'media' && name === failedCloudFile) {
        throw new TypeError('Network unavailable');
      }
      return fakeDrive.fetch(input, init);
    }),
  );
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../cloudSyncMessages');
  const { createForkMessagesOwner } = await import('../forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const { googleDriveSyncService } = await import('@/core/services/GoogleDriveSyncService');
  const starStore = createStarStore(area);
  const forksOwner = createForkMessagesOwner(area);
  const handle = createCloudSyncMessageHandler({
    getAllStarredMessages: starStore.getAll,
    getAllForkNodes: forksOwner.getAllForkNodes,
    starStore,
  });
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/src/pages/popup/index.html`,
  };
  return {
    values,
    drive,
    starStore,
    service: googleDriveSyncService,
    failLocal: (key: string) => {
      failedLocalKey = key;
    },
    failCloud: (name: string) => {
      failedCloudFile = name;
    },
    writes: () => driveWrites,
    request: (type: string, payload: Record<string, unknown> = {}) =>
      handle({ type, payload: { platform: 'gemini', interactive: false, ...payload } }, sender),
  };
}

async function addCatalogData(browser: Awaited<ReturnType<typeof device>>) {
  const local = {
    conversationUrl: 'https://chatgpt.com/c/local',
    levels: { localTurn: 2 },
    collapsed: [],
    updatedAt: 1,
  };
  browser.values[catalogKey] = { conversations: { local } };
  browser.drive.set(
    catalogOutlineFile,
    JSON.stringify({
      format: 'gemini-voyager.catalog-timeline-hierarchy.v1',
      exportedAt: timestamp,
      version: '2.2.1',
      site: 'chatgpt',
      data: {
        [catalogKey]: {
          conversations: { cloud: { ...local, conversationUrl: 'https://chatgpt.com/c/cloud' } },
        },
      },
    }),
  );
  browser.drive.set(
    catalogStarsFile,
    JSON.stringify({
      format: 'gemini-voyager.stars.v2',
      exportedAt: timestamp,
      version: '2.2.1',
      items: [],
      tombstones: [],
    }),
  );
  await browser.starStore.add({
    conversationId: 'chatgpt:conv:local',
    conversationUrl: 'https://chatgpt.com/c/local',
    turnId: 'saved',
    content: 'Local star',
    starredAt: 1,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cloud sync read safety through the background handler', () => {
  it('does not replace cloud prompts with local-only prompts when the cloud read fails', async () => {
    const browser = await device();
    browser.failCloud(promptsFile);
    const beforeDrive = new Map(browser.drive);
    const beforeStorage = structuredClone(browser.values);
    const result = browser.request('gv.sync.pushPromptsMerge');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.values).toEqual(beforeStorage);
    expect(browser.writes()).toBe(0);
  });

  it.each([
    ['plugins', StorageKeys.PLUGINS_STATE],
    ['forks', StorageKeys.FORK_NODES],
    ['prompts', StorageKeys.PROMPT_ITEMS],
    ['hierarchy', StorageKeys.TIMELINE_HIERARCHY],
  ])(
    'a failed local %s read preserves every Drive file for the whole upload',
    async (_kind, key) => {
      const browser = await device();
      browser.failLocal(key);
      const beforeDrive = new Map(browser.drive);
      const beforeStorage = structuredClone(browser.values);
      await expect(browser.request('gv.sync.upload')).resolves.toEqual({
        ok: false,
        error: 'local_read_failed',
      });
      expect(browser.drive).toEqual(beforeDrive);
      expect(browser.values).toEqual(beforeStorage);
      expect(browser.writes()).toBe(0);
    },
  );

  it('a successful full upload replaces the fake Drive files with the actual local data', async () => {
    const browser = await device();
    await expect(browser.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(browser.drive.get(foldersFile)!).data).toEqual(folders('Local folders'));
    expect(JSON.parse(browser.drive.get(promptsFile)!).items).toEqual([prompt('local')]);
    expect(JSON.parse(browser.drive.get(pluginsFile)!).data).toEqual({
      'test.plugin': { enabled: true, installedAt: 1 },
    });
    expect(JSON.parse(browser.drive.get(hierarchyFile)!).data).toEqual(hierarchy('local'));
    expect(browser.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
    expect(browser.writes()).toBeGreaterThan(0);
  });

  it.each([null, 'unreadable', { plugin: { enabled: 'yes' } }])(
    'refuses an unrecognized local plugin value instead of uploading an empty map (%j)',
    async (raw) => {
      const browser = await device();
      browser.values[StorageKeys.PLUGINS_STATE] = raw;
      const beforeDrive = new Map(browser.drive);
      await expect(browser.request('gv.sync.upload')).resolves.toEqual({
        ok: false,
        error: 'local_read_failed',
      });
      expect(browser.drive).toEqual(beforeDrive);
      expect(browser.values[StorageKeys.PLUGINS_STATE]).toEqual(raw);
      expect(browser.writes()).toBe(0);
    },
  );

  it('keeps legacy plugin entries without installedAt and their scalar settings uploadable', async () => {
    const browser = await device();
    const raw = {
      plugin: {
        enabled: true,
        settings: { text: '', count: 2, checked: false },
        futureField: { untouched: true },
      },
    };
    browser.values[StorageKeys.PLUGINS_STATE] = raw;
    await expect(browser.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(browser.drive.get(pluginsFile)!)).toMatchObject({
      data: {
        plugin: { enabled: true, installedAt: 0, settings: { text: '', count: 2, checked: false } },
      },
    });
    expect(browser.values[StorageKeys.PLUGINS_STATE]).toEqual(raw);
  });

  it('a later star merge read failure leaves earlier folder and shared files intact', async () => {
    const browser = await device();
    browser.failCloud('gemini-voyager-stars.json');
    const beforeDrive = new Map(browser.drive);
    const result = browser.request('gv.sync.upload');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.writes()).toBe(0);
  });

  it('a failed highlight cloud read aborts the full upload before any other Drive file changes', async () => {
    const browser = await device();
    browser.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
    browser.drive.set(
      highlightsFile,
      JSON.stringify({
        format: HIGHLIGHT_EXPORT_FORMAT,
        exportedAt: timestamp,
        version: '2.2.1',
        accountScope: { platform: 'gemini', accountHash: highlightHash },
        items: [],
      }),
    );
    browser.failCloud(highlightsFile);
    const beforeDrive = new Map(browser.drive);
    const beforeStorage = structuredClone(browser.values);
    const result = browser.request('gv.sync.upload', {
      includeHighlights: true,
      highlightAccountScope: highlightScope,
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.values).toEqual(beforeStorage);
    expect(browser.writes()).toBe(0);
  });

  it('a failed local highlight read aborts the full upload before any other Drive file changes', async () => {
    const browser = await device();
    browser.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
    browser.failLocal(`${HIGHLIGHT_INDEX_KEY_PREFIX}${highlightHash}`);
    const beforeDrive = new Map(browser.drive);
    const beforeStorage = structuredClone(browser.values);
    await expect(
      browser.request('gv.sync.upload', {
        includeHighlights: true,
        highlightAccountScope: highlightScope,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.values).toEqual(beforeStorage);
    expect(browser.writes()).toBe(0);
  });

  it('a failed catalog star cloud read also preserves the catalog timeline file', async () => {
    const browser = await device();
    await addCatalogData(browser);
    browser.failCloud(catalogStarsFile);
    const beforeDrive = new Map(browser.drive);
    const result = browser.request('gv.sync.catalogTimeline.push');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.writes()).toBe(0);
  });

  it('a successful catalog upload merges timeline and stars into their actual Drive files', async () => {
    const browser = await device();
    await addCatalogData(browser);
    await expect(browser.request('gv.sync.catalogTimeline.push')).resolves.toMatchObject({
      ok: true,
    });
    expect(JSON.parse(browser.drive.get(catalogOutlineFile)!)).toMatchObject({
      data: {
        [catalogKey]: {
          conversations: {
            local: { conversationUrl: 'https://chatgpt.com/c/local' },
            cloud: { conversationUrl: 'https://chatgpt.com/c/cloud' },
          },
        },
      },
    });
    expect(JSON.parse(browser.drive.get(catalogStarsFile)!)).toMatchObject({
      items: [{ conversationId: 'chatgpt:conv:local', turnId: 'saved', content: 'Local star' }],
    });
  });

  it('refuses malformed cloud JSON instead of merging it as an empty prompt library', async () => {
    const browser = await device();
    browser.drive.set(promptsFile, '{invalid');
    const beforeDrive = new Map(browser.drive);
    const beforeStorage = structuredClone(browser.values);
    await expect(browser.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({ ok: false });
    expect(browser.drive).toEqual(beforeDrive);
    expect(browser.values).toEqual(beforeStorage);
    expect(browser.writes()).toBe(0);
  });

  it('treats zero-byte prompts as missing and uploads the intact local library', async () => {
    const browser = await device();
    browser.drive.set(promptsFile, '');
    await expect(
      browser.service.runExclusive((port) => port.downloadPromptsOnly(null, false)),
    ).resolves.toEqual({
      kind: 'missing',
    });
    await expect(browser.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(browser.drive.get(promptsFile)!).items).toEqual([prompt('local')]);
    expect(browser.values[StorageKeys.PROMPT_ITEMS]).toEqual([prompt('local')]);
  });

  it('distinguishes a missing cloud file from a failed download', async () => {
    const browser = await device();
    browser.drive.delete(promptsFile);
    await expect(
      browser.service.runExclusive((port) => port.downloadPromptsOnly(null, false)),
    ).resolves.toEqual({
      kind: 'missing',
    });
    browser.drive.set(promptsFile, JSON.stringify(promptEnvelope('cloud')));
    browser.failCloud(promptsFile);
    const failed = browser.service.runExclusive((port) => port.downloadPromptsOnly(null, false));
    await vi.runAllTimersAsync();
    await expect(failed).resolves.toMatchObject({ kind: 'failed' });
    expect(browser.writes()).toBe(0);
  });
});
