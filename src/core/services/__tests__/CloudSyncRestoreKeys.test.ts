import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { CatalogTimelineBucket } from '@/features/timeline/catalogHierarchySync';
import { createCatalogOutlineMessageHandler } from '@/pages/background/catalogOutlineMessages';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { applyPopupCatalogDownload } from '../CloudSyncDownloadService';
import { readCloudSyncSnapshot, undoCloudSyncSnapshot } from '../CloudSyncSnapshotService';

const CHATGPT = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt:acct:a123`;
const CLAUDE = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}claude`;
const CONTEXT = {
  source: 'popup-restore',
  platform: 'gemini',
  accountScope: null,
} as const;

function outline(site: string, updatedAt: number): CatalogTimelineBucket {
  return {
    conversations: {
      [`${site}:conv:one`]: {
        conversationUrl: `https://${site}.com/chat/one`,
        levels: { turn: 2 },
        collapsed: [],
        updatedAt,
      },
    },
  };
}

let memory: MemoryStorage;
let previousStorage: typeof chrome.storage;
let send: (message: { type: string; payload?: unknown }) => Promise<unknown>;

beforeEach(() => {
  previousStorage = chrome.storage;
  memory = createMemoryStorage();
  chrome.storage = memory.api;
  const owner = createCatalogOutlineMessageHandler();
  send = async (message) => {
    const result = owner(message, {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL('popup.html'),
    });
    if (!result) throw new Error('Unhandled catalog restore');
    return result;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  chrome.storage = previousStorage;
});

describe('catalog restore snapshot targets', () => {
  it('captures changed buckets only so undo preserves later edits to a skipped outline', async () => {
    const localChatgpt = outline('chatgpt', 10);
    const localClaude = outline('claude', 50);
    const cloudChatgpt = outline('chatgpt', 100);
    memory.values.local.set(CHATGPT, localChatgpt);
    memory.values.local.set(CLAUDE, localClaude);
    const set = memory.api.local.set.bind(memory.api.local);
    let cleared = false;
    vi.spyOn(memory.api.local, 'set').mockImplementation(async (items) => {
      await set(items);
      if (StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT in items && !cleared) {
        cleared = true;
        // Another context clears this bucket after planning; replaying its older cloud
        // copy now would become a write that was absent from the durable snapshot.
        memory.external('local', CLAUDE, { conversations: {} });
      }
    });

    expect(
      await applyPopupCatalogDownload({
        send,
        snapshot: CONTEXT,
        catalog: {
          outlines: { [CHATGPT]: cloudChatgpt, [CLAUDE]: outline('claude', 30) },
          stars: {},
        },
      }),
    ).toBe(true);
    expect(memory.values.local.get(CHATGPT)).toEqual(cloudChatgpt);
    expect(memory.values.local.get(CLAUDE)).toEqual({ conversations: {} });
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: CHATGPT, existed: true, value: localChatgpt },
    ]);

    const laterClaude = outline('claude', 200);
    await chrome.storage.local.set({ [CLAUDE]: laterClaude });
    expect((await undoCloudSyncSnapshot()).status).toBe('restored');
    expect(memory.values.local.get(CHATGPT)).toEqual(localChatgpt);
    expect(memory.values.local.get(CLAUDE)).toEqual(laterClaude);
    expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)).toMatchObject({
      kind: 'undone',
      markers: [
        {
          area: 'local',
          key: CHATGPT,
          replacedHash: expect.any(String),
          appliedHash: expect.any(String),
        },
      ],
    });
    expect(memory.values.local.get(StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)).not.toHaveProperty(
      'entries',
    );
    expect(await readCloudSyncSnapshot()).toBeNull();
    const writes = memory.writes.length;
    expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
    expect(memory.writes).toHaveLength(writes);
  });

  it('leaves an unreadable bucket untouched while keeping undo for another bucket that applied', async () => {
    const unreadable = { conversations: 'unrecognized local outline', futureField: ['keep'] };
    const localClaude = outline('claude', 10);
    const cloudClaude = outline('claude', 100);
    memory.values.local.set(CHATGPT, unreadable);
    memory.values.local.set(CLAUDE, localClaude);

    await expect(
      applyPopupCatalogDownload({
        send,
        snapshot: CONTEXT,
        catalog: {
          outlines: { [CHATGPT]: outline('chatgpt', 100), [CLAUDE]: cloudClaude },
          stars: {},
        },
      }),
    ).rejects.toMatchObject({ failed: ['outlines'] });
    expect(memory.values.local.get(CHATGPT)).toEqual(unreadable);
    expect(memory.values.local.get(CLAUDE)).toEqual(cloudClaude);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: CLAUDE, existed: true, value: localClaude },
    ]);

    expect((await undoCloudSyncSnapshot()).status).toBe('restored');
    expect(memory.values.local.get(CHATGPT)).toEqual(unreadable);
    expect(memory.values.local.get(CLAUDE)).toEqual(localClaude);
  });
});
