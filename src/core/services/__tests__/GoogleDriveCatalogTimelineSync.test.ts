import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

const EXTENSION_ID = 'test-extension';
const CHATGPT_FILE = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
const CLAUDE_FILE = 'gemini-voyager-timeline-hierarchy.site-claude.json';
const CHATGPT_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt:acct:1abc`;
const CLAUDE_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}claude`;
const CHATGPT_STARS = 'gemini-voyager-stars.site-chatgpt.json';
const scope: SyncAccountScope = { accountKey: 'person', accountId: 2, routeUserId: '2' };
const scoped = (base: string) => `${base}.acct-${hashString(scope.accountKey)}.json`;

const geminiStar: StarredMessage = {
  conversationId: 'gemini:conv:abc',
  conversationUrl: 'https://gemini.google.com/u/2/app/abc',
  turnId: 'g-one',
  content: 'gemini prompt',
  starredAt: 10,
};
const chatgptStar: StarredMessage = {
  conversationId: 'chatgpt:conv:c1',
  conversationUrl: 'https://chatgpt.com/c/c1',
  turnId: 'c-one',
  content: 'chatgpt prompt',
  account: 'chatgpt:abc',
  starredAt: 20,
};

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
  const { createStarredMessagesHandler } = await import('@/pages/background/starredMessages');
  const { createCatalogOutlineMessageHandler } =
    await import('@/pages/background/catalogOutlineMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const { googleDriveSyncService: service } = await import('../GoogleDriveSyncService');
  const cloud = await import('@/features/timeline/catalogTimelineCloud');
  const store = createStarStore(chrome.storage.local as never);
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: store.getAll,
    getAllForkNodes: async () => ({ nodes: {}, groups: {} }),
    starStore: store,
  });
  // Star restores go through the background star owner, as `StarredMessagesService` sends them.
  const starred = createStarredMessagesHandler(store);
  Object.assign(chrome.runtime, {
    sendMessage: (message: unknown, respond: (response: unknown) => void) =>
      void starred(message, popup)?.then(respond),
  });
  // Outline writes go to the background's single outline writer, everything else to cloud sync.
  const outlines = createCatalogOutlineMessageHandler();
  const sendAs = (sender: chrome.runtime.MessageSender) => (message: { type: string }) =>
    (outlines(message, sender) ?? handler(message, sender)) as Promise<unknown>;
  /** A Gemini sync of the store's stars, as the Gemini folder upload runs it. */
  const syncGemini = (accountScope: SyncAccountScope | null) =>
    service.upload(
      { folders: [], folderContents: {} },
      [],
      { messages: {} },
      true,
      'gemini',
      null,
      null,
      accountScope,
      null,
      null,
      null,
      store,
    );
  return { values, cloud, sendAs, service, store, syncGemini };
}

function starFile(name: string) {
  return JSON.parse(drive.get(name)!) as {
    items: StarredMessage[];
    tombstones: { conversationId: string; turnId: string }[];
  };
}
const turns = (file: { items: StarredMessage[] }) => file.items.map((item) => item.turnId).sort();

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
  await expect(
    fresh.cloud.restorePulledCatalogTimeline(
      fresh.sendAs(page('https://chatgpt.com/c/one')),
      pulled!,
    ),
  ).resolves.toBe(true);

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

it('two uploads at once on one device keep both outlines in the site file', async () => {
  const d = await device();
  const bucket = (id: string) => ({
    chatgpt: { [CHATGPT_KEY]: { conversations: { [id]: outline(id, 10) } } },
  });
  await expect(
    Promise.all([
      d.service.uploadCatalogTimeline(bucket('one')),
      d.service.uploadCatalogTimeline(bucket('two')),
    ]),
  ).resolves.toEqual([true, true]);

  expect(driveFile(CHATGPT_FILE).data[CHATGPT_KEY]).toEqual({
    conversations: { one: outline('one', 10), two: outline('two', 10) },
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
  await expect(
    other.cloud.restorePulledCatalogTimeline(other.sendAs(popup), pulled!),
  ).rejects.toThrow();

  expect(other.values[CHATGPT_KEY]).toEqual({
    conversations: { one: outline('one', 99, 3), two: outline('two', 10) },
  });
  expect(other.values[CLAUDE_KEY]).toBe('not a bucket');
});

/** Recent times: deletion markers older than their retention are dropped. */
const EDITED = Date.now() - 2_000;
const CLEARED = EDITED + 1_000;
const REEDITED = CLEARED + 1_000;

it('an outline cleared on one device stays cleared on every device after a sync', async () => {
  const holding = { [CHATGPT_KEY]: { conversations: { one: outline('one', EDITED) } } };
  const first = await device(holding);
  await first.cloud.pushCatalogTimeline(first.sendAs(popup));
  // The page leaves this marker when the last level of `one` is cleared.
  const clearing = await device({
    [CHATGPT_KEY]: { conversations: {}, deleted: { one: CLEARED } },
  });
  await clearing.cloud.pushCatalogTimeline(clearing.sendAs(popup));

  const other = await device(holding);
  const pulled = await other.cloud.pullCatalogTimeline(other.sendAs(popup));
  await other.cloud.restorePulledCatalogTimeline(other.sendAs(popup), pulled!);
  expect(other.values[CHATGPT_KEY]).toEqual({ conversations: {}, deleted: { one: CLEARED } });

  // An upload that still holds the older outline doesn't bring it back either.
  const stale = await device(holding);
  await stale.cloud.pushCatalogTimeline(stale.sendAs(popup));
  const fresh = await device();
  const restored = await fresh.cloud.pullCatalogTimeline(fresh.sendAs(popup));
  await fresh.cloud.restorePulledCatalogTimeline(fresh.sendAs(popup), restored!);
  expect(fresh.values[CHATGPT_KEY]).toEqual({ conversations: {}, deleted: { one: CLEARED } });
});

it('an outline edited after another device cleared it is kept', async () => {
  const cleared = { [CHATGPT_KEY]: { conversations: {}, deleted: { one: CLEARED } } };
  const clearing = await device(cleared);
  await clearing.cloud.pushCatalogTimeline(clearing.sendAs(popup));
  const editing = await device({
    [CHATGPT_KEY]: { conversations: { one: outline('one', REEDITED) } },
  });
  await editing.cloud.pushCatalogTimeline(editing.sendAs(popup));

  const later = await device(cleared);
  const pulled = await later.cloud.pullCatalogTimeline(later.sendAs(popup));
  await later.cloud.restorePulledCatalogTimeline(later.sendAs(popup), pulled!);
  expect(later.values[CHATGPT_KEY]).toEqual({ conversations: { one: outline('one', REEDITED) } });
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
  expect(Object.keys(pulled?.outlines ?? {})).toEqual([CHATGPT_KEY]);
  const gemini = await fresh.cloud.pullCatalogTimeline(
    fresh.sendAs(page('https://gemini.google.com/app')),
  );
  expect(gemini).toBeNull();
});

it('a ChatGPT star survives a Drive round trip through its own site file', async () => {
  const first = await device();
  await first.store.add(chatgptStar);
  await first.cloud.pushCatalogTimeline(first.sendAs(page('https://chatgpt.com/c/c1')));
  expect(uploadedNames).toEqual([CHATGPT_STARS]);
  expect(turns(starFile(CHATGPT_STARS))).toEqual([chatgptStar.turnId]);

  const fresh = await device();
  const chatgpt = fresh.sendAs(page('https://chatgpt.com/'));
  const pulled = await fresh.cloud.pullCatalogTimeline(chatgpt);
  await expect(fresh.cloud.restorePulledCatalogTimeline(chatgpt, pulled!)).resolves.toBe(true);

  expect((await fresh.store.getAll()).messages[chatgptStar.conversationId]).toEqual([
    expect.objectContaining({ turnId: chatgptStar.turnId, account: chatgptStar.account }),
  ]);
});

it('a Gemini account sync no longer copies a new ChatGPT star into that account’s files', async () => {
  const d = await device();
  await d.store.add(geminiStar);
  await d.store.add(chatgptStar);
  await expect(d.syncGemini(scope)).resolves.toBe(true);

  expect(turns(starFile(scoped('gemini-voyager-stars')))).toEqual([geminiStar.turnId]);
  const legacy = JSON.parse(drive.get(scoped('gemini-voyager-starred'))!) as {
    data: { messages: Record<string, unknown> };
  };
  expect(Object.keys(legacy.data.messages)).toEqual([geminiStar.conversationId]);
  expect(turns(starFile(CHATGPT_STARS))).toEqual([chatgptStar.turnId]);
});

it('ChatGPT stars an older version left in a Gemini account file are restored and kept', async () => {
  const older = buildStarsV2(
    { data: { messages: { [chatgptStar.conversationId]: [chatgptStar] } }, tombstones: [] },
    scope,
    'old',
  );
  drive.set(scoped('gemini-voyager-stars'), JSON.stringify(older));
  const d = await device();
  await d.store.add(geminiStar);
  await expect(d.syncGemini(scope)).resolves.toBe(true);

  expect((await d.store.getAll()).messages[chatgptStar.conversationId]).toHaveLength(1);
  expect(turns(starFile(scoped('gemini-voyager-stars')))).toEqual([
    chatgptStar.turnId,
    geminiStar.turnId,
  ]);
  expect(turns(starFile(CHATGPT_STARS))).toEqual([chatgptStar.turnId]);
});

it('removing a ChatGPT star reaches the Gemini account file older versions read it from', async () => {
  const older = buildStarsV2(
    { data: { messages: { [chatgptStar.conversationId]: [chatgptStar] } }, tombstones: [] },
    scope,
    'old',
  );
  drive.set(scoped('gemini-voyager-stars'), JSON.stringify(older));
  const d = await device();
  await d.store.add(chatgptStar);
  await d.store.remove(chatgptStar.conversationId, chatgptStar.turnId);
  await expect(d.syncGemini(scope)).resolves.toBe(true);

  const file = starFile(scoped('gemini-voyager-stars'));
  expect(file.items).toEqual([]);
  expect(file.tombstones).toEqual([expect.objectContaining({ turnId: chatgptStar.turnId })]);
});

it('a ChatGPT star removed on another device leaves the Gemini account file in the same sync', async () => {
  const older = buildStarsV2(
    { data: { messages: { [chatgptStar.conversationId]: [chatgptStar] } }, tombstones: [] },
    scope,
    'old',
  );
  drive.set(scoped('gemini-voyager-stars'), JSON.stringify(older));
  const remover = await device();
  await remover.store.add(chatgptStar);
  await remover.store.remove(chatgptStar.conversationId, chatgptStar.turnId);
  await remover.cloud.pushCatalogTimeline(remover.sendAs(page('https://chatgpt.com/c/c1')));

  const d = await device();
  await d.store.add(chatgptStar);
  await expect(d.syncGemini(scope)).resolves.toBe(true);

  // Older versions read this file: one Gemini sync must not leave the removed star there.
  const file = starFile(scoped('gemini-voyager-stars'));
  expect(file.items).toEqual([]);
  expect(file.tombstones).toEqual([expect.objectContaining({ turnId: chatgptStar.turnId })]);
  const legacy = JSON.parse(drive.get(scoped('gemini-voyager-starred'))!) as {
    data: { messages: Record<string, unknown> };
  };
  expect(Object.keys(legacy.data.messages)).toEqual([]);
});

it('a Gemini sync without account isolation still writes catalog stars to the shared file', async () => {
  const d = await device();
  await d.store.add(chatgptStar);
  await expect(d.syncGemini(null)).resolves.toBe(true);

  // Older versions read catalog stars from the one shared file; it is not another account's copy.
  expect(turns(starFile('gemini-voyager-stars.json'))).toEqual([chatgptStar.turnId]);
  expect(turns(starFile(CHATGPT_STARS))).toEqual([chatgptStar.turnId]);
});
