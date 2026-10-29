import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureCloudSyncSnapshot,
  recordCloudSyncWrites,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { TimelineState } from '../TimelineState';
import type { TimelineHierarchyData } from '../hierarchyTypes';

const KEY = StorageKeys.TIMELINE_HIERARCHY;
const TURN = 's-1111111111111111';
const states: TimelineState[] = [];
let storage: MemoryStorage;

function policy() {
  history.replaceState({}, '', '/app/cloud-undo');
  return createGeminiTimelineStoragePolicy('https://gemini.google.com/app/cloud-undo');
}

function outline(level: 2 | 3) {
  return {
    conversationUrl: 'https://gemini.google.com/app/cloud-undo',
    levels: { [TURN]: level },
    collapsed: [TURN],
    updatedAt: 1,
  };
}

async function open(): Promise<TimelineState> {
  const state = new TimelineState(() => {}, policy());
  states.push(state);
  await state.init();
  return state;
}

async function applyHierarchy(snapshotId: string, value: TimelineHierarchyData): Promise<void> {
  await recordCloudSyncWrites(snapshotId, [{ area: 'local', key: KEY, kind: 'hierarchy', value }]);
  await chrome.storage.local.set({ [KEY]: value });
}

beforeEach(() => {
  storage = createMemoryStorage();
  localStorage.clear();
  vi.stubGlobal('chrome', {
    ...chrome,
    storage: storage.api,
    runtime: {
      ...chrome.runtime,
      sendMessage: (_request: unknown, respond: (value: unknown) => void) =>
        respond({ ok: true, data: { messages: {} }, messages: [] }),
    },
  });
});

afterEach(() => {
  states.splice(0).forEach((state) => state.destroy());
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Gemini hierarchy after cloud undo', () => {
  it.each(['missing bucket', 'missing conversation'] as const)(
    'does not migrate the undone applied mirror after reopening with a %s',
    async (original) => {
      const current = policy();
      const prior: TimelineHierarchyData | undefined =
        original === 'missing conversation'
          ? { conversations: { 'gemini:conv:original': outline(2) } }
          : undefined;
      if (prior) storage.values.local.set(KEY, structuredClone(prior));
      const snapshot = await captureCloudSyncSnapshot({
        context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
        keys: [{ area: 'local', key: KEY }],
      });
      await applyHierarchy(snapshot.id, {
        conversations: { [current.conversationId]: outline(3) },
      });
      const applied = await open();
      expect(applied.hierarchy.getMarkerLevel(TURN)).toBe(3);
      applied.destroy();
      expect(JSON.parse(localStorage.getItem(current.hierarchy.legacyLevelsKey!)!)).toEqual({
        [TURN]: 3,
      });

      expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
      const reopened = await open();

      expect(reopened.hierarchy.getMarkerLevel(TURN)).toBe(1);
      expect(reopened.hierarchy.isMarkerCollapsed(TURN)).toBe(false);
      expect(storage.values.local.get(KEY)).toEqual(prior);
      expect(localStorage.getItem(current.hierarchy.legacyLevelsKey!)).toBeNull();
      expect(localStorage.getItem(current.hierarchy.legacyCollapsedKey!)).toBeNull();
    },
  );

  it('keeps a later canonical edit instead of suppressing it as downloaded content', async () => {
    const current = policy();
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: KEY }],
    });
    await applyHierarchy(snapshot.id, {
      conversations: { [current.conversationId]: outline(3) },
    });
    const applied = await open();
    applied.destroy();
    const edited = { conversations: { [current.conversationId]: outline(2) } };
    await chrome.storage.local.set({ [KEY]: edited });

    expect(await undoCloudSyncSnapshot()).toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'hierarchy', reason: 'changed-since-download' }],
    });
    const reopened = await open();
    expect(reopened.hierarchy.getMarkerLevel(TURN)).toBe(2);
    expect(reopened.hierarchy.isMarkerCollapsed(TURN)).toBe(true);
    expect(storage.values.local.get(KEY)).toEqual(edited);
  });

  it('still migrates a differing original legacy outline after undo', async () => {
    const current = policy();
    const legacyLevels = JSON.stringify({ [TURN]: 2 });
    const legacyCollapsed = JSON.stringify([TURN]);
    localStorage.setItem(current.hierarchy.legacyLevelsKey!, legacyLevels);
    localStorage.setItem(current.hierarchy.legacyCollapsedKey!, legacyCollapsed);
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: KEY }],
    });
    await applyHierarchy(snapshot.id, {
      conversations: { [current.conversationId]: outline(3) },
    });
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });

    const reopened = await open();

    expect(reopened.hierarchy.getMarkerLevel(TURN)).toBe(2);
    expect(reopened.hierarchy.isMarkerCollapsed(TURN)).toBe(true);
    expect(storage.values.local.get(KEY)).toMatchObject({
      conversations: { [current.conversationId]: { levels: { [TURN]: 2 }, collapsed: [TURN] } },
    });
    expect(localStorage.getItem(current.hierarchy.legacyLevelsKey!)).toBe(legacyLevels);
    expect(localStorage.getItem(current.hierarchy.legacyCollapsedKey!)).toBe(legacyCollapsed);
  });

  it('preserves a different legacy source that arrives while checking the undo marker', async () => {
    const current = policy();
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [{ area: 'local', key: KEY }],
    });
    await applyHierarchy(snapshot.id, {
      conversations: { [current.conversationId]: outline(3) },
    });
    const applied = await open();
    applied.destroy();
    expect(await undoCloudSyncSnapshot()).toMatchObject({ status: 'restored' });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const get = storage.api.local.get.bind(storage.api.local) as (
      keys: unknown,
    ) => Promise<Record<string, unknown>>;
    const read = vi.spyOn(storage.api.local, 'get').mockImplementation(async (keys: unknown) => {
      const value = await get(keys);
      if (keys === StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT) {
        started.resolve();
        await release.promise;
      }
      return value;
    });
    const mounting = open();
    await started.promise;
    const originalLevels = JSON.stringify({ [TURN]: 2 });
    localStorage.setItem(current.hierarchy.legacyLevelsKey!, originalLevels);
    localStorage.setItem(current.hierarchy.legacyCollapsedKey!, '[]');
    release.resolve();
    const stale = await mounting;

    expect(storage.values.local.get(KEY)).toBeUndefined();
    expect(localStorage.getItem(current.hierarchy.legacyLevelsKey!)).toBe(originalLevels);
    expect(localStorage.getItem(current.hierarchy.legacyCollapsedKey!)).toBe('[]');
    stale.destroy();
    read.mockRestore();
    const reopened = await open();
    expect(reopened.hierarchy.getMarkerLevel(TURN)).toBe(2);
    expect(reopened.hierarchy.isMarkerCollapsed(TURN)).toBe(false);
  });
});
