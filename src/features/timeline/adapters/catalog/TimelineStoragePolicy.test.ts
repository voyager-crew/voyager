import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
  settle,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { TimelineState } from '../../TimelineState';
import { routeCatalogOutlineWrites } from '../../__tests__/catalogOutlineBackground';
import { createCatalogTimelineStoragePolicy } from './CatalogTimelineStorage';
import { CatalogTurnOwnership } from './CatalogTurnOwnership';
import type { CatalogTimelineConfig } from './config';
import { starConversationId, turnConversationId } from './conversationId';

const states: TimelineState[] = [];
let storage: MemoryStorage;
const library = new Map<string, StarredMessage[]>();
const accountAttributes = ['data-theme-user-id', 'data-theme-account-id'];
const accountA = 'chatgpt:ab894c1ca59dbaea95295fae9a616794d31cffbfdf53b53649933ca4842b5bca';

function setAccount(userId: string | null, accountId: string | null) {
  for (const [attribute, value] of [
    ['data-theme-user-id', userId],
    ['data-theme-account-id', accountId],
  ] as const) {
    if (value === null) document.documentElement.removeAttribute(attribute);
    else document.documentElement.setAttribute(attribute, value);
  }
}

async function fixture(siteId: string, accountIdAttributes?: readonly string[]) {
  const config: CatalogTimelineConfig = {
    siteId,
    siteLabel: siteId,
    accountIdAttributes,
    turnSelector: '.turn',
    conversationIdPattern: '^/c/([^/?#]+)',
    position: 'right',
    pluginId: `${siteId}.timeline`,
    coachmarkId: 'timeline-style',
  };
  const ownership = new CatalogTurnOwnership({
    routeId: () => location.href.split('#')[0],
    starId: () => starConversationId(config),
    turnConversation: (element) => turnConversationId(config, element),
  });
  ownership.begin();
  const element = document.createElement('div');
  document.body.appendChild(element);
  ownership.recordInsertions([{ addedNodes: [element] } as unknown as MutationRecord]);
  ownership.observe([{ element, hash: 'turn' }]);
  const policy = createCatalogTimelineStoragePolicy(config, ownership);
  const state = new TimelineState(vi.fn(), policy);
  states.push(state);
  state.replaceMarkers([
    { id: 'c-turn', element, summary: 'Prompt', assistantSummary: '', baseN: 0, starred: false },
  ]);
  await state.init();
  return state;
}

function hierarchyKeys(): string[] {
  return [...storage.values.local.keys()].filter((key) =>
    key.startsWith('gvCatalogTimelineHierarchy:'),
  );
}

function storedOutline(key: string, conversationId: string): unknown {
  const blob = storage.values.local.get(key) as
    | { conversations: Record<string, unknown> }
    | undefined;
  return blob?.conversations[conversationId];
}

beforeEach(() => {
  vi.restoreAllMocks();
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { ...chrome.runtime, sendMessage: routeCatalogOutlineWrites() },
    storage: { ...chrome.storage, local: storage.api.local, onChanged: storage.api.onChanged },
  });
  history.replaceState({}, '', '/c/one');
  localStorage.clear();
  document.body.replaceChildren();
  setAccount(null, null);
  library.clear();
  vi.spyOn(StarredMessagesService, 'getStarredMessagesForConversation').mockImplementation(
    async (conversationId) => library.get(conversationId) ?? [],
  );
  vi.spyOn(StarredMessagesService, 'addStarredMessage').mockImplementation(async (message) => {
    library.set(message.conversationId, [
      ...(library.get(message.conversationId) ?? []).filter(
        (stored) => stored.turnId !== message.turnId,
      ),
      message,
    ]);
  });
  vi.spyOn(StarredMessagesService, 'removeStarredMessage').mockImplementation(
    async (conversationId, turnId) => {
      library.set(
        conversationId,
        (library.get(conversationId) ?? []).filter((stored) => stored.turnId !== turnId),
      );
    },
  );
});

afterEach(() => {
  states.splice(0).forEach((state) => state.destroy());
  setAccount(null, null);
  vi.unstubAllGlobals();
});

describe('ChatGPT star accounts', () => {
  it.each([
    { label: 'omitted', attributes: undefined },
    { label: 'empty', attributes: [] },
  ])('a site with $label account attributes leaves its stars untagged', async ({ attributes }) => {
    setAccount('user-account-a', 'workspace-a');
    const state = await fixture('chatgpt', attributes);
    await state.toggleStar('c-turn');
    const message = library.get('chatgpt:conv:one')?.[0];
    expect(message).toMatchObject({ content: 'Prompt' });
    expect(message).not.toHaveProperty('account');
  });

  it('a configured site stamps stars from its own attribute names under its own namespace', async () => {
    document.documentElement.setAttribute('data-example-user', 'user-account-a');
    document.documentElement.setAttribute('data-example-workspace', 'workspace-a');
    try {
      const state = await fixture('example', ['data-example-user', 'data-example-workspace']);
      await state.toggleStar('c-turn');
      expect(library.get('example:conv:one')?.[0].account).toBe(
        accountA.replace('chatgpt:', 'example:'),
      );
    } finally {
      document.documentElement.removeAttribute('data-example-user');
      document.documentElement.removeAttribute('data-example-workspace');
    }
  });

  it('a star added on account A carries A’s opaque key even when the attributes change after the press', async () => {
    const state = await fixture('chatgpt', accountAttributes);
    setAccount('user-account-a', 'workspace-a');
    const pressed = state.toggleStar('c-turn');
    setAccount('user-account-b', 'workspace-b');
    await pressed;
    expect(library.get('chatgpt:conv:one')?.[0].account).toBe(accountA);

    await state.toggleStar('c-turn');
    await state.toggleStar('c-turn');
    const nextAccount = library.get('chatgpt:conv:one')?.[0].account;
    expect(nextAccount).toMatch(/^chatgpt:[a-f0-9]{64}$/);
    expect(nextAccount).not.toBe(accountA);
  });

  it.each([
    [null, null],
    [null, 'workspace-a'],
    ['user-account-a', null],
    ['', 'workspace-a'],
    ['user-account-a', ''],
  ])(
    'a star has no account when either theme attribute is missing or empty (%s, %s)',
    async (userId, accountId) => {
      setAccount(userId, accountId);
      const state = await fixture('chatgpt', accountAttributes);
      await state.toggleStar('c-turn');
      const message = library.get('chatgpt:conv:one')?.[0];
      expect(message).toMatchObject({ turnId: 'c-turn', content: 'Prompt' });
      expect(message).not.toHaveProperty('account');
    },
  );

  it('the same account pair keeps its key after the document and timeline are recreated', async () => {
    setAccount('user-account-a', 'workspace-a');
    const first = await fixture('chatgpt', accountAttributes);
    await first.toggleStar('c-turn');
    const originalKey = library.get('chatgpt:conv:one')?.[0].account;
    expect(originalKey).toBe(accountA);
    first.destroy();
    library.clear();
    document.body.replaceChildren();
    setAccount(null, null);
    setAccount('user-account-a', 'workspace-a');

    const reloaded = await fixture('chatgpt', accountAttributes);
    await reloaded.toggleStar('c-turn');
    expect(library.get('chatgpt:conv:one')?.[0].account).toBe(originalKey);
  });

  it.each([
    ['user-account-b', 'workspace-a'],
    ['user-account-a', 'workspace-b'],
  ])(
    'changing either part of the account pair gives a star a different key (%s, %s)',
    async (userId, accountId) => {
      const state = await fixture('chatgpt', accountAttributes);
      setAccount(userId, accountId);
      await state.toggleStar('c-turn');
      const key = library.get('chatgpt:conv:one')?.[0].account;
      expect(key).toMatch(/^chatgpt:[a-f0-9]{64}$/);
      expect(key).not.toBe(accountA);
    },
  );

  it.each(['claude', 'deepseek'])(
    '%s stars stay untagged even when ChatGPT theme attributes exist',
    async (siteId) => {
      setAccount('user-account-a', 'workspace-a');
      const state = await fixture(siteId);
      await state.toggleStar('c-turn');
      const message = library.get(`${siteId}:conv:one`)?.[0];
      expect(message).toMatchObject({ turnId: 'c-turn', content: 'Prompt' });
      expect(message).not.toHaveProperty('account');
    },
  );
});

describe.each(['chatgpt', 'claude', 'deepseek'])('%s shared timeline storage policy', (siteId) => {
  it('a hierarchy survives the site clearing its localStorage and saves stars through the Library', async () => {
    const state = await fixture(siteId);
    const conversationId = `${siteId}:conv:one`;
    state.hierarchy.setMarkerLevel('c-turn', 2);
    state.hierarchy.toggleCollapse('c-turn');
    await settle(30);
    expect(localStorage.length).toBe(0);
    expect(storedOutline(`gvCatalogTimelineHierarchy:${siteId}`, conversationId)).toMatchObject({
      conversationUrl: `${location.origin}/c/one`,
      levels: { 'c-turn': 2 },
      collapsed: ['c-turn'],
    });

    state.destroy();
    localStorage.clear();
    const reopened = await fixture(siteId);
    expect(reopened.hierarchy.getMarkerLevel('c-turn')).toBe(2);
    expect(reopened.hierarchy.isMarkerCollapsed('c-turn')).toBe(true);

    reopened.hierarchy.setMarkerLevel('c-turn', 1);
    reopened.hierarchy.toggleCollapse('c-turn');
    await settle(30);
    expect(storedOutline(`gvCatalogTimelineHierarchy:${siteId}`, conversationId)).toBeUndefined();

    await reopened.toggleStar('c-turn');
    expect(StarredMessagesService.addStarredMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId, turnId: 'c-turn' }),
    );
    expect(reopened.markers[0].starred).toBe(true);
    expect(
      vi.mocked(StarredMessagesService.addStarredMessage).mock.calls.at(-1)?.[0].account,
    ).toBeUndefined();
  });

  it('a level set in another tab of the same conversation appears without a reload', async () => {
    const editor = await fixture(siteId);
    const viewer = await fixture(siteId);
    editor.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();
    expect(viewer.hierarchy.getMarkerLevel('c-turn')).toBe(3);
  });

  it('refuses stars and hierarchy edits after its captured route is replaced', async () => {
    const state = await fixture(siteId);
    history.replaceState({}, '', '/c/two');
    state.hierarchy.setMarkerLevel('c-turn', 2);
    state.hierarchy.toggleCollapse('c-turn');
    await state.toggleStar('c-turn');
    await settle();
    expect(hierarchyKeys()).toEqual([]);
    expect(StarredMessagesService.addStarredMessage).not.toHaveBeenCalled();
  });

  it('keeps unnamed new-chat turns outside persisted conversation state', async () => {
    history.replaceState({}, '', '/');
    const state = await fixture(siteId);
    state.hierarchy.setMarkerLevel('c-turn', 2);
    state.hierarchy.toggleCollapse('c-turn');
    await state.toggleStar('c-turn');
    await settle();
    expect(hierarchyKeys()).toEqual([]);
    expect(StarredMessagesService.getStarredMessagesForConversation).not.toHaveBeenCalled();
    expect(StarredMessagesService.addStarredMessage).not.toHaveBeenCalled();
  });
});

describe('catalog hierarchy storage boundaries', () => {
  it('two catalog sites keep separate hierarchies for the same conversation path', async () => {
    const chatgpt = await fixture('chatgpt');
    chatgpt.hierarchy.setMarkerLevel('c-turn', 2);
    const claude = await fixture('claude');
    claude.hierarchy.toggleCollapse('c-turn');
    await settle();

    expect(hierarchyKeys().sort()).toEqual([
      'gvCatalogTimelineHierarchy:chatgpt',
      'gvCatalogTimelineHierarchy:claude',
    ]);
    expect(storedOutline('gvCatalogTimelineHierarchy:chatgpt', 'chatgpt:conv:one')).toMatchObject({
      levels: { 'c-turn': 2 },
      collapsed: [],
    });
    expect(storedOutline('gvCatalogTimelineHierarchy:claude', 'claude:conv:one')).toMatchObject({
      levels: {},
      collapsed: ['c-turn'],
    });

    const reopenedClaude = await fixture('claude');
    expect(reopenedClaude.hierarchy.getMarkerLevel('c-turn')).toBe(1);
    expect(reopenedClaude.hierarchy.isMarkerCollapsed('c-turn')).toBe(true);
  });

  it('a ChatGPT outline saved on account A stays hidden from account B on the same browser', async () => {
    setAccount('user-account-a', 'workspace-a');
    const onA = await fixture('chatgpt', accountAttributes);
    onA.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    onA.destroy();

    setAccount('user-account-b', 'workspace-b');
    const onB = await fixture('chatgpt', accountAttributes);
    onB.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();
    onB.destroy();

    setAccount('user-account-a', 'workspace-a');
    expect((await fixture('chatgpt', accountAttributes)).hierarchy.getMarkerLevel('c-turn')).toBe(
      2,
    );
    setAccount('user-account-b', 'workspace-b');
    expect((await fixture('chatgpt', accountAttributes)).hierarchy.getMarkerLevel('c-turn')).toBe(
      3,
    );
    expect(hierarchyKeys()).toHaveLength(2);
    expect(storage.values.local.has('gvCatalogTimelineHierarchy:chatgpt')).toBe(false);
  });

  it('a ChatGPT outline saved before the account was known never appears for another account', async () => {
    const unknown = await fixture('chatgpt', accountAttributes);
    await unknown.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    expect(hierarchyKeys()).toEqual([]);
    unknown.destroy();

    setAccount('user-account-b', 'workspace-b');
    const onB = await fixture('chatgpt', accountAttributes);
    expect(onB.hierarchy.getMarkerLevel('c-turn')).toBe(1);
  });

  it('a ChatGPT outline appears and accepts edits once the account becomes known', async () => {
    setAccount('user-account-a', 'workspace-a');
    const before = await fixture('chatgpt', accountAttributes);
    before.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    before.destroy();
    setAccount(null, null);

    const state = await fixture('chatgpt', accountAttributes);
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(1);
    setAccount('user-account-a', 'workspace-a');
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(2);
    state.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();
    expect(hierarchyKeys()).toEqual([
      expect.stringMatching(/^gvCatalogTimelineHierarchy:chatgpt:acct:/),
    ]);
    expect(storedOutline(hierarchyKeys()[0], 'chatgpt:conv:one')).toMatchObject({
      levels: { 'c-turn': 3 },
    });
  });

  it('a ChatGPT outline edit after switching accounts saves under the new account', async () => {
    setAccount('user-account-a', 'workspace-a');
    const state = await fixture('chatgpt', accountAttributes);
    state.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    const [keyA] = hierarchyKeys();

    setAccount('user-account-b', 'workspace-b');
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(1);
    state.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();

    const keyB = hierarchyKeys().find((key) => key !== keyA);
    expect(storedOutline(keyA, 'chatgpt:conv:one')).toMatchObject({ levels: { 'c-turn': 2 } });
    expect(storedOutline(keyB!, 'chatgpt:conv:one')).toMatchObject({ levels: { 'c-turn': 3 } });
    setAccount('user-account-a', 'workspace-a');
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(2);
  });

  it('an edit made in the same moment the ChatGPT account changes never lands in the old account', async () => {
    setAccount('user-account-a', 'workspace-a');
    const state = await fixture('chatgpt', accountAttributes);
    state.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    const [keyA] = hierarchyKeys();

    setAccount('user-account-b', 'workspace-b');
    state.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();
    await state.hierarchy.init();
    expect(storedOutline(keyA, 'chatgpt:conv:one')).toMatchObject({ levels: { 'c-turn': 2 } });
    expect(hierarchyKeys()).toEqual([keyA]);
  });

  it('signing out of ChatGPT hides the outline and refuses edits', async () => {
    setAccount('user-account-a', 'workspace-a');
    const state = await fixture('chatgpt', accountAttributes);
    state.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    const [keyA] = hierarchyKeys();

    setAccount(null, null);
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(1);
    await state.hierarchy.setMarkerLevel('c-turn', 3);
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(1);
    expect(hierarchyKeys()).toEqual([keyA]);
    expect(storedOutline(keyA, 'chatgpt:conv:one')).toMatchObject({ levels: { 'c-turn': 2 } });
  });

  it('a ChatGPT account switch during the first outline read shows the new account', async () => {
    setAccount('user-account-a', 'workspace-a');
    const onA = await fixture('chatgpt', accountAttributes);
    onA.hierarchy.setMarkerLevel('c-turn', 2);
    await settle();
    onA.destroy();

    const opening = fixture('chatgpt', accountAttributes);
    setAccount('user-account-b', 'workspace-b');
    const state = await opening;
    await settle();
    await state.hierarchy.init();
    expect(state.hierarchy.getMarkerLevel('c-turn')).toBe(1);
  });
});
