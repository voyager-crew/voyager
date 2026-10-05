import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';

import { TimelineState } from '../TimelineState';
import type { TimelineHierarchyData } from '../hierarchyTypes';

const OLD = 's-1111111111111111';
const NEW = 's-2222222222222222';
const CONVERSATION = 'gemini:conv:recovery';
const KEY = StorageKeys.TIMELINE_HIERARCHY;
const states: TimelineState[] = [];

function outline(url: string): TimelineHierarchyData {
  return {
    conversations: {
      [CONVERSATION]: {
        conversationUrl: url,
        levels: { [OLD]: 2 },
        collapsed: [OLD],
        updatedAt: 1,
      },
    },
  };
}

function createState(url: string): TimelineState {
  // The page is on the conversation whose outline the state edits.
  history.replaceState({}, '', new URL(url).pathname);
  const state = new TimelineState(() => {}, createGeminiTimelineStoragePolicy(url));
  states.push(state);
  state.replaceMarkers(
    [OLD, NEW].map((id, index) => ({
      id,
      element: document.createElement('div'),
      summary: id,
      assistantSummary: '',
      baseN: index,
      starred: false,
    })),
  );
  return state;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function storageEvents(): (key: string, value: unknown) => void {
  type Listener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
  const listeners = new Set<Listener>();
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
  return (key, value) => {
    for (const listener of Array.from(listeners)) listener({ [key]: { newValue: value } }, 'local');
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    _request: unknown,
    callback: (response: unknown) => void,
  ) => callback({ ok: true, data: { messages: {} } })) as typeof chrome.runtime.sendMessage);
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
});
afterEach(() => states.splice(0).forEach((state) => state.destroy()));

describe('outline hydration recovery', () => {
  it('a failed first outline read does not leave levels uneditable', async () => {
    const url = 'https://gemini.google.com/app/recovery';
    let saved = outline(url);
    let reads = 0;
    let release!: (value: Record<string, unknown>) => void;
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) throw new Error('temporary outline read failure');
      if (reads === 2)
        return new Promise<Record<string, unknown>>((resolve) => {
          release = resolve;
        });
      return { [KEY]: structuredClone(saved) };
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      saved = structuredClone((items as Record<string, unknown>)[KEY]) as TimelineHierarchyData;
    });
    const state = createState(url);
    await state.init();
    expect(reads).toBe(1);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const edit = state.hierarchy.setMarkerLevel(NEW, 3);
    await settle();
    expect(reads).toBe(2);
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(1);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`)).toBeNull();

    release({ [KEY]: structuredClone(saved) });
    await edit;
    await settle();
    expect(state.hierarchy.getMarkerLevel(OLD)).toBe(2);
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(3);
    expect(state.hierarchy.isMarkerCollapsed(OLD)).toBe(true);
    expect(saved.conversations[CONVERSATION]).toMatchObject({
      levels: { [OLD]: 2, [NEW]: 3 },
      collapsed: [OLD],
    });
    await state.hierarchy.toggleCollapse(NEW);
    await settle();
    expect(saved.conversations[CONVERSATION].collapsed).toEqual([OLD, NEW]);
  });

  it('an earlier level choice waiting on a retry does not undo a newer one', async () => {
    const url = 'https://gemini.google.com/app/recovery';
    const stale = outline(url);
    let saved = structuredClone(stale);
    let reads = 0;
    let release!: (value: Record<string, unknown>) => void;
    const external = storageEvents();
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) throw new Error('temporary outline read failure');
      if (reads === 2)
        return new Promise<Record<string, unknown>>((resolve) => {
          release = resolve;
        });
      return { [KEY]: structuredClone(saved) };
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      saved = structuredClone((items as Record<string, unknown>)[KEY]) as TimelineHierarchyData;
    });
    const state = createState(url);
    await state.init();
    const earlier = state.hierarchy.setMarkerLevel(NEW, 2);
    await settle();
    expect(reads).toBe(2);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    external(KEY, structuredClone(saved));
    const newer = state.hierarchy.setMarkerLevel(NEW, 3);
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(3);
    await newer;
    await settle();
    expect(saved.conversations[CONVERSATION].levels).toEqual({ [OLD]: 2, [NEW]: 3 });
    const writes = vi.mocked(chrome.storage.local.set).mock.calls.length;

    release({ [KEY]: stale });
    await earlier;
    await settle();
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(3);
    expect(saved.conversations[CONVERSATION].levels).toEqual({ [OLD]: 2, [NEW]: 3 });
    expect(saved.conversations[CONVERSATION].collapsed).toEqual([OLD]);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(writes);
    expect(JSON.parse(localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`)!)).toEqual({
      [OLD]: 2,
      [NEW]: 3,
    });
  });

  it('only a complete external outline for the resolved account can restore editing after a failed read', async () => {
    const url = 'https://gemini.google.com/u/2/app/recovery';
    const scopedKey = buildScopedStorageKey(KEY, 'route:2');
    const otherKey = buildScopedStorageKey(KEY, 'route:9');
    const profileMap = {
      version: 1,
      nextId: 2,
      profiles: { 'route:2': { id: 1, createdAt: 1, updatedAt: 1, routeUserId: '2' } },
      routeAliases: { '2': 'route:2' },
      emailAliases: {},
    };
    let healthy = false;
    let saved = outline(url);
    const external = storageEvents();
    vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
      if (Array.isArray(keys) && keys.includes(StorageKeys.GV_ACCOUNT_PROFILE_MAP)) {
        return { [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: structuredClone(profileMap) };
      }
      if (!healthy) throw new Error('outline backend still unavailable');
      return { [scopedKey]: structuredClone(saved) };
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      saved = structuredClone(
        (items as Record<string, unknown>)[scopedKey],
      ) as TimelineHierarchyData;
    });
    const state = createState(url);
    await state.init();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    external(otherKey, outline('https://gemini.google.com/u/9/app/recovery'));
    await state.hierarchy.setMarkerLevel(NEW, 3);
    await settle();
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(1);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    external(scopedKey, { conversations: { [CONVERSATION]: { levels: { [NEW]: 2 } } } });
    await state.hierarchy.setMarkerLevel(NEW, 3);
    await state.hierarchy.toggleCollapse(NEW);
    await settle();
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(1);
    expect(state.hierarchy.isMarkerCollapsed(NEW)).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    external(scopedKey, structuredClone(saved));
    expect(state.hierarchy.getMarkerLevel(OLD)).toBe(2);
    expect(state.hierarchy.isMarkerCollapsed(OLD)).toBe(true);
    healthy = true;
    const recoveredEdit = state.hierarchy.setMarkerLevel(NEW, 3);
    // The valid external snapshot has already hydrated this owner; the edit is ready immediately.
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(3);
    await recoveredEdit;
    await settle();
    const recoveredCollapse = state.hierarchy.toggleCollapse(NEW);
    expect(state.hierarchy.isMarkerCollapsed(NEW)).toBe(true);
    await recoveredCollapse;
    await settle();
    expect(saved.conversations[CONVERSATION]).toMatchObject({
      levels: { [OLD]: 2, [NEW]: 3 },
      collapsed: [OLD, NEW],
    });
    expect(localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`)).toBeNull();
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({ [scopedKey]: saved });
  });

  it('a late first outline read does not overwrite an external outline', async () => {
    const url = 'https://gemini.google.com/app/recovery';
    const stale = outline(url);
    let saved = structuredClone(stale);
    let reads = 0;
    let release!: (value: Record<string, unknown>) => void;
    const external = storageEvents();
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => {
      reads += 1;
      if (reads === 1)
        return new Promise<Record<string, unknown>>((resolve) => {
          release = resolve;
        });
      return { [KEY]: structuredClone(saved) };
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      saved = structuredClone((items as Record<string, unknown>)[KEY]) as TimelineHierarchyData;
    });
    const state = createState(url);
    const initialRead = state.init();
    await settle();
    expect(reads).toBe(1);
    saved = {
      conversations: {
        [CONVERSATION]: {
          conversationUrl: url,
          levels: { [OLD]: 3, [NEW]: 2 },
          collapsed: [],
          updatedAt: 2,
        },
      },
    };
    external(KEY, structuredClone(saved));
    await state.hierarchy.setMarkerLevel(NEW, 3);
    await settle();
    await state.hierarchy.toggleCollapse(OLD);
    await settle();
    expect(saved.conversations[CONVERSATION]).toMatchObject({
      levels: { [OLD]: 3, [NEW]: 3 },
      collapsed: [OLD],
    });
    const retained = structuredClone(saved);
    const writes = vi.mocked(chrome.storage.local.set).mock.calls.length;
    expect(writes).toBeGreaterThan(0);

    release({ [KEY]: stale });
    await initialRead;
    await settle();

    expect(state.hierarchy.getMarkerLevel(OLD)).toBe(3);
    expect(state.hierarchy.getMarkerLevel(NEW)).toBe(3);
    expect(state.hierarchy.isMarkerCollapsed(OLD)).toBe(true);
    expect(saved).toEqual(retained);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(writes);
    expect(JSON.parse(localStorage.getItem(`geminiTimelineLevels:${CONVERSATION}`)!)).toEqual({
      [OLD]: 3,
      [NEW]: 3,
    });
  });
});
