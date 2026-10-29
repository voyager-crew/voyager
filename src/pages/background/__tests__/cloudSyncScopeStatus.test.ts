import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  createScopeSyncDevice,
  SYNC_TEST_CATALOG_FILE,
  SYNC_TEST_CATALOG_KEY,
  SYNC_TEST_EXTENSION,
  SYNC_TEST_FOLDER_FILE,
  SYNC_TEST_PROMPTS_FILE,
  syncTestEnvelope,
  syncTestFolders,
  syncTestPrompt,
} from './cloudSyncScopeHarness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sync scope through real background handlers', () => {
  it('site access re-includes its row without changing another row or the settings backup', async () => {
    const d = await createScopeSyncDevice();
    const { setSyncScopeRow, markSiteIncluded } = await import('@/core/services/CloudSyncScope');
    await setSyncScopeRow({ kind: 'shared' }, false);
    await setSyncScopeRow({ kind: 'site', siteId: 'chatgpt' }, false);
    await setSyncScopeRow({ kind: 'site', siteId: 'claude' }, false);
    await markSiteIncluded('chatgpt');
    expect(d.values[StorageKeys.CLOUD_SYNC_SCOPE]).toEqual({
      shared: false,
      sites: { chatgpt: true, claude: false },
    });
    const { exportBackupableSyncSettings } = await import('@/core/services/SettingsBackupService');
    const backup = await exportBackupableSyncSettings();
    expect(backup.data).not.toHaveProperty(StorageKeys.CLOUD_SYNC_SCOPE);
    expect(backup.data).toEqual({ [StorageKeys.CHAT_WIDTH]: 82 });
  });
  it.each([
    undefined,
    { shared: 'bad', sites: { gemini: false } },
    { shared: false, sites: { gemini: 'bad' } },
  ])('missing or malformed scope preserves the full existing upload (%j)', async (scope) => {
    const d = await createScopeSyncDevice();
    if (scope !== undefined) d.values[StorageKeys.CLOUD_SYNC_SCOPE] = scope;
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(SYNC_TEST_FOLDER_FILE)).toMatchObject({
      data: syncTestFolders('Local'),
    });
    expect(d.drive.payload(SYNC_TEST_PROMPTS_FILE)).toMatchObject({
      items: [syncTestPrompt('local')],
    });
    expect(d.drive.payload('gemini-voyager-settings.json')).toMatchObject({
      data: { [StorageKeys.CHAT_WIDTH]: 82 },
    });
    expect(d.drive.payload('gemini-voyager-plugins.json')).toMatchObject({
      data: { 'test.plugin': { enabled: true } },
    });
  });

  it.each([
    'gv.sync.upload',
    'gv.sync.download',
    'gv.sync.catalogTimeline.push',
    'gv.sync.catalogTimeline.pull',
  ])('refuses an explicit excluded site at the background boundary for %s', async (type) => {
    const d = await createScopeSyncDevice();
    d.values[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: true, sites: { chatgpt: false } };
    d.catalog();
    const before = new Map(d.drive.files);
    await expect(
      d.request(type, { platform: 'chatgpt', selection: 'site' }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'sync_scope_excluded',
      excludedRows: [{ kind: 'site', siteId: 'chatgpt' }],
    });
    expect(d.drive.files).toEqual(before);
    expect(d.requests).toEqual([]);
  });

  it.each(['gv.sync.catalogTimeline.pull', 'gv.sync.catalogTimeline.push'])(
    'a ChatGPT content sender cannot redirect %s to Claude',
    async (type) => {
      const d = await createScopeSyncDevice();
      d.catalog();
      const claudeKey = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}claude`;
      const claudeFile = 'gemini-voyager-timeline-hierarchy.site-claude.json';
      const claudeData = {
        conversations: {
          private: {
            conversationUrl: 'https://claude.ai/chat/private',
            levels: { turn: 2 },
            collapsed: [],
            updatedAt: 1,
          },
        },
      };
      d.values[claudeKey] = claudeData;
      d.drive.put(claudeFile, {
        ...syncTestEnvelope('gemini-voyager.catalog-timeline-hierarchy.v1', {
          [claudeKey]: claudeData,
        }),
        site: 'claude',
      });
      d.drive.put(SYNC_TEST_CATALOG_FILE, {
        ...syncTestEnvelope('gemini-voyager.catalog-timeline-hierarchy.v1', {
          [SYNC_TEST_CATALOG_KEY]: d.values[SYNC_TEST_CATALOG_KEY],
        }),
        site: 'chatgpt',
      });
      const sender = { id: SYNC_TEST_EXTENSION, url: 'https://chatgpt.com/c/local' };
      const beforeCloud = new Map(d.drive.files);
      const beforeLocal = structuredClone(d.values);
      await expect(
        d.request(type, { selection: 'site', platform: 'claude' }, sender),
      ).resolves.toMatchObject({ ok: false, error: 'untrusted_sender' });
      expect(d.drive.files).toEqual(beforeCloud);
      expect(d.values).toEqual(beforeLocal);
      expect(d.requests).toEqual([]);

      const own = await d.request(type, { selection: 'site', platform: 'chatgpt' }, sender);
      expect(own).toMatchObject({ ok: true });
      if (type.endsWith('.pull'))
        expect(own).toMatchObject({
          buckets: { [SYNC_TEST_CATALOG_KEY]: d.values[SYNC_TEST_CATALOG_KEY] },
        });
      else
        expect(d.drive.payload(SYNC_TEST_CATALOG_FILE)).toMatchObject({
          data: { [SYNC_TEST_CATALOG_KEY]: d.values[SYNC_TEST_CATALOG_KEY] },
        });
      expect(d.drive.files.get(claudeFile)).toBe(beforeCloud.get(claudeFile));
      expect(d.values[claudeKey]).toEqual(claudeData);
    },
  );

  it.each(['gv.sync.pullPromptsMerge', 'gv.sync.pushPromptsMerge'])(
    'refuses shared-off prompt operation %s',
    async (type) => {
      const d = await createScopeSyncDevice();
      d.values[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: false, sites: {} };
      const before = structuredClone(d.values);
      await expect(d.request(type)).resolves.toMatchObject({
        ok: false,
        error: 'sync_scope_excluded',
      });
      expect(d.values).toEqual(before);
      expect(d.drive.files.size).toBe(0);
      expect(d.requests).toEqual([]);
    },
  );

  it('site-only folder upload ignores all shared files and other-site catalog data', async () => {
    const d = await createScopeSyncDevice();
    d.catalog();
    d.values[StorageKeys.PROMPT_ITEMS] = { malformed: 'excluded prompt storage' };
    d.values[StorageKeys.PLUGINS_STATE] = { malformed: 'excluded plugin storage' };
    const catalogBefore = d.drive.files.get(SYNC_TEST_CATALOG_FILE);
    await expect(
      d.request(
        'gv.sync.upload',
        { selection: 'site' },
        {
          id: SYNC_TEST_EXTENSION,
          url: 'https://gemini.google.com/app/test',
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(d.drive.files.get(SYNC_TEST_CATALOG_FILE)).toBe(catalogBefore);
    expect([...new Set(d.drive.writes)].sort()).toEqual(
      [
        'gemini-voyager-folders.json',
        'gemini-voyager-forks.json',
        'gemini-voyager-timeline-hierarchy.json',
        'gemini-voyager-stars.json',
        'gemini-voyager-starred.json',
      ].sort(),
    );
    expect(d.drive.files.has(SYNC_TEST_PROMPTS_FILE)).toBe(false);
    expect(d.drive.files.has('gemini-voyager-settings.json')).toBe(false);
    expect(d.drive.files.has('gemini-voyager-plugins.json')).toBe(false);
    expect(d.drive.payload(SYNC_TEST_FOLDER_FILE)).toMatchObject({
      data: syncTestFolders('Local'),
    });
  });

  it('shared off skips prompts, settings and plugins in popup upload and download', async () => {
    const d = await createScopeSyncDevice();
    d.values[StorageKeys.CLOUD_SYNC_SCOPE] = { shared: false, sites: {} };
    for (const name of [
      SYNC_TEST_PROMPTS_FILE,
      'gemini-voyager-settings.json',
      'gemini-voyager-plugins.json',
    ])
      d.drive.files.set(name, '{');
    const before = new Map(d.drive.files);
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({
      ok: true,
      selection: { shared: false },
    });
    for (const [name, body] of before) expect(d.drive.files.get(name)).toBe(body);
    await expect(d.request('gv.sync.download')).resolves.toMatchObject({
      ok: true,
      selection: { shared: false },
      data: { prompts: null, settings: null, plugins: null },
    });
    expect(
      d.requests.filter(
        (url) =>
          url.searchParams.get('alt') === 'media' &&
          [...before.keys()].includes(url.pathname.split('/').at(-1) ?? ''),
      ),
    ).toEqual([]);
  });

  it('popup skips its excluded site while syncing shared and leaves excluded catalog files untouched', async () => {
    const d = await createScopeSyncDevice();
    d.catalog();
    d.values[StorageKeys.CLOUD_SYNC_SCOPE] = {
      shared: true,
      sites: { gemini: false, chatgpt: false },
    };
    d.drive.put(
      SYNC_TEST_FOLDER_FILE,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud only')),
    );
    const folderBefore = d.drive.files.get(SYNC_TEST_FOLDER_FILE);
    const catalogBefore = d.drive.files.get(SYNC_TEST_CATALOG_FILE);
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({
      ok: true,
      selection: { site: false, shared: true },
    });
    expect(d.drive.files.get(SYNC_TEST_FOLDER_FILE)).toBe(folderBefore);
    expect(d.drive.files.get(SYNC_TEST_CATALOG_FILE)).toBe(catalogBefore);
    expect(d.drive.payload(SYNC_TEST_PROMPTS_FILE)).toMatchObject({
      items: [syncTestPrompt('local')],
    });
    await expect(d.request('gv.sync.download')).resolves.toMatchObject({
      ok: true,
      selection: { site: false },
      data: { folders: null },
    });
    await expect(
      d.request('gv.sync.getStatus', { rows: ['gemini', 'chatgpt'] }),
    ).resolves.toMatchObject({
      ok: true,
      rows: [
        { row: 'gemini', status: 'excluded' },
        { row: 'chatgpt', status: 'excluded' },
      ],
    });
    expect(
      d.requests.filter(
        (url) =>
          url.searchParams.get('alt') === 'media' &&
          [SYNC_TEST_FOLDER_FILE, SYNC_TEST_CATALOG_FILE].includes(
            url.pathname.split('/').at(-1) ?? '',
          ),
      ),
    ).toEqual([]);
  });

  it('a failing catalog outline read preserves every cloud file in the combined popup upload', async () => {
    const d = await createScopeSyncDevice();
    d.catalog();
    d.drive.put(
      SYNC_TEST_FOLDER_FILE,
      syncTestEnvelope('gemini-voyager.folders.v1', syncTestFolders('Cloud')),
    );
    d.drive.failReads.add(SYNC_TEST_CATALOG_FILE);
    const before = new Map(d.drive.files);
    const pending = d.request('gv.sync.upload');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(d.drive.files).toEqual(before);
    expect(d.drive.writes).toEqual([]);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });

  it('a failed local catalog outline discovery aborts the complete upload before writes', async () => {
    const d = await createScopeSyncDevice();
    d.catalog();
    d.failLocal(SYNC_TEST_CATALOG_KEY);
    const before = new Map(d.drive.files);
    await expect(d.request('gv.sync.upload')).resolves.toEqual({
      ok: false,
      error: 'local_read_failed',
    });
    expect(d.drive.files).toEqual(before);
    expect(d.drive.writes).toEqual([]);
  });
});

describe('scope-row status through real background handlers', () => {
  it('reports every status from uploads and edits using metadata-only reads', async () => {
    const d = await createScopeSyncDevice();
    const status = () => d.request('gv.sync.getStatus', { rows: ['shared'] });
    await expect(status()).resolves.toMatchObject({
      ok: true,
      rows: [{ row: 'shared', status: 'not_uploaded' }],
    });
    d.drive.put(SYNC_TEST_PROMPTS_FILE, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('cloud')],
    });
    await expect(status()).resolves.toMatchObject({ ok: true, rows: [{ status: 'to_merge' }] });
    await expect(d.request('gv.sync.upload', { selection: 'shared' })).resolves.toMatchObject({
      ok: true,
    });
    const reads = d.requests.filter((url) => url.searchParams.get('alt') === 'media').length;
    const metadataStart = d.requests.length;
    await expect(status()).resolves.toMatchObject({
      ok: true,
      rows: [{ status: 'synced', bothChanged: false }],
    });
    d.values[StorageKeys.PROMPT_ITEMS] = [syncTestPrompt('local-edit')];
    await expect(status()).resolves.toMatchObject({
      rows: [{ status: 'newer_here', bothChanged: false }],
    });
    d.values[StorageKeys.PROMPT_ITEMS] = [syncTestPrompt('local')];
    d.drive.put(SYNC_TEST_PROMPTS_FILE, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('cloud-edit')],
    });
    await expect(status()).resolves.toMatchObject({
      rows: [{ status: 'newer_in_cloud', bothChanged: false }],
    });
    d.values[StorageKeys.PROMPT_ITEMS] = [syncTestPrompt('local-edit')];
    await expect(status()).resolves.toMatchObject({
      rows: [{ status: 'newer_in_cloud', bothChanged: true }],
    });
    expect(d.requests.filter((url) => url.searchParams.get('alt') === 'media')).toHaveLength(reads);
    expect(
      d.requests
        .slice(metadataStart)
        .some(
          (url) =>
            url.pathname.endsWith(`/files/${SYNC_TEST_PROMPTS_FILE}`) &&
            url.searchParams.get('fields')?.includes('md5Checksum'),
        ),
    ).toBe(true);
  });

  it('keeps the last complete bookkeeping after a partial upload', async () => {
    const d = await createScopeSyncDevice();
    await expect(d.request('gv.sync.upload', { selection: 'shared' })).resolves.toMatchObject({
      ok: true,
    });
    const before = structuredClone(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]);
    d.values[StorageKeys.PROMPT_ITEMS] = [syncTestPrompt('new')];
    // An unchanged settings file now needs no PATCH; fail a real changed-file write.
    d.syncValues[StorageKeys.CHAT_WIDTH] = 81;
    d.drive.failWrites.add('gemini-voyager-settings.json');
    const pending = d.request('gv.sync.upload', { selection: 'shared' });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(d.drive.payload(SYNC_TEST_PROMPTS_FILE)).toMatchObject({
      items: [syncTestPrompt('new')],
    });
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toEqual(before);
  });

  it('reports an unconfirmed account without downloading or creating a baseline', async () => {
    const d = await createScopeSyncDevice();
    d.syncValues[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = true;
    await expect(
      d.request('gv.sync.getStatus', {
        rows: ['gemini'],
        accountScope: { accountKey: 'route:1', accountId: 1, routeUserId: '1' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      rows: [{ row: 'gemini', status: 'account_unconfirmed', files: [] }],
    });
    expect(d.requests).toEqual([]);
    expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
  });
});
