import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { findAssistantReply, findUserBubble, readTurnKey } from '../chatgptThread';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

it('a sibling legacy editor cannot replace the current thread prompt bubble', async () => {
  document.body.innerHTML =
    '<main><div data-turn-key="original"><div data-message-author-role="user" contenteditable="true">Unsent edit</div><div data-user-message-bubble>Original prompt</div><div data-chatgpt-selection-message-id="reply">Answer</div></div></main>';
  const item = document.querySelector('[data-turn-key]')!;
  const bundled = { prompt: findUserBubble(item), reply: findAssistantReply(item) };
  expect(bundled.prompt?.textContent).toBe('Original prompt');
  expect(readTurnKey(item)).toBe('original');
  const running = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'chatgpt',
      catalogRevision: 1,
      locators: { 'export.assistantContent': ['.renamed-body'] },
    }),
  });
  stop = running.stop;
  await running.ready;
  expect({ prompt: findUserBubble(item), reply: findAssistantReply(item) }).toEqual(bundled);
  expect(bundled.reply?.textContent).toBe('Answer');
});
