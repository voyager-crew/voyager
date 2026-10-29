import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { createScopeSyncDevice } from './cloudSyncScopeHarness';

const SITE = 'legacy-only-site';
const CLOUD_FILE = `gemini-voyager-timeline-hierarchy.site-${SITE}.json`;
const legacyStar: StarredMessage = {
  conversationId: `${SITE}:conv:local`,
  conversationUrl: 'https://legacy-only-site.example/chat/local',
  turnId: 'local-turn',
  content: 'Only present in the legacy projection',
  starredAt: 10,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('catalog discovery through the real background download', () => {
  it('leaves a legacy-only star library unchanged when the discovered site cloud read fails', async () => {
    const device = await createScopeSyncDevice();
    await device.request('gv.sync.getState');
    device.values[StorageKeys.TIMELINE_STARRED_MESSAGES] = {
      messages: { [legacyStar.conversationId]: [legacyStar] },
    };
    device.drive.put(CLOUD_FILE, {
      format: 'gemini-voyager.catalog-timeline-hierarchy.v1',
      site: SITE,
      data: {},
    });
    device.drive.failReads.add(CLOUD_FILE);
    const before = structuredClone(device.values);
    const entered = Promise.withResolvers<void>();
    device.drive.beforeRead = async (name) => {
      if (name === CLOUD_FILE) entered.resolve();
    };

    const download = device.request('gv.sync.catalogTimeline.pull', { selection: 'all' });
    await entered.promise;
    await vi.runAllTimersAsync();

    expect(await download).toMatchObject({ ok: false });
    expect(device.values).toEqual(before);
    expect(Object.hasOwn(device.values, StorageKeys.SAVED_LIBRARY_STARS)).toBe(false);
    expect(Object.hasOwn(device.values, StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES)).toBe(false);
    expect(Object.hasOwn(device.values, StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT)).toBe(false);
  });
});
