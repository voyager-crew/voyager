import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createStarStore } from '@/features/savedLibrary/starStore';
import type { StarredMessage, StarredMessagesData } from '@/features/savedLibrary/starTypes';
import { isHandledBackgroundRuntimeMessage } from '@/pages/background/runtimeMessageRouting';
import { createStarredMessagesHandler } from '@/pages/background/starredMessages';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';
import { TimelineTurns } from '@/pages/content/timeline/TimelineTurns';

import { TimelineState } from '../TimelineState';
import type { TimelineStoragePolicy } from '../TimelineStoragePolicy';
import { CatalogTimelineAdapter } from '../adapters/catalog/CatalogTimelineAdapter';
import { CatalogTurnOwnership } from '../adapters/catalog/CatalogTurnOwnership';
import type { CatalogTimelineConfig } from '../adapters/catalog/config';
import { starConversationId } from '../adapters/catalog/conversationId';

const conversationId = 'gemini:conv:full-text';
const url = 'https://gemini.google.com/app/full-text';
const turnId = 's-1111111111111111';
const states: TimelineState[] = [];
const star = (id = turnId): StarredMessage => ({
  conversationId,
  conversationUrl: url,
  turnId: id,
  content: 'First line Second line',
  starredAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  history.replaceState({}, '', '/app/full-text');
  localStorage.clear();
});
afterEach(() => {
  states.splice(0).forEach((state) => state.destroy());
  vi.restoreAllMocks();
});

function library(messages: StarredMessage[], id = conversationId) {
  const data: StarredMessagesData = { messages: { [id]: messages } };
  const values: Record<string, unknown> = {
    [StorageKeys.SAVED_LIBRARY_STARS]: structuredClone(data),
    [StorageKeys.TIMELINE_STARRED_MESSAGES]: structuredClone(data),
    [StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES]: [],
  };
  const area = {
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes = Object.fromEntries(
        Object.entries(items).map(([key, newValue]) => [
          key,
          { oldValue: values[key], newValue: structuredClone(newValue) },
        ]),
      );
      Object.assign(values, structuredClone(items));
      for (const [receive] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls)
        receive(changes, 'local');
    }),
  };
  const store = createStarStore(area);
  const handle = createStarredMessagesHandler(store);
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: unknown,
    reply: (response: unknown) => void,
  ) => {
    if (!isHandledBackgroundRuntimeMessage(request)) throw new Error('Unregistered action');
    void handle(request)?.then(reply, (error: Error) => reply({ ok: false, error: error.message }));
  }) as typeof chrome.runtime.sendMessage);
  return { store, area, values };
}

function timeline(policy: TimelineStoragePolicy): TimelineState {
  const state = new TimelineState(() => {}, policy);
  states.push(state);
  return state;
}

function fixture(messages: StarredMessage[] = []) {
  const { store, area, values } = library(messages);
  const policy = {
    ...createGeminiTimelineStoragePolicy(url, {
      resolveCanonicalTurnId: (_conversation, id) => (id === 'u-0' ? turnId : id),
      getTurnIdAliases: () => [turnId, 'u-0'],
    }),
    hierarchy: {
      extensionKey: StorageKeys.TIMELINE_HIERARCHY,
      legacyLevelsKey: null,
      legacyCollapsedKey: null,
      adoptUnscopedHierarchy: false,
      accountAttributes: [],
      resolveAccountScope: async () => null,
    },
    stars: { matchLegacyConversations: true, resolveAccount: async () => undefined },
  };
  const state = timeline(policy);
  const mount = (id = turnId, extra = '') => {
    document.body.innerHTML = `<main><user-query data-turn-id="${id}">First line
Second line${extra}</user-query><model-response>Answer stays in the conversation</model-response></main>`;
    const markers = new TimelineTurns().plan(document.querySelector('main')!, 'user-query').markers;
    state.replaceMarkers(markers);
    return markers;
  };
  return { state, store, area, values, mount, policy };
}

it('a starred prompt keeps its line breaks through the real timeline and Library store', async () => {
  const { state, store, mount } = fixture();
  await state.init();
  mount();
  await state.toggleStar(turnId);
  expect(await store.getForConversation(conversationId)).toEqual([
    expect.objectContaining({
      content: 'First line Second line',
      text: 'First line\nSecond line',
    }),
  ]);
});

it("text hidden by the site's stylesheet never enters a starred prompt", async () => {
  const { state, store, mount } = fixture();
  const sheet = document.createElement('style');
  sheet.textContent = '.host-internal { display: none } .host-alternative { visibility: hidden }';
  document.head.append(sheet);
  try {
    await state.init();
    mount(
      turnId,
      '<span class="host-internal">Internal label</span><span class="host-alternative">Other draft</span>',
    );
    await state.toggleStar(turnId);
    expect((await store.getForConversation(conversationId))[0]?.text).toBe(
      'First line\nSecond line',
    );
  } finally {
    sheet.remove();
  }
});

function withSheet(css: string): () => void {
  const sheet = document.createElement('style');
  sheet.textContent = css;
  document.head.append(sheet);
  return () => sheet.remove();
}

it('a formula hidden by the site never enters a starred prompt', async () => {
  const { state, store, mount } = fixture();
  const removeSheet = withSheet(
    '.host-folded { visibility: hidden } .host-shown { visibility: visible }',
  );
  try {
    await state.init();
    mount(
      turnId,
      '<span class="host-folded" data-user-latex-original="$secret$">rendered secret</span>' +
        '<span class="host-folded"><span class="host-shown" data-user-latex-original="$x$">x</span></span>',
    );
    await state.toggleStar(turnId);
    expect((await store.getForConversation(conversationId))[0]?.text).toBe(
      'First line\nSecond line$x$',
    );
  } finally {
    removeSheet();
  }
});

it('a hidden highlight never enters a starred prompt', async () => {
  const { state, store, mount } = fixture();
  const removeSheet = withSheet('.host-collapsed { display: none }');
  try {
    await state.init();
    mount(
      turnId,
      ' <mark class="gv-highlight-mark" role="button">kept</mark>' +
        '<span class="host-collapsed"><mark class="gv-highlight-mark">secret</mark></span>' +
        '<mark class="gv-highlight-mark" hidden>also secret</mark>',
    );
    await state.toggleStar(turnId);
    expect((await store.getForConversation(conversationId))[0]?.text).toBe(
      'First line\nSecond line kept',
    );
  } finally {
    removeSheet();
  }
});

it('recalculating an unchanged conversation reads no computed styles', async () => {
  const mismatched = { ...star('s-2222222222222222'), content: 'A prompt that was since edited' };
  const { state, store, mount } = fixture([star(), mismatched]);
  await state.init();
  mount();
  document
    .querySelector('main')!
    .insertAdjacentHTML(
      'beforeend',
      '<user-query data-turn-id="s-2222222222222222">Edited prompt</user-query>',
    );
  const collect = () =>
    state.replaceMarkers(
      new TimelineTurns().plan(document.querySelector('main')!, 'user-query').markers,
    );
  collect();
  await vi.waitFor(async () =>
    expect((await store.getForConversation(conversationId))[0]?.text).toBe(
      'First line\nSecond line',
    ),
  );
  const styles = vi.spyOn(globalThis, 'getComputedStyle');
  collect();
  collect();
  expect(styles).not.toHaveBeenCalled();
  expect((await store.getForConversation(conversationId))[1]?.text).toBeUndefined();
});

it('rapidly re-starring a prompt keeps the text it had when pressed', async () => {
  const { state, store, mount } = fixture([{ ...star(), text: 'First line\nSecond line' }]);
  await state.init();
  const [marker] = mount();
  const unstarring = state.toggleStar(turnId);
  const restarring = state.toggleStar(turnId);
  marker!.element.textContent = 'Changed after second press';
  await Promise.all([unstarring, restarring]);
  expect(await store.getForConversation(conversationId)).toEqual([
    expect.objectContaining({ turnId, text: 'First line\nSecond line' }),
  ]);
});

it('a newer synced star for an edited prompt still gets its full text', async () => {
  const edited = { ...star(), content: 'Old prompt before an edit' };
  const { state, store, area, mount } = fixture([edited]);
  await state.init();
  mount();
  expect(area.set).not.toHaveBeenCalled();
  const newer = { ...edited, content: 'First line', starredAt: 2 };
  await store.mergeCloud({ data: { messages: { [conversationId]: [newer] } } });
  await vi.waitFor(async () =>
    expect(await store.getForConversation(conversationId)).toEqual([
      { ...newer, text: 'First line\nSecond line' },
    ]),
  );
});

it('opening an old conversation fills in the full text of its stars once', async () => {
  const { state, store, area, mount, values } = fixture([star()]);
  await state.init();
  const markers = mount();
  expect(await store.getForConversation(conversationId)).toEqual([
    { ...star(), text: 'First line\nSecond line' },
  ]);
  expect(area.set).toHaveBeenCalledTimes(1);
  expect(values[StorageKeys.TIMELINE_STARRED_MESSAGES]).toEqual({
    messages: { [conversationId]: [star()] },
  });
  state.replaceMarkers(markers);
  await store.getAll();
  expect(area.set).toHaveBeenCalledTimes(1);
});

it('an initial Library read arriving after the turns mount still backfills their full text', async () => {
  const { state, store, mount } = fixture([star()]);
  mount();
  await state.init();
  expect(await store.getForConversation(conversationId)).toEqual([
    { ...star(), text: 'First line\nSecond line' },
  ]);
});

it('backfill enriches a verified stored alias without creating another star', async () => {
  const { state, store, mount } = fixture([star('u-0')]);
  await state.init();
  mount();
  expect(await store.getForConversation(conversationId)).toEqual([
    { ...star('u-0'), text: 'First line\nSecond line' },
  ]);
});

it('an unverified mounted fallback cannot fill another stored turn with its text', async () => {
  const { state, store, area, mount } = fixture([star('u-0')]);
  await state.init();
  mount('u-0');
  expect(await store.getForConversation(conversationId)).toEqual([star('u-0')]);
  expect(area.set).not.toHaveBeenCalled();
});

it('a disconnected remembered marker cannot backfill an unopened turn', async () => {
  const { state, store, area, mount } = fixture([star()]);
  const markers = mount();
  document.body.replaceChildren();
  await state.init();
  state.replaceMarkers(markers);
  expect(await store.getForConversation(conversationId)).toEqual([star()]);
  expect(area.set).not.toHaveBeenCalled();
});

it('a destroyed timeline does not backfill from a late Library read', async () => {
  const { state, store, area, mount } = fixture([star()]);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const get = area.get.getMockImplementation()!;
  area.get.mockImplementationOnce(async () => {
    await waiting;
    return get();
  });
  mount();
  const initializing = state.init();
  state.destroy();
  release();
  await initializing;
  expect(await store.getForConversation(conversationId)).toEqual([star()]);
  expect(area.set).not.toHaveBeenCalled();
});

it('a star press keeps the full text captured before account lookup yields', async () => {
  const { state, store, mount, policy } = fixture();
  await state.init();
  const [marker] = mount();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  policy.stars.resolveAccount = async () => {
    await waiting;
    return undefined;
  };
  const pressing = state.toggleStar(turnId);
  marker!.element.textContent = 'Changed after the press';
  release();
  await pressing;
  expect((await store.getForConversation(conversationId))[0]?.text).toBe('First line\nSecond line');
});

it('navigation before delayed teardown cannot backfill the old route from a late Library read', async () => {
  const { state, store, area, mount } = fixture([star()]);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const get = area.get.getMockImplementation()!;
  area.get.mockImplementationOnce(async () => {
    await waiting;
    return get();
  });
  mount();
  const initializing = state.init();
  history.replaceState({}, '', '/app/next-conversation');
  release();
  await initializing;
  expect(await store.getForConversation(conversationId)).toEqual([star()]);
  expect(area.set).not.toHaveBeenCalled();
});

it('navigation during account lookup keeps a full-text star press on its captured route', async () => {
  const { state, store, mount, policy } = fixture();
  await state.init();
  mount();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  policy.stars.resolveAccount = async () => {
    await waiting;
    return undefined;
  };
  const pressing = state.toggleStar(turnId);
  history.replaceState({}, '', '/app/next-conversation');
  release();
  await pressing;
  expect(await store.getForConversation(conversationId)).toEqual([
    expect.objectContaining({ conversationUrl: url, text: 'First line\nSecond line' }),
  ]);
});

it("a repeated prompt's star gets its own text, not its twin's", async () => {
  history.replaceState({}, '', '/c/repeated');
  const config: CatalogTimelineConfig = {
    siteId: 'chatgpt',
    siteLabel: 'ChatGPT',
    turnSelector: '[data-user-message-bubble]',
    conversationIdPattern: '^/c/([^/?#]+)',
    position: 'right',
    pluginId: 'voyager.chatgpt-timeline',
    coachmarkId: 'test',
  };
  document.body.innerHTML =
    '<main><div data-user-message-bubble>First\nSecond</div><div data-user-message-bubble>First Second</div></main>';
  const ownership = new CatalogTurnOwnership({
    routeId: () => location.href.split('#')[0],
    starId: () => starConversationId(config),
  });
  ownership.begin();
  const adapter = new CatalogTimelineAdapter(config, ownership);
  try {
    const both = adapter.turns.read([]).markers;
    const twin = both[1]!;
    expect(twin.id).toBe(`${both[0]!.id}~2`);
    const stored: StarredMessage = {
      conversationId: adapter.storage.conversationId,
      conversationUrl: adapter.storage.url,
      turnId: twin.id,
      content: twin.summary,
      starredAt: 1,
    };
    const { store, area } = library([stored], adapter.storage.conversationId);
    const state = timeline(adapter.storage);
    twin.element.remove();
    const firstOnly = adapter.turns.read(both).markers;
    state.replaceMarkers(firstOnly);
    await state.init();
    expect(await store.getForConversation(stored.conversationId)).toEqual([stored]);
    expect(area.set).not.toHaveBeenCalled();

    document.querySelector('main')!.append(twin.element);
    state.replaceMarkers(adapter.turns.read(firstOnly).markers);
    await vi.waitFor(async () =>
      expect(await store.getForConversation(stored.conversationId)).toEqual([
        { ...stored, text: 'First Second' },
      ]),
    );
  } finally {
    adapter.turns.stop();
  }
});
