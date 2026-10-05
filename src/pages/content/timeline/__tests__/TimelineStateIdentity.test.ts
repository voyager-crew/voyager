import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { TimelineHierarchyGeometry } from '@/features/timeline/TimelineHierarchyGeometry';
import { TimelineState } from '@/features/timeline/TimelineState';
import {
  getLegacyTimelineCollapsedStorageKey,
  getLegacyTimelineLevelsStorageKey,
} from '@/features/timeline/hierarchyTypes';
import type { MarkerLevel } from '@/features/timeline/types';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';

const PARENT_ID = 's-6060606060606060';
const CHILD_ID = 's-6161616161616161';
const CONVERSATION_ID = 'gemini:conv:abc';
const levelsKey = getLegacyTimelineLevelsStorageKey(CONVERSATION_ID);
const collapsedKey = getLegacyTimelineCollapsedStorageKey(CONVERSATION_ID);
const states: TimelineState[] = [];

async function setup(
  aliases: ReadonlyMap<string, string>,
  levels: Record<string, MarkerLevel> = {},
  collapsed: string[] = [],
) {
  localStorage.setItem(levelsKey, JSON.stringify(levels));
  localStorage.setItem(collapsedKey, JSON.stringify(collapsed));
  const state = new TimelineState(
    vi.fn(),
    createGeminiTimelineStoragePolicy(window.location.href, {
      getTurnIdAliases: (_conversationId, id) => [
        id,
        ...(aliases.has(id) ? [aliases.get(id)!] : []),
      ],
      resolveCanonicalTurnId: (_conversationId, id) => (id.startsWith('u-') ? null : id),
    }),
  );
  states.push(state);
  await state.init();
  state.replaceMarkers(
    [PARENT_ID, CHILD_ID].map((id, index) => ({
      id,
      element: document.createElement('div'),
      summary: id,
      assistantSummary: '',
      baseN: index,
      starred: false,
    })),
  );
  vi.mocked(chrome.storage.local.set).mockClear();
  return state;
}

function hiddenIndices(state: TimelineState): Set<number> {
  const geometry = new TimelineHierarchyGeometry(
    () => state.markers,
    (id) => state.hierarchy.getMarkerLevel(id),
    (id) => state.hierarchy.isMarkerCollapsed(id),
  );
  geometry.markerLevelEnabled = true;
  return geometry.getHiddenMarkerIndices();
}

describe('TimelineState identity aliases', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/app/abc');
    localStorage.clear();
    vi.restoreAllMocks();
    // Saves read their result back, so this storage keeps what was set.
    const stored: Record<string, unknown> = {};
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => structuredClone(stored));
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      Object.assign(stored, structuredClone(items));
    });
    vi.spyOn(StarredMessagesService, 'getAllStarredMessages').mockResolvedValue({ messages: {} });
  });
  afterEach(() => {
    states.splice(0).forEach((state) => state.destroy());
  });

  it('applies legacy hierarchy data by full conversation position to a mounted tail', async () => {
    const state = await setup(
      new Map([
        [PARENT_ID, 'u-60'],
        [CHILD_ID, 'u-61'],
      ]),
      { 'u-61': 2 },
      ['u-60'],
    );
    expect(state.hierarchy.getMarkerLevel(CHILD_ID)).toBe(2);
    expect(hiddenIndices(state)).toEqual(new Set([1]));
  });
  it('does not apply an unverified legacy position to the first mounted tail turn', async () => {
    const state = await setup(new Map(), { 'u-0': 2 }, ['u-0']);
    expect(state.hierarchy.getMarkerLevel(PARENT_ID)).toBe(1);
    expect(hiddenIndices(state)).toEqual(new Set());
  });
  it('does not persist actions from a mounted positional fallback', async () => {
    const state = await setup(new Map([['u-0', 'u-0']]));
    state.hierarchy.setMarkerLevel('u-0', 2);
    state.hierarchy.toggleCollapse('u-0');
    expect(localStorage.getItem(levelsKey)).toBe('{}');
    expect(localStorage.getItem(collapsedKey)).toBe('[]');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('converges verified legacy aliases to the server id when the user edits them', async () => {
    const state = await setup(new Map([[CHILD_ID, 'u-61']]), { 'u-61': 2 });
    state.hierarchy.setMarkerLevel(CHILD_ID, 3);
    expect(state.hierarchy.getMarkerLevel(CHILD_ID)).toBe(3);
    expect(JSON.parse(localStorage.getItem(levelsKey)!)).toEqual({ [CHILD_ID]: 3 });
    state.hierarchy.setMarkerLevel(CHILD_ID, 1);
    expect(state.hierarchy.getMarkerLevel(CHILD_ID)).toBe(1);
    expect(JSON.parse(localStorage.getItem(levelsKey)!)).toEqual({});
  });
  it('removes the verified legacy collapse alias when expanding', async () => {
    const state = await setup(new Map([[PARENT_ID, 'u-60']]), {}, ['u-60']);
    state.hierarchy.toggleCollapse(PARENT_ID);
    expect(state.hierarchy.isMarkerCollapsed(PARENT_ID)).toBe(false);
    expect(localStorage.getItem(collapsedKey)).toBe('[]');
  });
  it('outline edits before hierarchy hydration cannot overwrite saved levels or collapses', async () => {
    const saved = {
      [StorageKeys.TIMELINE_HIERARCHY]: {
        conversations: {
          [CONVERSATION_ID]: { levels: { [PARENT_ID]: 2 }, collapsed: [PARENT_ID], updatedAt: 1 },
        },
      },
    };
    let release!: (value: Record<string, unknown>) => void;
    vi.mocked(chrome.storage.local.set).mockClear();
    vi.mocked(chrome.storage.local.get)
      .mockImplementation(async () => saved)
      .mockImplementationOnce(
        async () =>
          new Promise<Record<string, unknown>>((resolve) => {
            release = resolve;
          }),
      );
    const state = new TimelineState(vi.fn(), createGeminiTimelineStoragePolicy());
    states.push(state);
    state.hierarchy.setMarkerLevel(CHILD_ID, 3);
    state.hierarchy.toggleCollapse(CHILD_ID);
    const pending = state.init();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    state.hierarchy.setMarkerLevel(CHILD_ID, 3);
    state.hierarchy.toggleCollapse(CHILD_ID);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(localStorage.getItem(levelsKey)).toBeNull();
    expect(localStorage.getItem(collapsedKey)).toBeNull();
    // Each edit is written against what storage holds, so storage must keep what was set.
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      Object.assign(saved, items);
    });
    release(saved);
    await pending;
    state.hierarchy.setMarkerLevel(CHILD_ID, 3);
    state.hierarchy.toggleCollapse(CHILD_ID);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.TIMELINE_HIERARCHY]: {
        conversations: {
          [CONVERSATION_ID]: expect.objectContaining({
            levels: { [PARENT_ID]: 2, [CHILD_ID]: 3 },
            collapsed: [PARENT_ID, CHILD_ID],
          }),
        },
      },
    });
  });
  it('does not restore a late hierarchy snapshot after the owner is destroyed', async () => {
    let resolveSnapshot!: (data: Record<string, unknown>) => void;
    let started!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => {
      started();
      return new Promise<Record<string, unknown>>((resolve) => {
        resolveSnapshot = resolve;
      });
    });
    const state = new TimelineState(vi.fn(), createGeminiTimelineStoragePolicy());
    states.push(state);
    const init = state.init();
    await readStarted;
    state.destroy();
    localStorage.setItem(levelsKey, JSON.stringify({ [CHILD_ID]: 3 }));

    resolveSnapshot({
      [StorageKeys.TIMELINE_HIERARCHY]: {
        conversations: {
          [CONVERSATION_ID]: { levels: { [CHILD_ID]: 2 }, collapsed: [], updatedAt: 1 },
        },
      },
    });
    await init;
    expect(JSON.parse(localStorage.getItem(levelsKey)!)).toEqual({ [CHILD_ID]: 3 });
  });
});
