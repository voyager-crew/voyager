import { vi } from 'vitest';

import type { FixtureTurn } from './chatgptThreadFixture';

/**
 * A `GET /backend-api/conversation/<id>` answer for fixture turns, shaped as
 * measured live (November 2026): each prompt is followed by thoughts, a
 * commentary note, a tool call and its output, then the final reply. Only the
 * prompt (id `<key>`) and the final reply (id `<key>-a`, or `replyId`) show on the page.
 */
export function conversationTree(turns: readonly FixtureTurn[]): Record<string, unknown> {
  const mapping: Record<string, unknown> = { root: { id: 'root', parent: null, message: null } };
  let parent = 'root';
  const add = (id: string, message: Record<string, unknown>): void => {
    mapping[id] = { id, parent, message: { id, recipient: 'all', ...message } };
    parent = id;
  };
  add('system-context', {
    author: { role: 'user' },
    content: { content_type: 'text', parts: ['hidden context'] },
    metadata: { is_visually_hidden_from_conversation: true },
  });
  for (const turn of turns) {
    if (turn.user !== undefined) {
      add(turn.key, {
        author: { role: 'user' },
        content: { content_type: 'text', parts: [turn.user] },
      });
    }
    add(`${turn.key}-thoughts`, {
      author: { role: 'assistant' },
      content: { content_type: 'thoughts', thoughts: [] },
    });
    add(`${turn.key}-note`, {
      author: { role: 'assistant' },
      channel: 'commentary',
      content: { content_type: 'text', parts: ['Checking a source.'] },
    });
    add(`${turn.key}-call`, {
      author: { role: 'assistant' },
      recipient: 'web.run',
      content: { content_type: 'text', parts: ['{"query":"q"}'] },
    });
    add(`${turn.key}-tool`, {
      author: { role: 'tool' },
      content: { content_type: 'text', parts: ['tool output'] },
    });
    if (turn.assistant !== undefined) {
      add(turn.replyId ?? `${turn.key}-a`, {
        author: { role: 'assistant' },
        channel: 'final',
        content: { content_type: 'text', parts: [turn.assistant] },
      });
    }
  }
  return { mapping, current_node: parent };
}

/** Answer the session and conversation requests as ChatGPT does, or with `status` for the conversation. */
export function stubConversationEndpoint(tree: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/session') {
      return new Response(JSON.stringify({ accessToken: 'token', account: { id: 'acct' } }));
    }
    if (url.startsWith('/backend-api/conversation/')) {
      return new Response(JSON.stringify(tree), { status });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
