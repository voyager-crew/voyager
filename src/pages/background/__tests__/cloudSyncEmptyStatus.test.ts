import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createScopeSyncDevice, syncTestPrompt } from './cloudSyncScopeHarness';

async function emptyDevice() {
  const d = await createScopeSyncDevice();
  d.values[StorageKeys.FOLDER_DATA] = { folders: [], folderContents: {} };
  d.values[StorageKeys.PROMPT_ITEMS] = [];
  d.values[StorageKeys.PLUGINS_STATE] = {};
  delete d.syncValues[StorageKeys.CHAT_WIDTH];
  return d;
}

type StatusReply = {
  ok: boolean;
  rows: {
    row: string;
    status: string;
    files: {
      name: string;
      status: string;
      localChanged: boolean;
      cloudChanged: boolean;
      metadata: unknown;
      syncedAt: number | null;
    }[];
  }[];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('empty local sync rows', () => {
  it.each([
    { row: 'shared', key: StorageKeys.PROMPT_ITEMS, value: { corrupt: true } },
    { row: 'shared', key: StorageKeys.PLUGINS_STATE, value: ['corrupt'] },
    { row: 'gemini', key: StorageKeys.FOLDER_DATA, value: null },
    { row: 'gemini', key: StorageKeys.FORK_NODES, value: { nodes: 'corrupt', groups: {} } },
    { row: 'gemini', key: StorageKeys.TIMELINE_HIERARCHY, value: { conversations: 'corrupt' } },
    { row: 'gemini', key: StorageKeys.SAVED_LIBRARY_STARS, value: { corrupt: true } },
    { row: 'gemini', key: StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES, value: [{ corrupt: true }] },
    {
      row: 'chatgpt',
      key: `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`,
      value: { conversations: 'corrupt' },
    },
  ])('does not label unreadable $key as empty and synced', async ({ row, key, value }) => {
    const d = await emptyDevice();
    d.values[key] = value;
    const before = structuredClone(d.values);
    const result = (await d.request('gv.sync.getStatus', { rows: [row] })) as StatusReply;
    expect(result.rows[0].status).not.toBe('synced');
    expect(d.values).toEqual(before);
    expect(d.drive.files.size).toBe(0);
  });

  it('reports nothing pending for every empty local kind with no cloud file, without writes or media reads', async () => {
    const d = await emptyDevice();
    const local = structuredClone(d.values);
    const sync = structuredClone(d.syncValues);
    const result = (await d.request('gv.sync.getStatus', {
      rows: ['shared', 'gemini', 'aistudio', 'chatgpt'],
    })) as StatusReply;
    expect(result.ok).toBe(true);
    expect(result.rows.map(({ row, status }) => ({ row, status }))).toEqual([
      { row: 'shared', status: 'synced' },
      { row: 'gemini', status: 'synced' },
      { row: 'aistudio', status: 'synced' },
      { row: 'chatgpt', status: 'synced' },
    ]);
    for (const file of result.rows.flatMap(({ files }) => files))
      expect(file).toMatchObject({
        status: 'synced',
        localChanged: false,
        cloudChanged: false,
        metadata: null,
        syncedAt: null,
      });
    expect(d.requests.some((url) => url.searchParams.get('alt') === 'media')).toBe(false);
    expect(d.drive.files.size).toBe(0);
    expect(d.values).toEqual(local);
    expect(d.syncValues).toEqual(sync);
  });

  it('still reports an existing cloud file to merge, and a later cloud edit as newer', async () => {
    const d = await emptyDevice();
    const name = 'gemini-voyager-prompts.json';
    d.drive.put(name, { format: 'gemini-voyager.prompts.v1', items: [] });
    const status = () => d.request('gv.sync.getStatus', { rows: ['shared'] });
    await expect(status()).resolves.toMatchObject({ ok: true, rows: [{ status: 'to_merge' }] });
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({ ok: true });
    await expect(status()).resolves.toMatchObject({ ok: true, rows: [{ status: 'synced' }] });
    d.drive.put(name, {
      format: 'gemini-voyager.prompts.v1',
      items: [syncTestPrompt('new-cloud')],
    });
    await expect(status()).resolves.toMatchObject({
      ok: true,
      rows: [{ status: 'newer_in_cloud' }],
    });
  });

  it.each(['gemini', 'chatgpt'] as const)(
    'keeps %s star deletions pending even with no live star',
    async (site) => {
      const d = await emptyDevice();
      const url =
        site === 'gemini'
          ? 'https://gemini.google.com/app/deleted'
          : 'https://chatgpt.com/c/deleted';
      const conversationId = `${site}:conv:deleted`;
      await d.stars.add({
        conversationId,
        conversationUrl: url,
        turnId: 'turn',
        content: 'deleted',
        starredAt: 1,
      });
      await d.stars.remove(conversationId, 'turn');
      const result = (await d.request('gv.sync.getStatus', { rows: [site] })) as StatusReply;
      expect(result.rows[0].status).toBe('not_uploaded');
      const name =
        site === 'gemini' ? 'gemini-voyager-stars.json' : 'gemini-voyager-stars.site-chatgpt.json';
      expect(result.rows[0].files.find((file) => file.name === name)?.status).toBe('not_uploaded');
    },
  );

  it('keeps catalog outline deletion markers pending', async () => {
    const d = await emptyDevice();
    d.values[`${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`] = {
      conversations: {},
      deleted: { removed: Date.now() },
    };
    const result = (await d.request('gv.sync.getStatus', { rows: ['chatgpt'] })) as StatusReply;
    expect(
      result.rows[0].files.find(
        ({ name }) => name === 'gemini-voyager-timeline-hierarchy.site-chatgpt.json',
      )?.status,
    ).toBe('not_uploaded');
  });

  it('treats empty highlights as settled but keeps an account clear marker pending', async () => {
    const d = await emptyDevice();
    const account = { accountKey: 'email:empty-status', accountId: 1, routeUserId: '1' };
    d.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
    const status = () =>
      d.request('gv.sync.getStatus', { rows: ['gemini'], highlightAccountScope: account });
    await expect(status()).resolves.toMatchObject({ ok: true, rows: [{ status: 'synced' }] });
    const { highlightAnnotationService } =
      await import('@/core/services/HighlightAnnotationService');
    await highlightAnnotationService.clearAll({ ...account, platform: 'gemini' });
    const result = (await status()) as StatusReply;
    expect(
      result.rows[0].files.find(({ name }) => name.startsWith('gemini-voyager-highlights.'))
        ?.status,
    ).toBe('not_uploaded');
  });
});
