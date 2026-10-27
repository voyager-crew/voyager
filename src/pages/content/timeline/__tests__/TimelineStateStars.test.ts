import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import type { StarredMessage, StarredMessagesData } from '@/features/savedLibrary/starTypes';
import {
  type TimelineDataSession,
  createTimelineDataSession,
} from '@/features/timeline/TimelineDataSession';
import type { TimelineMarker } from '@/features/timeline/types';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';

import { HistoryTimestampStore } from '../../timestamp/historyTimestamps';
import { TimelineTurns } from '../TimelineTurns';

const CONVERSATION_ID = 'gemini:conv:abc';
const FIRST_ID = 's-1111111111111111';
const TAIL_ID = 's-6060606060606060';
const states: TimelineDataSession[] = [];
function marker(id: string, summary: string): TimelineMarker {
  return {
    id,
    element: document.createElement('div'),
    summary,
    assistantSummary: '',
    baseN: 0,
    starred: false,
  };
}
function message(turnId: string, content: string): StarredMessage {
  return {
    turnId,
    content,
    conversationId: CONVERSATION_ID,
    conversationUrl: 'https://gemini.google.com/app/abc',
    starredAt: 1700000000000,
  };
}
async function setup(
  markers: TimelineMarker[],
  messages: StarredMessage[] = [],
  aliases = new Map<string, string>(),
) {
  const legacyByServer = new Map(Array.from(aliases, ([legacy, server]) => [server, legacy]));
  vi.spyOn(StarredMessagesService, 'getAllStarredMessages').mockResolvedValue({
    messages: { [CONVERSATION_ID]: messages },
  });
  const state = createTimelineDataSession({
    onChange: vi.fn(),
    policy: createGeminiTimelineStoragePolicy(window.location.href, {
      resolveCanonicalTurnId: (_cid, id) => (id.startsWith('s-') ? id : (aliases.get(id) ?? null)),
      getTurnIdAliases: (_cid, id) =>
        legacyByServer.has(id) ? [id, legacyByServer.get(id)!] : [id],
    }),
  });
  states.push(state);
  await state.init();
  state.replaceMarkers(markers);
  return state;
}
const storedStars = () =>
  JSON.parse(localStorage.getItem(`geminiTimelineStars:${CONVERSATION_ID}`) ?? '[]');

describe('TimelineState stars in a partially mounted conversation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    history.replaceState({}, '', '/app/abc');
    localStorage.clear();
    vi.restoreAllMocks();
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
    vi.mocked(chrome.storage.local.set).mockResolvedValue();
  });
  afterEach(() => states.splice(0).forEach((state) => state.destroy()));
  it('does not paint legacy u-0 on the first mounted tail turn without a history map (#871)', async () => {
    const state = await setup(
      [marker(TAIL_ID, 'please continue')],
      [message('u-0', 'please continue')],
    );
    expect(state.markers[0].starred).toBe(false);
  });
  it('maps u-0 to its server turn even when only a later tail is mounted first', async () => {
    const state = await setup(
      [marker(TAIL_ID, 'please continue'), marker(FIRST_ID, 'please continue')],
      [message('u-0', 'please continue')],
      new Map([['u-0', FIRST_ID]]),
    );
    expect(state.markers.map((marker) => marker.starred)).toEqual([false, true]);
  });
  it('a mounted fallback cannot inherit a full-history turn’s star or deep link', async () => {
    const cache = new HistoryTimestampStore();
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
      [StorageKeys.GV_TURN_IDENTITY_CACHE]: {
        version: 1,
        conversations: { c_abc: { turnIds: [FIRST_ID, TAIL_ID], updatedAt: 1 } },
      },
    }));
    await cache.start();
    try {
      expect(cache.resolveCanonicalTurnId('abc', 'u-0')).toBe(FIRST_ID);
      const main = document.createElement('main');
      main.innerHTML = '<div class="user">Mounted tail without a server ID</div>';
      document.body.append(main);
      const turns = new TimelineTurns();
      const mounted = turns.commit(turns.plan(main, '.user'));
      expect(mounted[0].id).toBe('u-0');
      vi.spyOn(StarredMessagesService, 'getAllStarredMessages').mockResolvedValue({
        messages: { [CONVERSATION_ID]: [message(FIRST_ID, 'First'), message('u-0', 'First')] },
      });
      const state = createTimelineDataSession({
        onChange: vi.fn(),
        policy: createGeminiTimelineStoragePolicy(location.href, cache),
      });
      states.push(state);
      await state.init();
      state.replaceMarkers(mounted);
      expect(state.markers[0].starred).toBe(false);
      expect(state.resolveMarkerIdForStorageId(FIRST_ID)).not.toBe('u-0');
      expect(state.resolveMarkerIdForStorageId('u-0')).not.toBe('u-0');
      // A real server-identified node may still receive both verified stored aliases.
      main.insertAdjacentHTML(
        'afterbegin',
        '<div class="conversation-container" id="1111111111111111"><div class="user">First</div></div>',
      );
      state.replaceMarkers(turns.commit(turns.plan(main, '.user', state.markers)));
      expect(state.markers.map((turn) => turn.starred)).toEqual([true, false]);
      expect(state.resolveMarkerIdForStorageId('u-0')).toBe(FIRST_ID);
    } finally {
      cache.stop();
    }
  });
  it('removes every verified stored alias when un-starring', async () => {
    const saved = [message('u-0', 'first prompt'), message(FIRST_ID, 'first prompt')];
    const remove = vi
      .spyOn(StarredMessagesService, 'removeStarredMessage')
      .mockImplementation(async (_conversation, id) => {
        const index = saved.findIndex((item) => item.turnId === id);
        if (index !== -1) saved.splice(index, 1);
      });
    const state = await setup(
      [marker(FIRST_ID, 'first prompt')],
      saved,
      new Map([['u-0', FIRST_ID]]),
    );
    await state.toggleStar(FIRST_ID);
    expect(remove).toHaveBeenCalledWith(CONVERSATION_ID, 'u-0');
    expect(remove).toHaveBeenCalledWith(CONVERSATION_ID, FIRST_ID);
    expect(state.markers[0].starred).toBe(false);
  });
  it('a failed timeline star removal repaints the saved star and a later press works', async () => {
    let saved = [message(FIRST_ID, 'first prompt')];
    const state = await setup([marker(FIRST_ID, 'first prompt')], saved);
    vi.mocked(StarredMessagesService.getAllStarredMessages).mockImplementation(async () => ({
      messages: { [CONVERSATION_ID]: saved },
    }));
    const remove = vi.spyOn(StarredMessagesService, 'removeStarredMessage');
    remove.mockRejectedValueOnce(new Error('storage unavailable'));
    remove.mockImplementationOnce(async () => {
      saved = [];
    });
    await state.toggleStar(FIRST_ID);
    expect(state.markers[0].starred).toBe(true);
    expect(saved.map((item) => item.turnId)).toEqual([FIRST_ID]);
    await state.toggleStar(FIRST_ID);
    expect(state.markers[0].starred).toBe(false);
    expect(saved).toEqual([]);
  });

  it('a failed timeline star addition stays unstarred and a later press works', async () => {
    let saved: StarredMessage[] = [];
    const state = await setup([marker(FIRST_ID, 'first prompt')]);
    vi.mocked(StarredMessagesService.getAllStarredMessages).mockImplementation(async () => ({
      messages: { [CONVERSATION_ID]: saved },
    }));
    const add = vi.spyOn(StarredMessagesService, 'addStarredMessage');
    add.mockRejectedValueOnce(new Error('storage unavailable'));
    add.mockImplementationOnce(async (item) => {
      saved = [item];
    });
    await state.toggleStar(FIRST_ID);
    expect(state.markers[0].starred).toBe(false);
    await state.toggleStar(FIRST_ID);
    expect(state.markers[0].starred).toBe(true);
    expect(saved.map((item) => item.turnId)).toEqual([FIRST_ID]);
  });

  it('a failed star edit starts a fresh recovery read while the initial read is still pending', async () => {
    let releaseInitial!: (data: StarredMessagesData) => void;
    const read = vi.spyOn(StarredMessagesService, 'getAllStarredMessages');
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseInitial = resolve;
      }),
    );
    read.mockResolvedValue({ messages: { [CONVERSATION_ID]: [message(FIRST_ID, 'saved')] } });
    const state = createTimelineDataSession({
      onChange: vi.fn(),
      policy: createGeminiTimelineStoragePolicy(),
    });
    states.push(state);
    state.replaceMarkers([marker(FIRST_ID, 'saved')]);
    const initial = state.init();
    const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    const receive = listeners[listeners.length - 1][0];
    receive({ [StorageKeys.SAVED_LIBRARY_STARS]: { newValue: { messages: {} } } }, 'local');
    vi.spyOn(StarredMessagesService, 'addStarredMessage').mockRejectedValue(
      new Error('write failed'),
    );
    await state.toggleStar(FIRST_ID);
    expect(read).toHaveBeenCalledTimes(2);
    expect(state.markers[0].starred).toBe(true);
    releaseInitial({ messages: {} });
    await initial;
    expect(state.markers[0].starred).toBe(true);
  });

  it('a successful star addition applies after a Library snapshot arrives during its write', async () => {
    const saved: StarredMessage[] = [];
    const state = await setup([marker(FIRST_ID, 'saved')], saved);
    let complete!: () => void;
    const persistence = new Promise<void>((resolve) => {
      complete = resolve;
    });
    vi.spyOn(StarredMessagesService, 'addStarredMessage').mockImplementation(async (item) => {
      await persistence;
      saved.push(item);
    });
    const edit = state.toggleStar(FIRST_ID);
    await vi.waitFor(() => expect(StarredMessagesService.addStarredMessage).toHaveBeenCalled());
    const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    const receive = listeners[listeners.length - 1][0];
    receive({ [StorageKeys.SAVED_LIBRARY_STARS]: { newValue: { messages: {} } } }, 'local');
    complete();
    await edit;
    expect(saved.map((item) => item.turnId)).toEqual([FIRST_ID]);
    expect(state.markers[0].starred).toBe(true);
  });

  it('does not save a star from an unverified mounted positional id', async () => {
    const add = vi.spyOn(StarredMessagesService, 'addStarredMessage').mockResolvedValue();
    const state = await setup([marker('u-0', 'mounted tail')]);
    const before = localStorage.getItem(`geminiTimelineStars:${CONVERSATION_ID}`);
    await state.toggleStar('u-0');
    expect(add).not.toHaveBeenCalled();
    expect(localStorage.getItem(`geminiTimelineStars:${CONVERSATION_ID}`)).toBe(before);
  });
  it('keeps a star mutation scoped to the conversation that owns its marker', async () => {
    const add = vi.spyOn(StarredMessagesService, 'addStarredMessage').mockResolvedValue();
    const state = await setup([marker(FIRST_ID, 'first prompt')]);
    history.replaceState({}, '', '/app/other');
    await state.toggleStar(FIRST_ID);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        conversationUrl: expect.stringContaining('/app/abc'),
      }),
    );
  });
  it('shares complete Library changes only with the live conversation owner', async () => {
    const receive = (messages: StarredMessagesData['messages']) => {
      for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls)
        listener({ [StorageKeys.SAVED_LIBRARY_STARS]: { newValue: { messages } } }, 'local');
    };
    const previous = await setup([marker(FIRST_ID, 'first prompt')]);
    receive({
      'gemini:conv:other': [
        {
          ...message(FIRST_ID, 'Other'),
          conversationId: 'gemini:conv:other',
          conversationUrl: 'https://gemini.google.com/app/other',
        },
      ],
    });
    expect(previous.markers[0].starred).toBe(false);
    receive({ [CONVERSATION_ID]: [message(FIRST_ID, 'Saved')] });
    expect(previous.markers[0].starred).toBe(true);
    previous.destroy();
    const current = await setup([marker(FIRST_ID, 'first prompt')]);
    receive({ [CONVERSATION_ID]: [message(FIRST_ID, 'Saved')] });
    expect(current.markers[0].starred).toBe(true);
    receive({});
    expect(current.markers[0].starred).toBe(false);
    expect(previous.markers[0].starred).toBe(true);
  });
  it('discards a pending initial star snapshot after the owner is destroyed', async () => {
    let resolveSnapshot!: (data: StarredMessagesData) => void;
    vi.spyOn(StarredMessagesService, 'getAllStarredMessages').mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const onChange = vi.fn();
    const state = createTimelineDataSession({
      onChange,
      policy: createGeminiTimelineStoragePolicy(),
    });
    states.push(state);
    const init = state.init();
    state.destroy();
    localStorage.setItem(`geminiTimelineStars:${CONVERSATION_ID}`, JSON.stringify([TAIL_ID]));

    resolveSnapshot({ messages: { [CONVERSATION_ID]: [message(FIRST_ID, 'old snapshot')] } });
    await init;
    expect(storedStars()).toEqual([TAIL_ID]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
