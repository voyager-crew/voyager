import { afterEach, describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { redactRoute } from '../../verbs/siteCheck/route';

/**
 * Fixture markup follows a signed-in grok.com capture (2026-11-15, light theme).
 * `html.dark` was not on that page; it is the inferred dark-scheme class.
 */
const grok = requireBundledSiteAdapter('grok');

const ids = (selector: string | undefined) =>
  Array.from(document.querySelectorAll(selector ?? ':not(*)'), (el) => el.id);

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
});

describe('Grok content markers', () => {
  it('keeps user and assistant turns apart, including an older untyped bubble', () => {
    document.body.innerHTML =
      '<div data-testid="user-message" id="user">Question</div>' +
      '<span data-testid="user-message" id="user-span">Not a turn</span>' +
      '<div data-testid="assistant-message" id="answer">Answer</div>' +
      '<div class="message-bubble" id="legacy">Untyped</div>';
    expect(ids(grok.selectors.userTurn)).toEqual(['user']);
    expect(ids(grok.selectors.assistantTurn)).toEqual(['answer']);
    const user = document.querySelector('#user')!;
    const answer = document.querySelector('#answer')!;
    expect(user.contains(answer)).toBe(false);
    expect(answer.contains(user)).toBe(false);
  });

  it('finds the query-bar editor, its form and the submit control', () => {
    document.body.innerHTML =
      '<textarea id="search"></textarea>' +
      '<div class="tiptap ProseMirror" contenteditable="true" role="textbox" id="other-editor"></div>' +
      '<form id="other-form"><input id="other-input" /></form>' +
      '<form id="composer-form">' +
      '<div data-testid="chat-input">' +
      '<div class="tiptap ProseMirror query-bar-editor" contenteditable="true" role="textbox" aria-label="Message Grok" id="composer"></div>' +
      '</div>' +
      '<button type="button" data-composer-action="voice" id="voice"></button>' +
      '<button type="submit" data-testid="chat-submit" data-composer-action="send" id="send"></button>' +
      '</form>';
    const { composer, composerRoot, sendButton } = grok.selectors;
    expect(ids(composer)).toEqual(['composer']);
    expect(ids(composerRoot)).toEqual(['composer-form']);
    expect(ids(sendButton)).toEqual(['send']);
  });

  it('treats the composer stop control as generating and leaves send and voice idle', () => {
    document.body.innerHTML =
      '<button type="button" aria-label="Stop" data-testid="composer-stop" data-icon-button id="stop"></button>' +
      '<button type="submit" aria-label="Send" data-composer-action="send" data-testid="chat-submit" data-trigger-disabled id="send"></button>' +
      '<button type="button" aria-label="Voice mode" data-composer-action="voice" id="voice"></button>';
    expect(ids(grok.export?.generating)).toEqual(['stop']);
  });

  it('finds the app sidebar, the transcript scroller and an expanded thought', () => {
    document.body.innerHTML =
      '<aside id="app-sidebar" aria-label="App navigation"><button draggable="true" id="chat">Chat</button></aside>' +
      '<nav id="not-sidebar"><a href="/c/01234567-89ab-cdef-0123-456789abcdef">One</a></nav>' +
      '<div data-testid="chat-transcript-scroller" id="thread">' +
      '<div data-testid="user-message" id="user">Hi</div>' +
      '<div data-testid="conversation-trace" id="trace">' +
      '<div data-testid="conversation-trace-fold" data-closed id="fold">' +
      '<div data-testid="conversation-thought" id="thought"></div>' +
      '</div>' +
      '</div>' +
      '<div data-testid="assistant-message" id="answer">Hello</div>' +
      '</div>' +
      '<div class="overflow-y-auto" id="other-scroll">' +
      '<div data-testid="conversation-trace-divider" id="divider"></div>' +
      '</div>';
    expect(ids(grok.selectors.sidebar)).toEqual(['app-sidebar']);
    expect(ids(grok.selectors.scrollContainer)).toEqual(['thread']);
    expect(ids(grok.selectors.thinkingBlock)).toEqual(['thought']);
  });

  it('recognizes the observed light class and the inferred dark class', () => {
    document.documentElement.className = 'scheme-light dark:scheme-dark light grok-hash';
    expect(document.querySelector(grok.theme.hostSelector)).toBe(document.documentElement);
    expect(document.querySelector(grok.theme.lightSelector)).toBe(document.documentElement);
    expect(document.querySelector(grok.theme.darkSelector)).toBeNull();

    document.documentElement.className = 'dark';
    expect(document.querySelector(grok.theme.lightSelector)).toBeNull();
    expect(document.querySelector(grok.theme.darkSelector)).toBe(document.documentElement);
  });

  it('does not treat data-theme, color-scheme or an unmarked document as a theme class', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('style', 'color-scheme: light');
    expect(document.querySelector(grok.theme.lightSelector)).toBeNull();
    expect(document.querySelector(grok.theme.darkSelector)).toBeNull();

    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    expect(document.querySelector(grok.theme.lightSelector)).toBeNull();
    expect(document.querySelector(grok.theme.darkSelector)).toBeNull();
  });

  it('reads a /c/<uuid> conversation id and redacts the route', () => {
    const id = '01234567-89ab-cdef-0123-456789abcdef';
    expect(new RegExp(grok.conversationIdPattern!).exec(`/c/${id}`)?.[1]).toBe(id);
    expect(new RegExp(grok.conversationIdPattern!).exec(`/c/${id}/`)).not.toBeNull();
    expect(new RegExp(grok.conversationIdPattern!).exec('/c/not-a-uuid')).toBeNull();
    expect(redactRoute(`https://grok.com/c/${id}?rid=${id}#last`, grok)).toEqual({
      route: '/c/:id',
      conversation: true,
    });
    expect(redactRoute('https://x.com/i/grok', grok).conversation).toBe(false);
  });
});
