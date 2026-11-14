import { describe, expect, it } from 'vitest';

import {
  type NewChatEvent,
  type NewChatPort,
  type NewChatState,
  routeEvent,
  transition,
} from '../newChatFiling';

const run = (events: readonly NewChatEvent[], from: NewChatState = { status: 'idle' }) =>
  events.reduce(transition, from);

const request = (folderId: string, onNewChat = false): NewChatEvent => ({
  type: 'request',
  folderId,
  onNewChat,
});
const route = (conversationId: string): NewChatEvent => ({
  type: 'conversationRoute',
  conversationId,
});

describe('new chat filing transitions', () => {
  it('files the conversation the route names after a send on the new chat', () => {
    expect(run([request('f1'), { type: 'arrivedNewChat' }, { type: 'send' }, route('c1')])).toEqual(
      { status: 'filing', folderId: 'f1', conversationId: 'c1' },
    );
  });

  it('starts composing at once when the page already shows the new chat', () => {
    expect(run([request('f1', true), { type: 'send' }, route('c1')])).toMatchObject({
      status: 'filing',
      folderId: 'f1',
    });
  });

  it('files nothing when the chat gets a route without a send', () => {
    expect(run([request('f1', true), route('c1')])).toEqual({ status: 'idle' });
  });

  it('ignores a send before the new chat opened', () => {
    expect(run([request('f1'), { type: 'send' }, route('c1')])).toEqual({ status: 'idle' });
  });

  it.each(['conversationClick', 'leftNewChat', 'timeout'] as const)(
    'drops a sent folder on %s',
    (type) => {
      expect(run([request('f1', true), { type: 'send' }, { type }, route('c1')])).toEqual({
        status: 'idle',
      });
    },
  );

  it('lets a new request replace the pending folder', () => {
    expect(run([request('f1', true), request('f2', true), { type: 'send' }, route('c1')])).toEqual({
      status: 'filing',
      folderId: 'f2',
      conversationId: 'c1',
    });
  });

  it('expires an opening that never reached the new chat', () => {
    expect(run([request('f1'), { type: 'timeout' }, { type: 'arrivedNewChat' }])).toEqual({
      status: 'idle',
    });
  });

  const choose = (folderId: string | null): NewChatEvent => ({ type: 'choose', folderId });

  it('files into the folder the chip picked on the new chat', () => {
    expect(run([choose('f1'), { type: 'send' }, route('c1')])).toEqual({
      status: 'filing',
      folderId: 'f1',
      conversationId: 'c1',
    });
  });

  it('lets the chip replace the pending folder before the send', () => {
    expect(run([request('f1', true), choose('f2'), { type: 'send' }, route('c1')])).toMatchObject({
      status: 'filing',
      folderId: 'f2',
    });
  });

  it('files nothing once the chip dropped the folder', () => {
    expect(run([request('f1', true), choose(null), { type: 'send' }, route('c1')])).toEqual({
      status: 'idle',
    });
  });

  it('keeps the folder of a chat already sent, or a new chat still opening', () => {
    const sent: NewChatState = { status: 'sent', folderId: 'f1' };
    const opening: NewChatState = { status: 'opening', folderId: 'f1' };
    expect(run([choose('f2'), choose(null)], sent)).toBe(sent);
    expect(run([choose('f2'), choose(null)], opening)).toBe(opening);
  });

  it('settles after filing', () => {
    expect(
      run([{ type: 'filed' }], { status: 'filing', folderId: 'f1', conversationId: 'c1' }),
    ).toEqual({ status: 'idle' });
  });
});

describe('new chat route events', () => {
  const port: NewChatPort = {
    isNewChat: (href) => new URL(href).pathname === '/new',
    conversationIdOf: (href) => /\/chat\/(\w+)/.exec(href)?.[1] ?? null,
    newChatLink: () => null,
    composer: 'textarea',
    sendButton: 'button',
    composerRoot: undefined,
    folderName: () => null,
    hasFolders: () => false,
    pickFolder: () => null,
    file: () => {},
    notify: () => {},
  };
  const change = (from: string, to: string, trigger: 'poll' | 'popstate' = 'poll') =>
    routeEvent(port, {
      previousHref: `https://x.test${from}`,
      currentHref: `https://x.test${to}`,
      trigger,
    });

  it('names the conversation the new chat became', () => {
    expect(change('/new', '/chat/abc')).toEqual({
      type: 'conversationRoute',
      conversationId: 'abc',
    });
  });

  it('treats back or forward onto a chat as leaving the new chat', () => {
    expect(change('/new', '/chat/abc', 'popstate')).toEqual({ type: 'leftNewChat' });
  });

  it('treats a move between chats as leaving the new chat', () => {
    expect(change('/chat/one', '/chat/abc')).toEqual({ type: 'leftNewChat' });
  });

  it('reports arriving on the new chat', () => {
    expect(change('/chat/one', '/new')).toEqual({ type: 'arrivedNewChat' });
  });
});
