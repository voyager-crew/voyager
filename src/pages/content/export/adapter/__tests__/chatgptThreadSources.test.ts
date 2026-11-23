import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { ExportThreadSource } from '@/features/plugins/sites/sections/exportCrawlData';
import type { SiteAdapter } from '@/features/plugins/types';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

import type { ChatGptCrawlTiming } from '../chatgptCrawl';
import { ChatGptHistoryReader } from '../chatgptHistoryApi';
import { createChatGptTurnSource } from '../chatgptTurnSource';
import { buildChatGptAdapter } from '../platform/chatgpt';
import { conversationTree, stubConversationEndpoint } from './chatgptConversationTree';
import { type FixtureTurn, makeTurns, mountThreadFixture } from './chatgptThreadFixture';

const FAST: Partial<ChatGptCrawlTiming> = {
  pollMs: 1,
  settleMs: 4,
  mountTimeoutMs: 400,
  historyIdleMs: 25,
  historyStallMs: 150,
};

beforeEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '/c/conv-1');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(StarredMessagesService, 'getStarredMessagesForConversation').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

function ids(turns: readonly FixtureTurn[]): string[] {
  return turns.flatMap((turn) => [`${turn.key}:u`, `${turn.key}:a`]);
}

function conversationReads(fetchMock: ReturnType<typeof stubConversationEndpoint>): number {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).startsWith('/backend-api/conversation/'),
  ).length;
}

/** Prepare an export the way the selection UI does, on a site with the given data. */
async function prepare(site: Partial<SiteAdapter> = {}) {
  const source = createChatGptTurnSource(buildChatGptAdapter({ ...chatgptAdapter, ...site }));
  const session = await source.prepare({ timing: FAST, history: new ChatGptHistoryReader() });
  if (!session) throw new Error('the live thread was not prepared');
  return session;
}

function order(...sources: ExportThreadSource[]): Partial<SiteAdapter> {
  return { exportThread: { format: 1, order: sources } };
}

describe('ChatGPT export when the page walk fails', () => {
  // Every scroll lands past the recorded turns, so the walk fails with a gap.
  const brokenWalk = (turns: readonly FixtureTurn[]) =>
    mountThreadFixture({ turns, overscan: 0, scrollOvershoot: 4000 });

  it('exports the whole conversation from the conversation endpoint', async () => {
    const turns = makeTurns(12);
    brokenWalk(turns);
    const fetchMock = stubConversationEndpoint(conversationTree(turns));

    const session = await prepare();

    expect(session.failure).toBeUndefined();
    expect(session.messages().map((message) => message.messageId)).toEqual(ids(turns));
    const exported = await session.build(new Set(ids(turns)), {});
    expect(exported.map((turn) => [turn.user, turn.assistant])).toEqual(
      turns.map((turn) => [turn.user, turn.assistant]),
    );
    expect(conversationReads(fetchMock)).toBe(1);
  });

  it('keeps the failure when the endpoint fails too', async () => {
    brokenWalk(makeTurns(12));
    stubConversationEndpoint({}, 500);

    const session = await prepare();

    expect(session.failure).toBe('history');
    expect(session.messages()).toEqual([]);
  });

  it('refuses an endpoint branch other than the one the page shows', async () => {
    const turns = makeTurns(12);
    brokenWalk(turns);
    // The server saved a regenerated last reply; the page still shows the first.
    const saved = turns.map((turn) =>
      turn.key === 'turn-12' ? { ...turn, replyId: 'turn-12-b', assistant: 'Answer 12, b' } : turn,
    );
    stubConversationEndpoint(conversationTree(saved));

    const session = await prepare();

    expect(session.failure).toBe('history');
    expect(session.messages()).toEqual([]);
  });

  it('keeps the failure without asking the endpoint when the site data says crawl only', async () => {
    brokenWalk(makeTurns(12));
    const fetchMock = stubConversationEndpoint(conversationTree(makeTurns(12)));

    const session = await prepare(order('crawl'));

    expect(session.failure).toBe('history');
    expect(conversationReads(fetchMock)).toBe(0);
  });

  it('reads only the endpoint, without scrolling the page, when the site data says api', async () => {
    const turns = makeTurns(12);
    const fixture = mountThreadFixture({ turns });
    stubConversationEndpoint(conversationTree(turns));
    const unmounted: string[] = [];
    const observer = new MutationObserver((records) =>
      records.forEach((record) =>
        record.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.dataset.turnKey) {
            unmounted.push(node.dataset.turnKey);
          }
        }),
      ),
    );
    observer.observe(fixture.scroller, { childList: true, subtree: true });

    const session = await prepare(order('api'));
    observer.disconnect();

    expect(unmounted).toEqual([]);
    expect(session.messages().map((message) => message.messageId)).toEqual(ids(turns));
  });
});

describe('ChatGPT export crawl switches from site data', () => {
  it('scrolls without releasing the pin when upwardScroll is plain', async () => {
    mountThreadFixture({ turns: makeTurns(8, 600), pinnedToEnd: true });

    const session = await prepare({
      ...order('crawl'),
      exportCrawl: { format: 1, upwardScroll: 'plain' },
    });

    expect(session.failure).toBe('history');
  });

  it('measures the list by its direct child when extent is directChild', async () => {
    mountThreadFixture({ turns: makeTurns(4, 300), contentsWrapper: true });

    const session = await prepare({
      ...order('crawl'),
      exportCrawl: { format: 1, extent: 'directChild' },
    });

    expect(session.failure).toBe('history');
  });

  it('reads the scroller as top-down when direction is normal', async () => {
    mountThreadFixture({ turns: makeTurns(8) });

    const session = await prepare({
      ...order('crawl'),
      exportCrawl: { format: 1, direction: 'normal' },
    });

    expect(session.failure).toBe('history');
  });

  it('reads the current page with the switches at their defaults', async () => {
    const turns = makeTurns(8, 600);
    mountThreadFixture({ turns, pinnedToEnd: true, contentsWrapper: true });

    const session = await prepare({
      ...order('crawl'),
      exportCrawl: {
        format: 1,
        extent: 'outermostBox',
        upwardScroll: 'wheelRelease',
        direction: 'reverse',
      },
    });

    expect(session.messages().map((message) => message.messageId)).toEqual(ids(turns));
  });
});
