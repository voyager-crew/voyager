import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
  settle,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';

import { restoreHierarchyBucket } from '../restoreHierarchyBucket';

const KEY = 'gvCatalogTimelineHierarchy:chatgpt';

const outline = (level: 2 | 3, updatedAt: number) => ({
  conversationUrl: 'https://chatgpt.com/c/x',
  levels: { turn: level },
  collapsed: [],
  updatedAt,
});

let storage: MemoryStorage;
/** Runs once, right after the next read of KEY has taken its snapshot. */
let afterNextRead: (() => void) | null;

beforeEach(() => {
  storage = createMemoryStorage();
  afterNextRead = null;
  const get = storage.api.local.get.bind(storage.api.local) as (keys: unknown) => Promise<unknown>;
  vi.stubGlobal('chrome', {
    ...chrome,
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
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('a restore keeps an outline edit another tab saved while the restore was reading', async () => {
  storage.values.local.set(KEY, { conversations: { x: outline(2, 5) } });
  // A ChatGPT tab saves a newer level between the popup restore's read and its write.
  afterNextRead = () => storage.external('local', KEY, { conversations: { x: outline(3, 99) } });

  const cloud = { conversations: { x: outline(2, 10), y: outline(2, 10) } };
  await expect(restoreHierarchyBucket(KEY, cloud)).resolves.toBe(true);
  await settle(30);

  expect(storage.values.local.get(KEY)).toEqual({
    conversations: { x: outline(3, 99), y: outline(2, 10) },
  });
});

it('a restore with no other writer meanwhile writes once', async () => {
  storage.values.local.set(KEY, { conversations: { x: outline(3, 99) } });

  await restoreHierarchyBucket(KEY, { conversations: { y: outline(2, 10) } });
  await settle(30);

  expect(storage.writes).toEqual([{ area: 'local', key: KEY }]);
  expect(storage.values.local.get(KEY)).toEqual({
    conversations: { x: outline(3, 99), y: outline(2, 10) },
  });
});
