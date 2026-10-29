import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCloudRestore } from '@/core/services/CloudSyncApplyService';
import {
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { StorageKeys } from '@/core/types/common';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { createStarStore } from '@/features/savedLibrary/starStore';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';

import { restorePulledCatalogTimeline } from '../catalogTimelineCloud';

const SLOT = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const keys = [
  StorageKeys.SAVED_LIBRARY_STARS,
  StorageKeys.TIMELINE_STARRED_MESSAGES,
  StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
];
const first: StarredMessage = {
  conversationId: 'chatgpt:conv:site-a',
  turnId: 'turn-a',
  content: 'From ChatGPT',
  conversationUrl: 'https://chatgpt.com/c/site-a',
  starredAt: 10,
};
const second: StarredMessage = {
  conversationId: 'claude:conv:site-b',
  turnId: 'turn-b',
  content: 'From Claude',
  conversationUrl: 'https://claude.ai/chat/site-b',
  starredAt: 20,
};
const firstState = { messages: { [first.conversationId]: [first] } };
const bothState = {
  messages: { [first.conversationId]: [first], [second.conversationId]: [second] },
};
const cloudFile = (item: StarredMessage) => ({
  format: 'gemini-voyager.stars.v2',
  exportedAt: '2026-10-29T00:00:00Z',
  version: '2.2.1',
  items: [item],
  tombstones: [],
});

function setup(failSecondWrite: boolean) {
  const values: Record<string, unknown> = {};
  let canonicalWrites = 0;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => structuredClone(values));
  vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    if (StorageKeys.SAVED_LIBRARY_STARS in items) {
      canonicalWrites += 1;
      if (failSecondWrite && canonicalWrites === 2) throw new Error('second site quota');
    }
    Object.assign(values, structuredClone(items));
  });
  vi.spyOn(chrome.storage.local, 'remove').mockImplementation(async (targets) => {
    for (const key of typeof targets === 'string' ? [targets] : targets) delete values[key];
  });
  const store = createStarStore({
    get: (targets) => chrome.storage.local.get<Record<string, unknown>>(targets),
    set: (items) => chrome.storage.local.set(items),
  });
  const handle = createStarredMessagesHandler(store);
  const sender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('src/pages/popup/index.html'),
  };
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message, respond) => {
    const pending = handle(message, sender);
    if (typeof respond === 'function') {
      void pending?.then(
        (value) => respond(value),
        (error: Error) => respond({ ok: false, error: error.message }),
      );
    }
    return undefined;
  });
  const download = () =>
    applyCloudRestore({
      mode: 'overwrite',
      highlightsRestored: false,
      storageUpdate: {},
      snapshot: { source: 'popup-restore', platform: 'chatgpt', accountScope: null },
      owners: [
        {
          parts: ['starred'],
          keys: keys.map((key) => ({ area: 'local', key })),
          run: (snapshotId) =>
            restorePulledCatalogTimeline(
              async () => {
                throw new Error('This stars-only download has no outline request');
              },
              { outlines: {}, stars: { chatgpt: cloudFile(first), claude: cloudFile(second) } },
              snapshotId,
            ),
        },
      ],
    });
  return { values, download };
}

afterEach(() => vi.restoreAllMocks());

describe('catalog multi-site star download undo', () => {
  it.each([false, true])(
    'restores absent keys and suppresses all receipts (second site write fails: %s)',
    async (failSecondWrite) => {
      const { values, download } = setup(failSecondWrite);
      if (failSecondWrite) await expect(download()).rejects.toMatchObject({ failed: ['starred'] });
      else await expect(download()).resolves.toMatchObject({ restored: ['starred'] });
      expect(values[keys[0]]).toEqual(failSecondWrite ? firstState : bothState);
      expect(values[keys[1]]).toEqual(failSecondWrite ? firstState : bothState);
      expect(values[keys[2]]).toEqual([]);

      expect(await undoCloudSyncSnapshot()).toMatchObject({
        status: 'restored',
        restoredKeys: 3,
        kept: [],
      });
      for (const key of keys) expect(Object.hasOwn(values, key)).toBe(false);
      expect(await readCloudSyncSnapshot()).toBeNull();
      expect(values[SLOT]).not.toHaveProperty('entries');
      for (const key of keys.slice(0, 2)) {
        for (const value of [firstState, bothState])
          expect(await isUndoneCloudSyncValue({ area: 'local', key, value })).toBe(true);
      }
      expect(await isUndoneCloudSyncValue({ area: 'local', key: keys[2], value: [] })).toBe(true);
      expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
    },
  );

  it('keeps a genuine later star edit after an earlier site committed and a later site failed', async () => {
    const { values, download } = setup(true);
    await expect(download()).rejects.toMatchObject({ failed: ['starred'] });
    const later: StarredMessage = {
      ...first,
      conversationId: 'chatgpt:conv:later',
      conversationUrl: 'https://chatgpt.com/c/later',
      turnId: 'later-turn',
      content: 'Starred after the download',
      starredAt: 30,
    };
    await StarredMessagesService.addStarredMessage(later);

    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 1,
      kept: [
        {
          kind: 'starred',
          keys: keys.slice(0, 2).map((key) => ({ area: 'local', key })),
          reason: 'changed-since-download',
        },
      ],
    });
    const edited = {
      messages: { [first.conversationId]: [first], [later.conversationId]: [later] },
    };
    expect(values[keys[0]]).toEqual(edited);
    expect(values[keys[1]]).toEqual(edited);
    expect(Object.hasOwn(values, keys[2])).toBe(false);
    expect(await isUndoneCloudSyncValue({ area: 'local', key: keys[0], value: edited })).toBe(
      false,
    );
  });
});
