import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import {
  type MemoryStorage,
  createMemoryStorage,
  settle,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';

import { TimelineState } from '../TimelineState';
import type { TimelineStoragePolicy } from '../TimelineStoragePolicy';
import type { TimelineHierarchyData } from '../hierarchyTypes';

const KEY = 'gvCatalogTimelineHierarchy:claude';
const TURN = 'c-turn';
const states: TimelineState[] = [];
let storage: MemoryStorage;
let current: Set<string>;
/** Counts down reads from the next one; the read that reaches zero is held. */
let readsUntilHold: number;
let release: (() => void) | null;
/** Holds each write before it reaches storage, or holds its reply after it has. */
let holdWrites: 'before-commit' | 'after-commit' | 'fail' | null;
const heldWrites: Array<() => void> = [];

async function releaseWrites(): Promise<void> {
  holdWrites = null;
  while (heldWrites.length > 0) {
    heldWrites.shift()?.();
    await settle(30);
  }
}

function outline(conversation: string, level: 1 | 2 | 3) {
  return {
    conversationUrl: `https://claude.ai/chat/${conversation}`,
    levels: { [TURN]: level },
    collapsed: [],
    updatedAt: 1,
  };
}

function stored(conversation: string) {
  return (storage.values.local.get(KEY) as TimelineHierarchyData | undefined)?.conversations[
    `claude:conv:${conversation}`
  ];
}

function create(
  conversation: string,
  account: Pick<TimelineStoragePolicy['hierarchy'], 'accountAttributes' | 'resolveAccountScope'> = {
    accountAttributes: [],
    resolveAccountScope: async () => null,
  },
): TimelineState {
  current.add(conversation);
  const policy: TimelineStoragePolicy = {
    conversationId: `claude:conv:${conversation}`,
    url: `https://claude.ai/chat/${conversation}`,
    settingsPrefix: 'gvTimeline:claude:',
    stars: { matchLegacyConversations: false, resolveAccount: async () => undefined },
    hierarchy: {
      extensionKey: KEY,
      legacyLevelsKey: null,
      legacyCollapsedKey: null,
      adoptUnscopedHierarchy: false,
      ...account,
    },
    resolveMountedTurnId: (id) => id,
    resolveStoredTurnId: (id) => id,
    getStoredTurnIdAliases: (id) => [id],
    canEdit: () => true,
    isCurrent: () => current.has(conversation),
    getConversationTitle: () => conversation,
  };
  const state = new TimelineState(() => {}, policy);
  states.push(state);
  return state;
}

async function open(conversation: string): Promise<TimelineState> {
  const state = create(conversation);
  await state.init();
  return state;
}

beforeEach(() => {
  storage = createMemoryStorage();
  current = new Set();
  readsUntilHold = 0;
  release = null;
  holdWrites = null;
  const get = storage.api.local.get.bind(storage.api.local) as (keys: unknown) => Promise<unknown>;
  const set = storage.api.local.set.bind(storage.api.local);
  const hold = () => new Promise<void>((resolve) => heldWrites.push(resolve));
  // Like chrome.storage, a held read still returns the bucket as it was when the read was issued.
  const local = {
    ...storage.api.local,
    get: async (keys: unknown) => {
      const snapshot = await get(keys);
      if (readsUntilHold > 0 && --readsUntilHold === 0) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return snapshot;
    },
    set: async (items: Record<string, unknown>) => {
      if (holdWrites === 'fail') throw new Error('QUOTA_BYTES quota exceeded');
      if (holdWrites === 'before-commit') await hold();
      await set(items);
      if (holdWrites === 'after-commit') await hold();
    },
  };
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      sendMessage: (_request: unknown, respond: (response: unknown) => void) =>
        respond({ ok: true, messages: [] }),
    },
    storage: { ...chrome.storage, local, onChanged: storage.api.onChanged },
  });
});

afterEach(async () => {
  release?.();
  await releaseWrites();
  await settle();
  states.splice(0).forEach((state) => state.destroy());
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('timeline outline persistence', () => {
  it('a second edit survives the first save’s storage echo', async () => {
    const state = await open('a');
    readsUntilHold = 2;
    state.hierarchy.setMarkerLevel(TURN, 2);
    state.hierarchy.toggleCollapse(TURN);
    await settle(30);
    expect(state.hierarchy.getMarkerLevel(TURN)).toBe(2);
    expect(state.hierarchy.isMarkerCollapsed(TURN)).toBe(true);

    release?.();
    await settle(30);
    expect(state.hierarchy.isMarkerCollapsed(TURN)).toBe(true);
    expect(stored('a')).toMatchObject({ levels: { [TURN]: 2 }, collapsed: [TURN] });
  });

  it('two conversations edited in one page both keep their outline', async () => {
    storage.values.local.set(KEY, {
      conversations: { 'claude:conv:a': outline('a', 2), 'claude:conv:b': outline('b', 2) },
    });
    const a = await open('a');
    const b = await open('b');
    readsUntilHold = 1;
    a.hierarchy.setMarkerLevel(TURN, 3);
    b.hierarchy.setMarkerLevel(TURN, 3);
    await settle(30);
    expect(a.hierarchy.getMarkerLevel(TURN)).toBe(3);

    release?.();
    await settle(30);
    expect(a.hierarchy.getMarkerLevel(TURN)).toBe(3);
    expect(b.hierarchy.getMarkerLevel(TURN)).toBe(3);
    expect(stored('a')?.levels).toEqual({ [TURN]: 3 });
    expect(stored('b')?.levels).toEqual({ [TURN]: 3 });
  });

  it('an outline edit stays on screen when another tab saves the bucket before it lands', async () => {
    storage.values.local.set(KEY, {
      conversations: { 'claude:conv:a': outline('a', 2), 'claude:conv:b': outline('b', 2) },
    });
    const a = await open('a');
    readsUntilHold = 1;
    a.hierarchy.setMarkerLevel(TURN, 3);
    await settle();
    storage.external('local', KEY, {
      conversations: { 'claude:conv:a': outline('a', 2), 'claude:conv:b': outline('b', 3) },
    });
    await settle(30);
    expect(a.hierarchy.getMarkerLevel(TURN)).toBe(3);

    release?.();
    await settle(30);
    expect(a.hierarchy.getMarkerLevel(TURN)).toBe(3);
    expect(stored('a')?.levels).toEqual({ [TURN]: 3 });
  });

  it('an outline edit made just before leaving the conversation is kept', async () => {
    storage.values.local.set(KEY, { conversations: { 'claude:conv:a': outline('a', 2) } });
    const state = await open('a');
    readsUntilHold = 1;
    state.hierarchy.setMarkerLevel(TURN, 3);
    expect(state.hierarchy.getMarkerLevel(TURN)).toBe(3);
    await settle();
    current.delete('a');
    state.destroy();

    release?.();
    await settle(30);
    expect(stored('a')?.levels).toEqual({ [TURN]: 3 });
    expect((await open('a')).hierarchy.getMarkerLevel(TURN)).toBe(3);
  });

  it('the previous account’s outline stays hidden while a switched account is still resolving', async () => {
    const attribute = 'data-test-account';
    const keyFor = (account: string) => buildScopedStorageKey(KEY, account);
    const resolving: Array<(account: string) => void> = [];
    document.documentElement.setAttribute(attribute, 'a');
    try {
      const state = create('a', {
        accountAttributes: [attribute],
        resolveAccountScope: () =>
          new Promise((resolve) =>
            resolving.push((accountKey) => resolve({ accountKey, routeUserId: null })),
          ),
      });
      void state.init();
      await settle();
      document.documentElement.setAttribute(attribute, 'b');
      await settle();
      expect(resolving).toHaveLength(2);

      resolving[0]('a');
      await settle(30);
      storage.external('local', keyFor('a'), {
        conversations: { 'claude:conv:a': outline('a', 3) },
      });
      await settle(30);
      expect(state.hierarchy.getMarkerLevel(TURN)).toBe(1);

      resolving[1]('b');
      await settle(30);
      expect(state.hierarchy.getMarkerLevel(TURN)).toBe(1);
      state.hierarchy.setMarkerLevel(TURN, 2);
      await settle(30);
      expect(storage.values.local.get(keyFor('a'))).toEqual({
        conversations: { 'claude:conv:a': outline('a', 3) },
      });
      expect(storage.values.local.get(keyFor('b'))).toMatchObject({
        conversations: { 'claude:conv:a': { levels: { [TURN]: 2 } } },
      });
    } finally {
      document.documentElement.removeAttribute(attribute);
    }
  });

  it('another tab’s outline change survives this tab’s pending save', async () => {
    const levels = (x: 1 | 2 | 3, y: 1 | 2 | 3) => ({
      conversations: {
        'claude:conv:a': { ...outline('a', 1), levels: { 'c-x': x, 'c-y': y } },
      },
    });
    storage.values.local.set(KEY, levels(2, 2));
    const state = await open('a');
    holdWrites = 'after-commit';
    state.hierarchy.setMarkerLevel('c-x', 3);
    await settle(30);
    expect(heldWrites).toHaveLength(1);
    storage.external('local', KEY, levels(3, 3));
    await settle(30);

    await releaseWrites();
    expect(state.hierarchy.getMarkerLevel('c-y')).toBe(3);
    state.hierarchy.setMarkerLevel('c-x', 2);
    await settle(30);
    expect(stored('a')?.levels).toEqual({ 'c-x': 2, 'c-y': 3 });
  });

  it('re-enabling the timeline mid-save keeps every accepted level', async () => {
    const before = await open('a');
    holdWrites = 'before-commit';
    before.hierarchy.setMarkerLevel('c-a', 2);
    before.hierarchy.setMarkerLevel('c-b', 3);
    await settle(30);
    expect(heldWrites).toHaveLength(1);
    before.destroy();

    const after = create('a');
    const opening = after.init();
    await settle(30);
    heldWrites.shift()?.();
    await settle(30);
    expect(after.hierarchy.getMarkerLevel('c-a')).toBe(2);
    expect(after.hierarchy.getMarkerLevel('c-b')).toBe(3);
    after.hierarchy.setMarkerLevel('c-a', 3);
    await settle(30);

    await releaseWrites();
    await opening;
    expect(stored('a')?.levels).toEqual({ 'c-a': 3, 'c-b': 3 });
    expect(after.hierarchy.getMarkerLevel('c-b')).toBe(3);
  });

  it('a re-enabled timeline shows the newest outline after an old save settles', async () => {
    const before = await open('a');
    holdWrites = 'after-commit';
    before.hierarchy.setMarkerLevel(TURN, 2);
    before.destroy();
    await settle(30);
    expect(heldWrites).toHaveLength(1);
    storage.external('local', KEY, { conversations: { 'claude:conv:a': outline('a', 3) } });
    await settle(30);

    const after = await open('a');
    await releaseWrites();
    expect(stored('a')?.levels).toEqual({ [TURN]: 3 });
    expect(after.hierarchy.getMarkerLevel(TURN)).toBe(3);
  });

  it('a Gemini outline survives a failed move to extension storage', async () => {
    history.replaceState({}, '', '/app/legacy');
    const policy = createGeminiTimelineStoragePolicy(location.href);
    const turn = 's-1111111111111111';
    const levelsKey = policy.hierarchy.legacyLevelsKey!;
    const collapsedKey = policy.hierarchy.legacyCollapsedKey!;
    localStorage.setItem(levelsKey, JSON.stringify({ [turn]: 2 }));
    localStorage.setItem(collapsedKey, JSON.stringify([turn]));
    const mount = async () => {
      const state = new TimelineState(() => {}, policy);
      states.push(state);
      await state.init();
      await settle(30);
      return state;
    };

    holdWrites = 'fail';
    const failed = await mount();
    expect(failed.hierarchy.getMarkerLevel(turn)).toBe(2);
    expect(failed.hierarchy.isMarkerCollapsed(turn)).toBe(true);
    failed.destroy();
    expect(JSON.parse(localStorage.getItem(levelsKey)!)).toEqual({ [turn]: 2 });
    expect(JSON.parse(localStorage.getItem(collapsedKey)!)).toEqual([turn]);

    holdWrites = null;
    const healthy = await mount();
    expect(healthy.hierarchy.getMarkerLevel(turn)).toBe(2);
    expect(healthy.hierarchy.isMarkerCollapsed(turn)).toBe(true);
    expect(
      (storage.values.local.get(StorageKeys.TIMELINE_HIERARCHY) as TimelineHierarchyData)
        .conversations[policy.conversationId],
    ).toMatchObject({ levels: { [turn]: 2 }, collapsed: [turn] });
  });

  it('an older save’s read never hides another tab’s newer outline', async () => {
    const levels = (a: 1 | 2 | 3, b: 1 | 2 | 3) => ({
      conversations: {
        'claude:conv:a': { ...outline('a', 1), levels: { 'c-a': a, 'c-b': b } },
      },
    });
    storage.values.local.set(KEY, levels(3, 2));
    const state = await open('a');
    // The save reads the bucket, writes, then reads it back; hold that read-back.
    readsUntilHold = 2;
    state.hierarchy.setMarkerLevel('c-a', 2);
    await settle(30);
    expect(release).not.toBeNull();
    storage.external('local', KEY, levels(2, 3));
    await settle(30);
    expect(state.hierarchy.getMarkerLevel('c-b')).toBe(3);

    release?.();
    await settle(30);
    expect(state.hierarchy.getMarkerLevel('c-b')).toBe(3);
    expect(stored('a')?.levels).toEqual({ 'c-a': 2, 'c-b': 3 });
  });

  it('a cloud overwrite that drops a Gemini outline doesn’t bring it back on reopen', async () => {
    history.replaceState({}, '', '/app/cleared');
    const policy = createGeminiTimelineStoragePolicy(location.href);
    const turn = 's-1111111111111111';
    storage.values.local.set(StorageKeys.TIMELINE_HIERARCHY, {
      conversations: {
        [policy.conversationId]: {
          conversationUrl: policy.url,
          levels: { [turn]: 2 },
          collapsed: [turn],
          updatedAt: 1,
        },
      },
    });
    const mount = async () => {
      const state = new TimelineState(() => {}, policy);
      states.push(state);
      await state.init();
      await settle(30);
      return state;
    };
    const before = await mount();
    expect(before.hierarchy.getMarkerLevel(turn)).toBe(2);
    storage.external('local', StorageKeys.TIMELINE_HIERARCHY, { conversations: {} });
    await settle(30);
    expect(before.hierarchy.getMarkerLevel(turn)).toBe(1);
    before.destroy();

    const reopened = await mount();
    expect(reopened.hierarchy.getMarkerLevel(turn)).toBe(1);
    expect(reopened.hierarchy.isMarkerCollapsed(turn)).toBe(false);
    expect(storage.values.local.get(StorageKeys.TIMELINE_HIERARCHY)).toEqual({ conversations: {} });
  });

  it('another tab’s change to the same turn shows once my older save settles', async () => {
    storage.values.local.set(KEY, { conversations: { 'claude:conv:a': outline('a', 3) } });
    const state = await open('a');
    // The save reads the bucket, writes, then reads it back; hold that read-back.
    readsUntilHold = 2;
    state.hierarchy.setMarkerLevel(TURN, 2);
    await settle(30);
    expect(release).not.toBeNull();
    storage.external('local', KEY, { conversations: { 'claude:conv:a': outline('a', 3) } });
    await settle(30);

    release?.();
    await settle(30);
    expect(stored('a')?.levels).toEqual({ [TURN]: 3 });
    expect(state.hierarchy.getMarkerLevel(TURN)).toBe(3);
  });
});
