import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ContentExtractor,
  createContentExtractor,
} from '@/features/export/services/DOMContentExtractor';
import type { ExportContentDialect } from '@/features/export/services/exportContentDialect';
import { normalizeText } from '@/features/export/services/exportDomPolicy';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import type { ExportTurnSession } from '../../exportSite';
import type { ChatGptCrawlOptions, ChatGptCrawlTiming } from '../chatgptCrawl';
import { readChatGptThreadTurns } from '../chatgptThreadExport';
import { createChatGptTurnSource } from '../chatgptTurnSource';
import { buildChatGptAdapter } from '../platform/chatgpt';
import { chatgptIsConversationPage } from '../platform/chatgpt';
import { type FixtureTurn, makeTurns, mountThreadFixture } from './chatgptThreadFixture';

let extractor: ContentExtractor;
let preparer: ReturnType<typeof createChatGptTurnSource>;

const FAST: Partial<ChatGptCrawlTiming> = {
  pollMs: 1,
  settleMs: 4,
  mountTimeoutMs: 400,
  historyIdleMs: 25,
  historyStallMs: 150,
};

beforeEach(() => {
  document.body.replaceChildren();
  preparer = createChatGptTurnSource(buildChatGptAdapter(chatgptAdapter));
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
});

/** A preparation that crawled the live thread at test speed. */
async function prepared(
  options: Omit<ChatGptCrawlOptions, 'extractor'> = {},
): Promise<ExportTurnSession> {
  const session = await preparer.prepare({ timing: FAST, ...options });
  if (!session) throw new Error('the live thread was not crawled');
  return session;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function ids(turns: readonly FixtureTurn[]): string[] {
  return turns.flatMap((turn) => [
    ...(turn.user !== undefined ? [`${turn.key}:u`] : []),
    ...(turn.assistant !== undefined ? [`${turn.key}:a`] : []),
  ]);
}

describe('ChatGPT selection export on the live thread', () => {
  it('lists every message with stable ids and known roles after preparation', async () => {
    const turns: FixtureTurn[] = [
      ...makeTurns(8),
      { key: 'turn-09', height: 400, user: 'Last prompt' },
    ];
    mountThreadFixture({ turns });

    const containers = (await prepared()).messages();

    expect(containers.map((turn) => turn.messageId)).toEqual(ids(turns));
    expect(containers.every((turn) => turn.role !== 'unknown')).toBe(true);
    expect(containers.find((turn) => turn.messageId === 'turn-01:u')?.role).toBe('user');
    expect(containers.find((turn) => turn.messageId === 'turn-01:a')?.role).toBe('assistant');
  });

  it('binds a mounted message to its live element and keeps an unmounted one stable', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(10) });
    const session = await prepared();

    const first = session.messages();
    const second = session.messages();
    const mounted = new Set(fixture.mountedKeys());
    for (const turn of first) {
      const key = turn.messageId.slice(0, -2);
      if (mounted.has(key)) expect(turn.hostElement.isConnected).toBe(true);
    }
    expect(second.map((turn) => turn.hostElement)).toEqual(first.map((turn) => turn.hostElement));
  });

  it('offers nothing to select when the crawl cannot prove the thread complete', async () => {
    mountThreadFixture({ turns: makeTurns(8), initiallyLoaded: 3, historyDelayMs: Infinity });

    const session = await prepared();

    expect(session.messages()).toEqual([]);
  });

  it('offers nothing to select on the live thread before it has been crawled', () => {
    mountThreadFixture({ turns: makeTurns(8) });

    expect(preparer.messages()).toEqual([]);
  });

  it('leaves the earlier DOM to its scroll-to-top preparation', async () => {
    document.body.innerHTML = '<main><div data-turn-id-container="a"></div></main>';

    await expect(preparer.prepare({ timing: FAST })).resolves.toBeNull();
  });

  it('pairs a prompt with its reply and keeps a lone selection one-sided', async () => {
    const turns: FixtureTurn[] = [
      ...makeTurns(3),
      { key: 'turn-04', height: 400, user: 'Unanswered prompt' },
    ];
    mountThreadFixture({ turns });
    const session = await prepared();

    const exported = await session.build(
      new Set(['turn-01:u', 'turn-01:a', 'turn-02:a', 'turn-04:u']),
      {},
    );

    expect(exported).toHaveLength(3);
    expect(exported[0]).toMatchObject({ user: 'Question 1', assistant: 'Answer 1' });
    expect(exported[1]).toMatchObject({ user: '', assistant: 'Answer 2', omitEmptySections: true });
    expect(exported[1]?.assistantContent?.html).toContain('Answer 2');
    expect(exported[2]).toMatchObject({ user: 'Unanswered prompt', assistant: '' });
    expect(exported[2]?.userContent?.text).toBe('Unanswered prompt');
  });

  it('fails rather than exporting a selection it never read', async () => {
    mountThreadFixture({ turns: makeTurns(3) });
    const session = await prepared();

    await expect(session.build(new Set(['turn-01:u', 'missing:a']), {})).rejects.toThrow(
      'chatgpt_export_messages_missing:missing:a',
    );
  });

  it('refuses to export after the reader switches conversations', async () => {
    mountThreadFixture({ turns: makeTurns(3) });
    const session = await prepared();

    await expect(
      session.build(new Set(['turn-01:u']), {
        expectedUrl: 'https://chatgpt.com/c/another-conversation',
      }),
    ).rejects.toThrow('chatgpt_export_conversation_changed');
  });

  it('drops the crawl once a mounted turn switches branch after it was read', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(6) });
    const session = await prepared();
    expect(session.messages()).toHaveLength(12);

    // The reader regenerates the last reply, which keeps its turn key.
    fixture.replaceTurn('turn-06', { replyId: 'turn-06-b', assistant: 'Answer 6, branch 2' });

    await expect(session.build(new Set(['turn-06:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
    expect(session.messages()).toEqual([]);
  });

  it("drops the crawl once the reader switches to an edited prompt's branch of the same length", async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(6) });
    const session = await prepared();

    // Editing turn 5's prompt gives it and every later turn new keys.
    fixture.switchBranch('turn-05', [
      { key: 'edit-05', height: 1500, user: 'Question 5, edited', assistant: 'Answer 5, edited' },
      { key: 'edit-06', height: 1500, user: 'Question 6, edited', assistant: 'Answer 6, edited' },
    ]);

    await expect(session.build(new Set(['turn-05:u']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
    expect(session.messages()).toEqual([]);
  });

  it('drops the crawl when a turn switches branch and scrolls out of view before the export', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(10) });
    const session = await prepared();
    const bottom = fixture.offset();

    fixture.setOffset(0);
    await nextTask();
    fixture.replaceTurn('turn-01', { replyId: 'turn-01-b', assistant: 'Answer 1, branch 2' });
    await nextTask();
    fixture.setOffset(bottom);
    expect(fixture.mountedKeys()).not.toContain('turn-01');

    await expect(session.build(new Set(['turn-01:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
  });

  it('drops the crawl when a turn re-renders as another branch and unmounts in the same task', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(10) });
    const session = await prepared();
    const bottom = fixture.offset();
    fixture.setOffset(0);
    await nextTask();

    fixture.replaceTurn('turn-01', { replyId: 'turn-01-b', assistant: 'Answer 1, branch 2' });
    fixture.setOffset(bottom);
    expect(fixture.mountedKeys()).not.toContain('turn-01');
    // The observer delivers both changes together, after the item is gone.
    await nextTask();

    await expect(session.build(new Set(['turn-01:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
  });

  it("drops the crawl when a turn's ids change in place and it unmounts in the same task", async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(10) });
    const session = await prepared();
    const bottom = fixture.offset();
    fixture.setOffset(0);
    await nextTask();

    const reply = fixture.main.querySelector(
      '[data-turn-key="turn-01"] [data-chatgpt-selection-message-id]',
    )!;
    reply.setAttribute('data-chatgpt-selection-message-id', 'turn-01-b');
    reply.parentElement!.setAttribute('data-chatgpt-search-message-ids', 'turn-01-b');
    fixture.setOffset(bottom);
    expect(fixture.mountedKeys()).not.toContain('turn-01');

    await expect(session.build(new Set(['turn-01:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
  });

  it('drops the crawl when an unread turn mounts inside a wrapper and leaves in the same task', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(4) });
    const session = await prepared();

    const list = fixture.main.querySelector('[data-turn-key]')!.parentElement!;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div data-turn-key="edit-04"><p>Edited prompt</p></div>';
    list.appendChild(wrapper);
    wrapper.remove();

    await expect(session.build(new Set(['turn-04:a']), {})).rejects.toThrow(
      'chatgpt_export_thread_changed',
    );
  });

  it('keeps the crawl when turns mount and unmount in the same task without changing', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(10) });
    const session = await prepared();
    const bottom = fixture.offset();

    fixture.setOffset(0);
    fixture.setOffset(bottom / 2);
    fixture.setOffset(bottom);
    await nextTask();

    expect(session.messages()).toHaveLength(20);
    await expect(session.build(new Set(['turn-01:a']), {})).resolves.toHaveLength(1);
  });

  it('drops the crawl when a turn it read switches branch mid-crawl and is never revisited', async () => {
    // Short turns: several share a window, so an early one leaves before the next read.
    const fixture = mountThreadFixture({ turns: makeTurns(20, 300), overscan: 0 });
    let switched = '';
    const onProgress = (count: number) => {
      if (switched || count !== 5) return;
      // A turn the crawl has read, still on screen, but not the one it continues from.
      const read = new Set(makeTurns(count).map((turn) => turn.key));
      const tail = makeTurns(count).at(-1)?.key;
      switched = fixture.mountedKeys().find((key) => read.has(key) && key !== tail) ?? '';
      if (switched) fixture.replaceTurn(switched, { replyId: `${switched}-b` });
    };

    const session = await prepared({ onProgress });

    expect(switched).not.toBe('');
    expect(session.messages()).toEqual([]);
  });

  it('does not let a superseded preparation publish over a newer one that failed', async () => {
    mountThreadFixture({ turns: makeTurns(8) });
    let newer = null as Promise<ExportTurnSession | null> | null;
    const onProgress = (count: number) => {
      if (count !== 2 || newer) return;
      // A newer export starts mid-crawl on the same route and fails at once.
      const main = document.querySelector<HTMLElement>('[data-app-shell-active-page] main')!;
      main.insertAdjacentHTML('beforeend', '<button data-testid="stop-button"></button>');
      newer = preparer.prepare({ timing: FAST });
      main.querySelector('[data-testid="stop-button"]')!.remove();
    };

    const older = await prepared({ onProgress });
    const newerSession = await newer;

    expect(newerSession).not.toBeNull();
    expect(newerSession?.messages()).toEqual([]);
    expect(older.messages()).toEqual([]);
  });

  it('does not publish a preparation cancelled while it restores the scroll position', async () => {
    const turns = makeTurns(6);
    mountThreadFixture({ turns });
    const controller = new AbortController();
    const onProgress = (count: number) => {
      if (count === turns.length) controller.abort();
    };

    await expect(
      preparer.prepare({ signal: controller.signal, timing: FAST, onProgress }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves roles from the crawl for role-only selection', async () => {
    mountThreadFixture({ turns: makeTurns(2) });
    const session = await prepared();

    const roles = await session.roles!(new Set(['turn-02:u', 'turn-02:a']), {});

    expect(Object.fromEntries(roles)).toEqual({ 'turn-02:u': 'user', 'turn-02:a': 'assistant' });
  });
});

describe('readChatGptThreadTurns', () => {
  it('reads the whole thread as export turns', async () => {
    mountThreadFixture({ turns: makeTurns(6) });

    const turns = await readChatGptThreadTurns({ extractor, timing: FAST });

    expect(turns.map((turn) => [turn.user, turn.assistant])).toEqual(
      makeTurns(6).map((turn) => [turn.user, turn.assistant]),
    );
    expect(turns[5]?.assistantContent?.html).toContain('Answer 6');
  });

  it('refuses a thread whose last prompt has no reply yet', async () => {
    mountThreadFixture({
      turns: [...makeTurns(2), { key: 'turn-03', height: 400, user: 'Unanswered prompt' }],
    });

    await expect(readChatGptThreadTurns({ extractor, timing: FAST })).rejects.toThrow(
      'chatgpt_export_response_still_generating',
    );
  });

  it('fails when a turn it read changes before the crawl returns', async () => {
    const turns = makeTurns(4);
    const fixture = mountThreadFixture({ turns });
    const onProgress = (count: number) => {
      if (count === turns.length) {
        fixture.replaceTurn('turn-04', { replyId: 'turn-04-b', assistant: 'Answer 4, branch 2' });
      }
    };

    await expect(readChatGptThreadTurns({ extractor, timing: FAST, onProgress })).rejects.toThrow(
      'chatgpt_export_conversation_changed',
    );
  });

  it('fails when a turn it read switches branch mid-crawl and is never revisited', async () => {
    const fixture = mountThreadFixture({ turns: makeTurns(20, 300), overscan: 0 });
    let switched = '';
    const onProgress = (count: number) => {
      if (switched || count !== 5) return;
      const read = new Set(makeTurns(count).map((turn) => turn.key));
      const tail = makeTurns(count).at(-1)?.key;
      switched = fixture.mountedKeys().find((key) => read.has(key) && key !== tail) ?? '';
      if (switched) fixture.replaceTurn(switched, { replyId: `${switched}-b` });
    };

    await expect(readChatGptThreadTurns({ extractor, timing: FAST, onProgress })).rejects.toThrow(
      'chatgpt_export_conversation_changed',
    );
    expect(switched).not.toBe('');
  });
});

describe('chatgptIsConversationPage on the live thread', () => {
  it('accepts a rendered turn on a route without a conversation id', () => {
    mountThreadFixture({ turns: makeTurns(1) });

    expect(chatgptIsConversationPage(document, 'https://chatgpt.com/?temporary-chat=true')).toBe(
      true,
    );
  });
});
