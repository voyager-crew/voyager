import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ContentExtractor,
  createContentExtractor,
} from '@/features/export/services/DOMContentExtractor';
import type { ExportContentDialect } from '@/features/export/services/exportContentDialect';
import { normalizeText } from '@/features/export/services/exportDomPolicy';

import { type ChatGptCrawlTiming, crawlChatGptThread } from '../chatgptCrawl';
import { ChatGptHistoryReader } from '../chatgptHistoryApi';
import { conversationTree, stubConversationEndpoint } from './chatgptConversationTree';
import { type FixtureTurn, makeTurns, mountThreadFixture } from './chatgptThreadFixture';

let extractor: ContentExtractor;

const FAST: Partial<ChatGptCrawlTiming> = {
  pollMs: 1,
  settleMs: 4,
  mountTimeoutMs: 400,
  historyIdleMs: 25,
  historyStallMs: 150,
};

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  extractor = createContentExtractor({
    extractUserImage: (element: HTMLElement) => element.querySelectorAll('img'),
    extractUserText: (
      _lines: NodeListOf<HTMLElement>,
      textParts: string[],
      element: HTMLElement,
    ) => {
      const text = normalizeText(element.textContent || '');
      if (text) textParts.push(text);
    },
    getUserAttachmentCandidates: () => [],
    extractAssistantImage: () => undefined,
    extractFormula: () => undefined,
    extractCodeBlock: () => undefined,
    extractInlineFormula: () => undefined,
  } as unknown as ExportContentDialect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

function ids(turns: readonly FixtureTurn[]): string[] {
  return turns.flatMap((turn) => [
    ...(turn.user !== undefined ? [`${turn.key}:u`] : []),
    ...(turn.assistant !== undefined ? [`${turn.key}:a`] : []),
  ]);
}

describe('crawlChatGptThread', () => {
  it('reads every turn of a virtualized thread that unmounts items while scrolling', async () => {
    const turns = makeTurns(12);
    const fixture = mountThreadFixture({ turns });
    expect(fixture.mountedKeys().length).toBeLessThan(turns.length);
    const unmounted = new Set<string>();
    const observer = new MutationObserver((records) =>
      records.forEach((record) =>
        record.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.dataset.turnKey) {
            unmounted.add(node.dataset.turnKey);
          }
        }),
      ),
    );
    observer.observe(fixture.scroller, { childList: true, subtree: true });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });
    observer.disconnect();

    expect(unmounted.size).toBeGreaterThan(0);
    expect(messages.map((message) => message.id)).toEqual(ids(turns));
    expect(messages.map((message) => message.content.text)).toEqual(
      turns.flatMap((turn) => [turn.user, turn.assistant]),
    );
  });

  it('loads paginated history before reading, so the first turn is the conversation start', async () => {
    const turns = makeTurns(10);
    const fixture = mountThreadFixture({ turns, initiallyLoaded: 2, pageSize: 3 });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(fixture.loadedCount()).toBe(turns.length);
    expect(messages[0]?.id).toBe('turn-01:u');
    expect(messages.map((message) => message.id)).toEqual(ids(turns));
  });

  it.each([
    ['over several pages', 3],
    ['in one page', 7],
  ])(
    'keeps scrolling the thread when it overflows only once older history loads (%s)',
    async (_label, pageSize) => {
      const turns = makeTurns(16, 100);
      const fixture = mountThreadFixture({ turns, initiallyLoaded: 9, pageSize, overscan: 0 });
      expect(fixture.range()).toBe(0);
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      const messages = await crawlChatGptThread({ extractor, timing: FAST });

      expect(fixture.loadedCount()).toBe(turns.length);
      expect(messages.map((message) => message.id)).toEqual(ids(turns));
    },
  );

  it('crosses a turn taller than several viewports without losing its neighbours', async () => {
    const turns = makeTurns(5).map((turn, index) =>
      index === 2 ? { ...turn, height: 9000 } : turn,
    );
    mountThreadFixture({ turns, overscan: 0 });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(messages.map((message) => message.id)).toEqual(ids(turns));
  });

  it('reads the visible page, not a cached conversation ChatGPT keeps hidden before it', async () => {
    const turns = makeTurns(4);
    mountThreadFixture({
      turns,
      cachedPageTurns: [{ key: 'cached-1', height: 500, user: 'Old page', assistant: 'Old' }],
    });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(messages.map((message) => message.turnKey)).not.toContain('cached-1');
    expect(messages.map((message) => message.id)).toEqual(ids(turns));
  });

  it('gives a prompt without a reply only a user message', async () => {
    const turns: FixtureTurn[] = [
      ...makeTurns(2),
      { key: 'turn-03', height: 400, user: 'Unanswered prompt' },
    ];
    mountThreadFixture({ turns });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(messages.at(-1)).toMatchObject({ id: 'turn-03:u', role: 'user' });
    expect(messages.map((message) => message.id)).not.toContain('turn-03:a');
  });

  it('reads the turns ChatGPT will not load from its conversation endpoint', async () => {
    history.replaceState(null, '', '/c/conv-1');
    const turns = makeTurns(8);
    const fixture = mountThreadFixture({
      turns,
      initiallyLoaded: 3,
      historyDelayMs: Infinity,
      unloadedRoom: 950,
    });
    const fetchMock = stubConversationEndpoint(conversationTree(turns));

    const messages = await crawlChatGptThread({
      extractor,
      timing: FAST,
      history: new ChatGptHistoryReader(),
    });

    expect(fixture.loadedCount()).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/backend-api/conversation/conv-1',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
    expect(messages.map((message) => message.id)).toEqual(ids(turns));
    expect(messages.map((message) => message.content.text)).toEqual(
      turns.flatMap((turn) => [turn.user, turn.assistant]),
    );
    // Older turns carry the ids the page lists, so mounting one later is no branch change.
    expect(messages[0]?.fingerprint).toBe('ids:turn-01 turn-01-a');
    expect(messages[0]?.fingerprint).toBe(messages[1]?.fingerprint);
  });

  it('fails when older history neither loads nor can be read from the endpoint', async () => {
    history.replaceState(null, '', '/c/conv-1');
    const turns = makeTurns(8);
    mountThreadFixture({ turns, initiallyLoaded: 3, historyDelayMs: Infinity });
    stubConversationEndpoint(conversationTree(turns), 401);

    await expect(
      crawlChatGptThread({ extractor, timing: FAST, history: new ChatGptHistoryReader() }),
    ).rejects.toThrow('chatgpt_export_history_fetch:401');
  });

  it('steps back when a scroll overshoots past every recorded turn', async () => {
    const turns = makeTurns(12);
    mountThreadFixture({ turns, overscan: 0, scrollOvershoot: 4000, overshootWrites: 2 });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(messages.map((message) => message.id)).toEqual(ids(turns));
  });

  it('fails when every scroll skips past the recorded turns, rather than leaving a gap', async () => {
    mountThreadFixture({ turns: makeTurns(12), overscan: 0, scrollOvershoot: 4000 });

    await expect(crawlChatGptThread({ extractor, timing: FAST })).rejects.toThrow(
      'chatgpt_export_thread_gap',
    );
  });

  it('waits for a window that renders later than it would otherwise count as settled', async () => {
    // Slower than the settle interval and than the top of the thread takes to
    // look idle, so the reader's window is still mounted when the walk starts.
    const turns = makeTurns(8);
    mountThreadFixture({ turns, renderDelayMs: 40 });

    const messages = await crawlChatGptThread({ extractor, timing: FAST });

    expect(messages.map((message) => message.id)).toEqual(ids(turns));
  });

  it('fails instead of reading a stale window that never moves to the scroll position', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(8), renderDelayMs: Infinity });
    expect(fixture.mountedKeys()).not.toContain('turn-01');

    await expect(crawlChatGptThread({ extractor, timing: FAST })).rejects.toThrow(
      'chatgpt_export_thread_unsettled',
    );
  });

  it('fails when a branch switch changes a turn it already read, rather than mixing branches', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(8) });
    let switched = false;
    const onProgress = (count: number) => {
      if (count < 3 || switched) return;
      switched = true;
      // Regenerating turn 3 keeps its key (the prompt's id) but swaps the
      // reply, and every later turn with it.
      fixture.replaceTurn('turn-03', { replyId: 'turn-03-b', assistant: 'Answer 3, branch 2' });
      fixture.replaceTurn('turn-04', { replyId: 'turn-04-b', assistant: 'Answer 4, branch 2' });
    };

    await expect(crawlChatGptThread({ extractor, timing: FAST, onProgress })).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
    expect(switched).toBe(true);
  });

  it('reports how many turns it has read', async () => {
    const turns = makeTurns(5);
    mountThreadFixture({ turns });
    const counts: number[] = [];

    await crawlChatGptThread({
      extractor,
      timing: FAST,
      onProgress: (count) => counts.push(count),
    });

    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses a reply that is still streaming', async () => {
    mountThreadFixture({ turns: makeTurns(3) });
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<button data-testid="stop-button" aria-label="Stop streaming"></button>',
      );

    await expect(crawlChatGptThread({ extractor, timing: FAST })).rejects.toThrow(
      'chatgpt_export_response_still_generating',
    );
  });

  it('puts the reader back where they were, history loaded above or not', async () => {
    const turns = makeTurns(10);
    const fixture = mountThreadFixture({ turns, initiallyLoaded: 4, pageSize: 3 });
    const fromEnd = 2200;
    fixture.setOffset(fixture.range() - fromEnd);

    await crawlChatGptThread({ extractor, timing: FAST });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fixture.range() - fixture.offset()).toBe(fromEnd);
  });

  it('restores the scroll position when the crawl fails', async () => {
    const fixture = mountThreadFixture({
      turns: makeTurns(10),
      initiallyLoaded: 4,
      historyDelayMs: Infinity,
    });
    fixture.setOffset(1700);
    const fromEnd = fixture.range() - fixture.offset();
    stubConversationEndpoint({}, 500);

    await expect(
      crawlChatGptThread({ extractor, timing: FAST, history: new ChatGptHistoryReader() }),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fromEnd).toBeGreaterThan(0);
    expect(fixture.range() - fixture.offset()).toBe(fromEnd);
  });

  it('stops when cancelled', async () => {
    mountThreadFixture({ turns: makeTurns(6) });
    const controller = new AbortController();
    const crawl = crawlChatGptThread({ extractor, signal: controller.signal, timing: FAST });
    controller.abort();

    await expect(crawl).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stays cancelled when cancelled while it restores the scroll position', async () => {
    const turns = makeTurns(6);
    const fixture = mountThreadFixture({ turns });
    const controller = new AbortController();
    const onProgress = (count: number) => {
      if (count === turns.length) controller.abort();
    };

    await expect(
      crawlChatGptThread({ extractor, signal: controller.signal, timing: FAST, onProgress }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fixture.offset()).toBe(fixture.range());
  });
});
