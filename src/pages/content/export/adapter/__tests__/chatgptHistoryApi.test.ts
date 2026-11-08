import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatGptHistoryReader, apiTurnMessages, parseTurnsBefore } from '../chatgptHistoryApi';
import { conversationTree, stubConversationEndpoint } from './chatgptConversationTree';
import { makeTurns } from './chatgptThreadFixture';

/** A citation span as ChatGPT writes it, between private-use markers. */
const CITE = '\ue200cite\ue202turn0search1\ue201';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTurnsBefore', () => {
  it('follows the branch of the given turn, not the one the server saved last', () => {
    const tree = conversationTree(makeTurns(3));
    const mapping = tree.mapping as Record<string, unknown>;
    // An edited second prompt starts a sibling branch, which the server names current.
    mapping['edit'] = {
      id: 'edit',
      parent: 'turn-01-a',
      message: {
        id: 'edit',
        recipient: 'all',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Edited question'] },
      },
    };
    tree.current_node = 'edit';

    const turns = parseTurnsBefore(tree, 'turn-03');

    expect(turns.map((turn) => [turn.key, turn.user, turn.assistant])).toEqual([
      ['turn-01', 'Question 1', 'Answer 1'],
      ['turn-02', 'Question 2', 'Answer 2'],
    ]);
  });

  it('drops citation markers and keeps uploaded file names', () => {
    const tree = conversationTree([]);
    const mapping = tree.mapping as Record<string, unknown>;
    mapping['p'] = {
      id: 'p',
      parent: 'system-context',
      message: {
        id: 'p',
        recipient: 'all',
        author: { role: 'user' },
        content: { content_type: 'multimodal_text', parts: [{ asset_pointer: 'x' }, 'Read this'] },
        metadata: { attachments: [{ name: 'report.pdf' }, { name: 'photo.JPG' }] },
      },
    };
    mapping['r'] = {
      id: 'r',
      parent: 'p',
      message: {
        id: 'r',
        recipient: 'all',
        author: { role: 'assistant' },
        content: {
          content_type: 'text',
          parts: [`It rose 4%${CITE} [1].`],
        },
        metadata: {
          content_references: [{ matched_text: ' [1]', alt: ' ([Source](https://a.b))' }],
        },
      },
    };
    mapping['next'] = { id: 'next', parent: 'r', message: null };

    const [turn] = parseTurnsBefore(tree, 'next');
    const [user, assistant] = apiTurnMessages([turn!]);

    expect(turn?.assistant).toBe('It rose 4% ([Source](https://a.b)).');
    expect(user?.content.text).toBe('📎 report.pdf\n📎 photo.JPG\n\nRead this');
    expect(user?.content.attachments).toEqual([
      { name: 'report.pdf', type: 'pdf' },
      { name: 'photo.JPG', type: 'jpg' },
    ]);
    expect(assistant?.content.text).toBe('It rose 4% ([Source](https://a.b)).');
  });

  it('refuses a tree that does not hold the first crawled turn', () => {
    expect(() => parseTurnsBefore(conversationTree(makeTurns(2)), 'other')).toThrow(
      'chatgpt_export_history_mismatch',
    );
  });
});

describe('ChatGptHistoryReader', () => {
  it("reads a workspace's conversation under its account", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/auth/session'
        ? new Response(
            JSON.stringify({ accessToken: 't', account: { id: 'ws-1', structure: 'workspace' } }),
          )
        : new Response(JSON.stringify(conversationTree(makeTurns(2)))),
    );
    vi.stubGlobal('fetch', fetchMock);

    const turns = await new ChatGptHistoryReader().turnsBefore(
      'https://chatgpt.com/g/g-p-abc/c/conv-9',
      'turn-02',
    );

    expect(turns.map((turn) => turn.key)).toEqual(['turn-01']);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/backend-api/conversation/conv-9',
      expect.objectContaining({
        headers: { Authorization: 'Bearer t', 'ChatGPT-Account-Id': 'ws-1' },
      }),
    );
  });

  it('waits out one short rate limit, as ChatGPT asks', async () => {
    vi.useFakeTimers();
    let conversationReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/auth/session') {
          return new Response(JSON.stringify({ accessToken: 't' }));
        }
        conversationReads++;
        return conversationReads === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '14' } })
          : new Response(JSON.stringify(conversationTree(makeTurns(2))));
      }),
    );

    const read = new ChatGptHistoryReader().turnsBefore('https://chatgpt.com/c/conv-9', 'turn-02');
    await vi.advanceTimersByTimeAsync(14_000);

    await expect(read).resolves.toHaveLength(1);
    expect(conversationReads).toBe(2);
    vi.useRealTimers();
  });

  it('reads a conversation and the session once across exports of it', async () => {
    const fetchMock = stubConversationEndpoint(conversationTree(makeTurns(4)));
    const reader = new ChatGptHistoryReader();

    await reader.turnsBefore('https://chatgpt.com/c/conv-9', 'turn-03');
    const again = await reader.turnsBefore('https://chatgpt.com/c/conv-9', 'turn-04');
    await reader.turnsBefore('https://chatgpt.com/c/conv-8', 'turn-02');

    expect(again.map((turn) => turn.key)).toEqual(['turn-01', 'turn-02', 'turn-03']);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/session',
      '/backend-api/conversation/conv-9',
      '/backend-api/conversation/conv-8',
    ]);
  });

  it('reads the conversation again when its first loaded turn is new', async () => {
    const turns = makeTurns(2);
    const fetchMock = stubConversationEndpoint(conversationTree(turns));
    const reader = new ChatGptHistoryReader();
    await reader.turnsBefore('https://chatgpt.com/c/conv-9', 'turn-02');

    stubConversationEndpoint(conversationTree([...turns, ...makeTurns(4).slice(2)]));
    const turnsNow = await reader.turnsBefore('https://chatgpt.com/c/conv-9', 'turn-04');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(turnsNow.map((turn) => turn.key)).toEqual(['turn-01', 'turn-02', 'turn-03']);
  });

  it('asks for the session again once ChatGPT refuses the remembered one', async () => {
    let token = 'first';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/session') {
        return new Response(JSON.stringify({ accessToken: token }));
      }
      const headers = init?.headers as Record<string, string>;
      return headers.Authorization === `Bearer ${token}`
        ? new Response(JSON.stringify(conversationTree(makeTurns(2))))
        : new Response('', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const reader = new ChatGptHistoryReader();
    await reader.turnsBefore('https://chatgpt.com/c/conv-8', 'turn-02');

    token = 'renewed';
    const turns = await reader.turnsBefore('https://chatgpt.com/c/conv-9', 'turn-02');

    expect(turns.map((turn) => turn.key)).toEqual(['turn-01']);
    const sessionReads = fetchMock.mock.calls.filter(([input]) => input === '/api/auth/session');
    expect(sessionReads).toHaveLength(2);
  });
});
