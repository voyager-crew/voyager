import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { getTimelineHierarchyStorageKey } from '@/pages/content/timeline/hierarchyStorage';

import { loadTimelineHierarchyForSync } from '../cloudSyncLocalData';

const scope: SyncAccountScope = { accountKey: 'route:2', accountId: 2, routeUserId: '2' };
const legacyKey = StorageKeys.TIMELINE_HIERARCHY;
const scopedKey = getTimelineHierarchyStorageKey(scope.accountKey);
const conversation = (route: string) => ({
  conversationUrl: `https://gemini.google.com/u/${route}/app/example`,
  levels: { turn: 2 },
  collapsed: ['turn'],
  updatedAt: 10,
});

afterEach(() => vi.restoreAllMocks());

describe('hierarchy upload reads', () => {
  it('keeps the selected scoped hierarchy even when an unused legacy value is unreadable', async () => {
    const data = { conversations: { mine: conversation('2') } };
    const stored = { [scopedKey]: data, [legacyKey]: '{unreadable' };
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => stored);
    await expect(loadTimelineHierarchyForSync(scope)).resolves.toEqual(data);
  });

  it('uses legacy route filtering only when the scoped key is missing', async () => {
    const stored = {
      [legacyKey]: { conversations: { mine: conversation('2'), other: conversation('3') } },
    };
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => stored);
    await expect(loadTimelineHierarchyForSync(scope)).resolves.toEqual({
      conversations: { mine: conversation('2') },
    });
  });

  it('allows an absent hierarchy but refuses a failed read', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(async () => ({}));
    await expect(loadTimelineHierarchyForSync(null)).resolves.toEqual({ conversations: {} });
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(loadTimelineHierarchyForSync(null)).rejects.toThrow('storage unavailable');
  });

  it('repairs individual fields and drops unreadable entries while retaining valid content', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
      [scopedKey]: {
        conversations: {
          repaired: { ...conversation('2'), collapsed: [''], updatedAt: -1 },
          dropped: 'unreadable',
        },
      },
    }));
    await expect(loadTimelineHierarchyForSync(scope)).resolves.toEqual({
      conversations: { repaired: { ...conversation('2'), collapsed: [], updatedAt: 0 } },
    });
  });

  it.each([
    null,
    'unreadable',
    { conversations: [] },
    { conversations: { saved: { levels: {}, collapsed: [''] } } },
  ])(
    'refuses wrong containers and non-empty hierarchies that normalize to empty (%j)',
    async (raw) => {
      vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ [scopedKey]: raw }));
      await expect(loadTimelineHierarchyForSync(scope)).rejects.toThrow('Upload failed');
    },
  );
});
