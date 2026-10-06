import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

const EXTENSION_ID = 'test-extension';
const CHATGPT_FILE = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
const CLAUDE_FILE = 'gemini-voyager-timeline-hierarchy.site-claude.json';
const CHATGPT_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt:acct:1abc`;
const CLAUDE_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}claude`;

const outline = (id: string, updatedAt: number, level: 2 | 3 = 2) => ({
  conversationUrl: `https://chatgpt.com/c/${id}`,
  levels: { [`turn-${id}`]: level },
  collapsed: [],
  updatedAt,
});

const popup: chrome.runtime.MessageSender = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/src/pages/popup/index.html`,
};
const page = (url: string): chrome.runtime.MessageSender => ({
  id: EXTENSION_ID,
  url,
  frameId: 0,
  tab: { id: 3, url } as chrome.tabs.Tab,
});

/** Drive files by name, shared by every simulated device. */
const drive = new Map<string, string>();
const uploadedNames: string[] = [];

function stubDrive() {
  const folder = {
    id: 'backup-folder',
    name: 'Voyager Data',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { voyagerDataFolder: '1' },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
        const { name } = JSON.parse(String(init.body)) as { name: string };
        return Response.json({ id: name });
      }
      if (url.pathname === '/drive/v3/files') {
        if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
          return Response.json({ files: [folder] });
        }
        if (query.startsWith('(')) return Response.json({ files: [] });
        const name = /name='([^']+)'/.exec(query)?.[1];
        if (!name) throw new Error(`Unexpected Drive query: ${query}`);
        return Response.json({ files: drive.has(name) ? [{ id: name, name }] : [] });
      }
      if (url.pathname === '/drive/v3/files/backup-folder') return Response.json(folder);
      const name = url.pathname.split('/').at(-1)!;
      if (url.pathname.startsWith('/upload/drive/v3/files/')) {
        uploadedNames.push(name);
        drive.set(name, String(init?.body));
        return Response.json({ id: name });
      }
      if (url.searchParams.get('alt') === 'media') {
        return new Response(drive.get(name), { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({ parents: [folder.id], trashed: false });
    }),
  );
}

/** A fresh browser profile: its own storage and its own copy of every module. */
async function device(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(initial);
  vi.resetModules();
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
    },
    identity: {
      getAuthToken: vi.fn((_details: unknown, callback: (token: string) => void) =>
        callback('test-oauth-token'),
      ),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          const names = keys === null ? Object.keys(values) : [keys].flat();
          return structuredClone(
            Object.fromEntries(names.filter((key) => key in values).map((k) => [k, values[k]])),
          );
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(values, structuredClone(items));
        }),
        remove: vi.fn(async () => {}),
      },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
  });
  const { createCloudSyncMessageHandler } = await import('@/pages/background/cloudSyncMessages');
  const cloud = await import('@/features/timeline/catalogTimelineCloud');
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: async () => ({ messages: {} }),
    getAllForkNodes: async () => ({ nodes: {}, groups: {} }),
  });
  const sendAs = (sender: chrome.runtime.MessageSender) => (message: { type: string }) =>
    handler(message, sender) as Promise<unknown>;
  return { values, cloud, sendAs };
}

function driveFile(name: string) {
  return JSON.parse(drive.get(name)!) as { site: string; data: Record<string, unknown> };
}

beforeEach(() => {
  drive.clear();
  uploadedNames.length = 0;
  stubDrive();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('a ChatGPT outline survives a Drive round trip', async () => {
  const first = await device({ [CHATGPT_KEY]: { conversations: { one: outline('one', 10) } } });
  await first.cloud.pushCatalogTimeline(first.sendAs(page('https://chatgpt.com/c/one')));
  expect(uploadedNames).toEqual([CHATGPT_FILE]);

  const fresh = await device();
  const pulled = await fresh.cloud.pullCatalogTimeline(
    fresh.sendAs(page('https://chatgpt.com/c/one')),
  );
  expect(pulled).not.toBeNull();
  await expect(fresh.cloud.restorePulledCatalogTimeline(pulled!)).resolves.toBe(true);

  expect(fresh.values[CHATGPT_KEY]).toEqual({ conversations: { one: outline('one', 10) } });
});

it('an upload keeps the outlines another device already put in the site file', async () => {
  const first = await device({ [CHATGPT_KEY]: { conversations: { one: outline('one', 10) } } });
  await first.cloud.pushCatalogTimeline(first.sendAs(popup));
  const second = await device({
    [CHATGPT_KEY]: { conversations: { one: outline('one', 5, 3), two: outline('two', 20) } },
  });
  await second.cloud.pushCatalogTimeline(second.sendAs(popup));

  expect(driveFile(CHATGPT_FILE).data[CHATGPT_KEY]).toEqual({
    conversations: { one: outline('one', 10), two: outline('two', 20) },
  });
});

it('a restore keeps a newer local outline and leaves an unreadable bucket untouched', async () => {
  const first = await device({
    [CHATGPT_KEY]: { conversations: { one: outline('one', 10), two: outline('two', 10) } },
    [CLAUDE_KEY]: { conversations: { three: outline('three', 10) } },
  });
  await first.cloud.pushCatalogTimeline(first.sendAs(popup));

  const other = await device({
    [CHATGPT_KEY]: { conversations: { one: outline('one', 99, 3) } },
    [CLAUDE_KEY]: 'not a bucket',
  });
  const pulled = await other.cloud.pullCatalogTimeline(other.sendAs(popup));
  await expect(other.cloud.restorePulledCatalogTimeline(pulled!)).rejects.toThrow();

  expect(other.values[CHATGPT_KEY]).toEqual({
    conversations: { one: outline('one', 99, 3), two: outline('two', 10) },
  });
  expect(other.values[CLAUDE_KEY]).toBe('not a bucket');
});

it('a ChatGPT page neither uploads nor restores another site’s outlines', async () => {
  const first = await device({
    [CHATGPT_KEY]: { conversations: { one: outline('one', 10) } },
    [CLAUDE_KEY]: { conversations: { three: outline('three', 10) } },
  });
  await first.cloud.pushCatalogTimeline(first.sendAs(page('https://chatgpt.com/')));
  expect(uploadedNames).toEqual([CHATGPT_FILE]);
  await first.cloud.pushCatalogTimeline(first.sendAs(popup));
  expect(new Set(uploadedNames)).toEqual(new Set([CHATGPT_FILE, CLAUDE_FILE]));

  const fresh = await device();
  const pulled = await fresh.cloud.pullCatalogTimeline(fresh.sendAs(page('https://chatgpt.com/')));
  expect(Object.keys(pulled ?? {})).toEqual([CHATGPT_KEY]);
  const gemini = await fresh.cloud.pullCatalogTimeline(
    fresh.sendAs(page('https://gemini.google.com/app')),
  );
  expect(gemini).toBeNull();
});
