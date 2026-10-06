import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { CATALOG_OUTLINE_WRITE_MESSAGE } from '@/features/timeline/catalogOutlineMessages';

import { createCatalogOutlineMessageHandler } from '../catalogOutlineMessages';

const EXTENSION_ID = 'test-extension';
const CHATGPT = 'gvCatalogTimelineHierarchy:chatgpt';
const CLAUDE = 'gvCatalogTimelineHierarchy:claude';
const X = 'chatgpt:conv:x';
const Y = 'chatgpt:conv:y';

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
const chatgptTab = page('https://chatgpt.com/c/x');

const outline = (level: 2 | 3, updatedAt: number) => ({
  conversationUrl: 'https://chatgpt.com/c/x',
  levels: { turn: level },
  collapsed: [],
  updatedAt,
});

let storage: MemoryStorage;
let handle: ReturnType<typeof createCatalogOutlineMessageHandler>;
/** Runs once, right after the next storage read has taken its snapshot. */
let afterNextRead: (() => void) | null;
/** Holds the next write until released. */
let holdNextWrite: ((release: () => void) => void) | null;

const send = (sender: chrome.runtime.MessageSender, payload: unknown) =>
  handle({ type: CATALOG_OUTLINE_WRITE_MESSAGE, payload }, sender);
const setLevel = (key: string, conversationId: string, level: 1 | 2 | 3) => ({
  kind: 'edit',
  key,
  conversationId,
  edit: { kind: 'level', turnId: 'turn', aliases: [], level, url: 'https://chatgpt.com/c/x' },
});

beforeEach(() => {
  storage = createMemoryStorage();
  afterNextRead = null;
  holdNextWrite = null;
  const get = storage.api.local.get.bind(storage.api.local) as (keys: unknown) => Promise<unknown>;
  const set = storage.api.local.set.bind(storage.api.local);
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
    },
    storage: {
      ...storage.api,
      local: {
        ...storage.api.local,
        get: async (keys: unknown) => {
          const snapshot = await get(keys);
          const run = afterNextRead;
          afterNextRead = null;
          run?.();
          return snapshot;
        },
        set: async (items: Record<string, unknown>) => {
          const hold = holdNextWrite;
          holdNextWrite = null;
          if (hold) await new Promise<void>((release) => hold(release));
          await set(items);
        },
      },
    },
  });
  handle = createCatalogOutlineMessageHandler();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('a restore keeps an outline edit another tab saved while the restore was reading', async () => {
  storage.values.local.set(CHATGPT, { conversations: { [X]: outline(2, 5) } });
  let edit: Promise<unknown> | null = null;
  // A ChatGPT tab saves a newer level between the popup restore's read and its write.
  afterNextRead = () => {
    edit = send(chatgptTab, setLevel(CHATGPT, X, 3));
  };

  const cloud = { conversations: { [X]: outline(2, 10), [Y]: outline(2, 10) } };
  await expect(send(popup, { kind: 'restore', buckets: { [CHATGPT]: cloud } })).resolves.toEqual({
    ok: true,
    restored: 1,
    failed: 0,
  });
  await expect(edit).resolves.toEqual({ ok: true });

  expect(storage.values.local.get(CHATGPT)).toMatchObject({
    conversations: { [X]: { levels: { turn: 3 } }, [Y]: outline(2, 10) },
  });
});

it('a page edit saved while a restore is writing is kept', async () => {
  storage.values.local.set(CHATGPT, { conversations: { [X]: outline(2, 5) } });
  let releaseEdit = () => {};
  holdNextWrite = (release) => {
    releaseEdit = release;
  };
  const edit = send(chatgptTab, setLevel(CHATGPT, X, 3));
  await vi.waitFor(() => expect(holdNextWrite).toBeNull());

  const cloud = { conversations: { [X]: outline(2, 10), [Y]: outline(2, 10) } };
  const restore = send(popup, { kind: 'restore', buckets: { [CHATGPT]: cloud } });
  releaseEdit();
  await expect(Promise.all([edit, restore])).resolves.toEqual([
    { ok: true },
    { ok: true, restored: 1, failed: 0 },
  ]);

  expect(storage.values.local.get(CHATGPT)).toMatchObject({
    conversations: { [X]: { levels: { turn: 3 } }, [Y]: outline(2, 10) },
  });
});

it('a ChatGPT page cannot write Claude’s outline', async () => {
  const claude = { conversations: { 'claude:conv:a': outline(2, 5) } };
  storage.values.local.set(CLAUDE, claude);

  await expect(send(chatgptTab, setLevel(CLAUDE, 'claude:conv:a', 3))).resolves.toEqual({
    ok: false,
    error: 'untrusted_sender',
  });
  const cloud = { conversations: { 'claude:conv:b': outline(3, 10) } };
  await expect(
    send(chatgptTab, { kind: 'restore', buckets: { [CLAUDE]: cloud } }),
  ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
  // Nor can it slip another site's conversation into its own bucket.
  await expect(send(chatgptTab, setLevel(CHATGPT, 'claude:conv:a', 3))).resolves.toEqual({
    ok: false,
    error: 'invalid_payload',
  });

  expect(storage.values.local.get(CLAUDE)).toEqual(claude);
  expect(storage.values.local.has(CHATGPT)).toBe(false);
});
