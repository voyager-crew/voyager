// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { createChatGptPage } from './chatgptResponseNotification/page';

const lifetimes: SiteSelectorLifetime[] = [];

function mount(): HTMLElement[] {
  document.body.innerHTML = `<main>
    <div data-turn-key="one"><div data-user-message-bubble>First question</div><div data-chatgpt-selection-message-id="one" data-first>First answer</div><button>Copy</button></div>
    <div data-turn-key="two"><div data-user-message-bubble>Second question</div><div data-chatgpt-selection-message-id="two">Second answer</div><button>Copy</button></div>
  </main><form><div contenteditable="true" data-composer-markdown data-alias id="first-input"></div><button type="submit">Send</button></form>
  <form><div contenteditable="true" data-composer-markdown data-alias id="second-input"></div><button type="submit">Send</button></form>`;
  for (const node of document.querySelectorAll<HTMLElement>('*')) {
    Object.defineProperty(node, 'offsetWidth', { value: 100, configurable: true });
  }
  return Array.from(document.querySelectorAll<HTMLElement>('[data-chatgpt-selection-message-id]'));
}

async function online(selectors: Readonly<Record<string, string>>) {
  const source = { ...chatgptAdapter, selectors: { ...chatgptAdapter.selectors, ...selectors } };
  const lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'chatgpt', catalogRevision: 1, selectors: source.selectors }),
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
  return createChatGptPage(source);
}

function enterOn(id: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  document.getElementById(id)!.dispatchEvent(event);
  return event;
}

afterEach(() => {
  lifetimes.splice(0).forEach((lifetime) => lifetime.stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ChatGPT notification page reads', () => {
  it('OFF cached reply data keeps installed identities and the original single-query read', () => {
    const replies = mount();
    const page = createChatGptPage({
      ...chatgptAdapter,
      selectors: { ...chatgptAdapter.selectors, assistantTurn: '[data-first]' },
    });
    const query = vi.spyOn(document, 'querySelectorAll');
    expect(page.getLatestReply()).toBe(replies[1]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('matching hydrated composer data preserves the same send gesture and prompt pairing', async () => {
    const replies = mount();
    const page = await online({ composer: '[data-alias]' });
    expect(page.isSendGesture(enterOn('second-input'))).toBe(true);
    expect(page.getPromptForReply(replies[1])).toBe('Second question');
    expect(page.getLatestReply()).toBe(replies[1]);
  });

  it('a partial online composer list falls back for the whole notification operation', async () => {
    const replies = mount();
    const page = await online({ composer: '#first-input' });
    expect(page.isSendGesture(enterOn('second-input'))).toBe(true);
    expect(page.getLatestReply()).toBe(replies[1]);
  });

  it('a broad online composer root cannot turn an unrelated stop button into the active composer', async () => {
    mount();
    const own = document.createElement('button');
    own.setAttribute('aria-label', 'Stop');
    document.querySelector('form')!.append(own);
    const foreign = document.createElement('button');
    foreign.setAttribute('aria-label', 'Stop');
    document.body.append(foreign);
    const page = await online({ composerRoot: 'body' });
    expect(page.isStopControlTarget(own)).toBe(true);
    expect(page.isStopControlTarget(foreign)).toBe(false);
  });
});

it('notifications recover a renamed thread that first mounts after the notification reader starts', async () => {
  const page = await online({ userTurn: '.question', assistantTurn: '.answer' });
  document.body.innerHTML =
    '<main><div data-turn-key="late"><div data-chatgpt-search-unit-key="late:user"><div class="question">Late question</div></div><div data-chatgpt-search-unit-key="late:assistant"><div class="answer">Late answer</div></div></div></main>';
  const reply = document.querySelector<HTMLElement>('.answer')!;
  Object.defineProperty(reply, 'offsetWidth', { value: 100 });
  Object.defineProperty(document.querySelector('.question')!, 'offsetWidth', { value: 100 });
  expect(page.getLatestReply()).toBe(reply);
  expect(page.getPromptForReply(reply)).toBe('Late question');
  expect(page.isAwaitingReply()).toBe(false);
  const main = document.querySelector('main')!;
  main.setAttribute('role', 'dialog');
  expect(page.getLatestReply()).toBeNull();
  main.removeAttribute('role');
  expect(page.getLatestReply()).toBe(reply);
});

it('notifications follow a late native composer and its own send and stop controls', async () => {
  const page = await online({ composer: '.renamed-input', sendButton: '.renamed-send' });
  document.body.innerHTML =
    '<form data-chatgpt-composer><textarea id="late-input" class="renamed-input">Draft</textarea><button class="renamed-send" type="submit">Send</button><button type="button" aria-label="Stop">Stop</button></form><button id="unrelated-stop" aria-label="Stop">Stop</button>';
  const field = document.querySelector('textarea')!;
  Object.defineProperty(field, 'offsetWidth', { value: 100 });
  const stop = document.querySelector('form [aria-label="Stop"]')!;
  Object.defineProperty(stop, 'offsetWidth', { value: 100 });
  expect(page.isSendGesture(enterOn('late-input'))).toBe(true);
  expect(page.hasLabelledStopControl()).toBe(true);
  expect(page.isStopControlTarget(stop)).toBe(true);
  expect(page.isStopControlTarget(document.getElementById('unrelated-stop'))).toBe(false);
  document.querySelector('form')!.setAttribute('role', 'dialog');
  expect(page.isSendGesture(enterOn('late-input'))).toBe(false);
  expect(page.hasLabelledStopControl()).toBe(false);
  document.querySelector('form')!.removeAttribute('role');
  expect(page.isSendGesture(enterOn('late-input'))).toBe(true);
});
