import { createHash } from 'node:crypto';
/**
 * Cloud sync of Nimbus, a site the bundle describes only by data
 * (`verbs/folders/__tests__/dataSiteCatalog.ts`), through the background's
 * sync messages and a fetch-level Drive: its folders travel in a Drive file
 * named after its id, only for a tab on its own bundled host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderData } from '@/core/types/folder';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { DATA_SITE } from '@/features/plugins/verbs/folders/__tests__/dataSiteCatalog';
import { CATALOG_TIMELINE_PUSH_MESSAGE } from '@/features/timeline/catalogHierarchySync';

vi.mock('@/features/plugins/catalog/sites', async (importOriginal) =>
  (await import('@/features/plugins/verbs/folders/__tests__/dataSiteCatalog')).catalogWithDataSite(
    await importOriginal(),
  ),
);

const EXPORTED_AT = '2026-10-03T12:00:00.000Z';
const NOW = Date.parse(EXPORTED_AT);
const folders: FolderData = {
  folders: [
    { id: 'f1', name: 'Work', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 2 },
  ],
  folderContents: {
    f1: [
      {
        conversationId: 'nimbus:conv:abc-1',
        title: 'Alpha',
        url: 'https://chat.nimbus.test/c/abc-1',
        addedAt: 3,
      },
    ],
  },
};

function createBoundaries(initial: Record<string, unknown>) {
  const storage = { ...initial };
  const media = new Map<string, string>();
  const uploaded: string[] = [];
  const folder = {
    id: 'backup-folder',
    name: 'Voyager Data',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { voyagerDataFolder: '1' },
  };
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
      if (keys === null) return { ...values };
      const requested =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const defaults = !Array.isArray(keys) && typeof keys === 'object' ? keys : {};
      return {
        ...defaults,
        ...Object.fromEntries(requested.filter((k) => k in values).map((k) => [k, values[k]])),
      };
    }),
    set: vi.fn(async (updates: Record<string, unknown>) => {
      Object.assign(values, updates);
    }),
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      lastError: null,
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    },
    identity: {
      getAuthToken: vi.fn((_details: unknown, callback: (token: string) => void) =>
        callback('test-oauth-token'),
      ),
    },
    storage: { local: area(storage), sync: area({}) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
        return Response.json({ id: (JSON.parse(String(init.body)) as { name: string }).name });
      }
      if (url.pathname === '/drive/v3/files') {
        if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
          return Response.json({ files: [folder] });
        }
        if (query.startsWith('(')) return Response.json({ files: [] });
        const name = /name='([^']+)'/.exec(query)?.[1];
        return Response.json({ files: name && media.has(name) ? [{ id: name, name }] : [] });
      }
      if (url.pathname === '/drive/v3/files/backup-folder') return Response.json(folder);
      const name = url.pathname.split('/').at(-1)!;
      if (url.pathname.startsWith('/upload/drive/v3/files/')) {
        uploaded.push(name);
        media.set(name, String(init?.body));
        return Response.json({
          id: name,
          md5Checksum: createHash('md5').update(String(init?.body)).digest('hex'),
          modifiedTime: EXPORTED_AT,
        });
      }
      if (url.searchParams.get('alt') === 'media') {
        return new Response(media.get(name), { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({
        id: name,
        parents: [folder.id],
        trashed: false,
        md5Checksum: createHash('md5')
          .update(media.get(name) ?? '')
          .digest('hex'),
        modifiedTime: EXPORTED_AT,
      });
    }),
  );
  return { storage, media, uploaded };
}

async function createHandler() {
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('@/pages/background/cloudSyncMessages');
  const { googleDriveSyncService } = await import('../GoogleDriveSyncService');
  await googleDriveSyncService.getState();
  return createCloudSyncMessageHandler({
    getAllStarredMessages: async () => ({ messages: {} }),
    getAllForkNodes: async () => ({ nodes: {}, groups: {} }),
  });
}

const tab = (url: string) =>
  ({ id: 'test-extension', frameId: 0, tab: { url } }) as unknown as chrome.runtime.MessageSender;
const OWN_TAB = tab(`${DATA_SITE.origin}/c/abc-1`);

describe('Drive sync of a site described only by data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("round-trips the site's folders in a Drive file of its own and keeps its sync times", async () => {
    const boundaries = createBoundaries({ [DATA_SITE.storageKey]: folders });
    const handler = await createHandler();
    const upload = { type: 'gv.sync.upload', payload: { platform: DATA_SITE.id } };

    await expect(handler(upload, OWN_TAB)).resolves.toMatchObject({ ok: true });
    const payload = {
      format: 'gemini-voyager.folders.v1',
      exportedAt: EXPORTED_AT,
      version: EXTENSION_VERSION,
      data: folders,
      platform: DATA_SITE.id,
    };
    // Folders only: a derived site never carries the shared prompts, settings or plugins.
    expect(boundaries.uploaded).toEqual([DATA_SITE.driveFile]);
    expect(boundaries.media.get(DATA_SITE.driveFile)).toBe(JSON.stringify(payload));
    expect(boundaries.storage[`gvLastUploadTime:${DATA_SITE.id}`]).toBe(NOW);

    vi.setSystemTime(NOW + 1_000);
    await expect(
      handler({ type: 'gv.sync.download', payload: { platform: DATA_SITE.id } }, OWN_TAB),
    ).resolves.toMatchObject({ ok: true, data: { folders: payload, prompts: null } });
    expect(boundaries.storage[`gvLastSyncTime:${DATA_SITE.id}`]).toBe(NOW + 1_000);

    // The outline and star sync that follows a page's upload trusts the same tab.
    await expect(
      handler({ type: CATALOG_TIMELINE_PUSH_MESSAGE, payload: {} }, OWN_TAB),
    ).resolves.toMatchObject({ ok: true });

    vi.resetModules();
    const { GoogleDriveSyncService } = await import('../GoogleDriveSyncService');
    await expect(new GoogleDriveSyncService().getState()).resolves.toMatchObject({
      [`lastUploadTime:${DATA_SITE.id}`]: NOW,
      [`lastSyncTime:${DATA_SITE.id}`]: NOW + 1_000,
      lastUploadTimeChatGPT: null,
    });
  });

  it("refuses the site's Drive file to any other host, and any site the bundle does not know", async () => {
    const boundaries = createBoundaries({ [DATA_SITE.storageKey]: folders });
    boundaries.media.set(DATA_SITE.driveFile, JSON.stringify({ data: folders }));
    const handler = await createHandler();
    const strangers = [
      tab('https://chatgpt.com/c/abc-1'),
      // Inside the site's wildcard pattern, but not its bucket's host.
      tab('https://other.nimbus.test/c/abc-1'),
      tab('http://chat.nimbus.test/c/abc-1'),
    ];

    for (const sender of strangers) {
      await expect(
        handler({ type: 'gv.sync.upload', payload: { platform: DATA_SITE.id } }, sender),
      ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
      await expect(
        handler({ type: 'gv.sync.download', payload: { platform: DATA_SITE.id } }, sender),
      ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    }
    await expect(
      handler({ type: 'gv.sync.download', payload: { platform: 'orbit' } }, OWN_TAB),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    // A Nimbus tab cannot reach a frozen site's bucket either.
    await expect(
      handler({ type: 'gv.sync.upload', payload: { platform: 'chatgpt' } }, OWN_TAB),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    expect(boundaries.uploaded).toEqual([]);
  });
});
