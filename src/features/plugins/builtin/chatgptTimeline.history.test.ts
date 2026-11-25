import './__tests__/chatgptTimelineHarness';
/**
 * The ChatGPT rail lists the whole conversation from ChatGPT's own endpoint
 * (#1112): its virtual list mounts a few exchange items and reserves no height
 * for the rest, so the DOM alone never shows every prompt.
 */
import { describe, expect, it } from 'vitest';

import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import {
  bubble,
  dots,
  exchange,
  labels,
  mount,
  serveConversation,
  settle,
  star,
  starStore,
} from './__tests__/chatgptTimelineHarness';

const PROMPTS = ['Opening question', 'Second question', 'Third question', 'Newest question'];

/** The four exchanges with only the newest two mounted, as ChatGPT opens a long chat. */
function openAtBottom(): HTMLElement[] {
  const items = PROMPTS.map((prompt) => exchange(prompt));
  items[0].remove();
  items[1].remove();
  return items;
}

describe('ChatGPT timeline history', () => {
  it('lists every prompt from the conversation endpoint while only the newest are mounted', async () => {
    serveConversation(PROMPTS);
    starStore.set('chatgpt:conv:first', [star('chatgpt:conv:first', 'Opening question')]);
    const items = openAtBottom();
    await mount();

    expect(labels()).toEqual(PROMPTS);
    // A star saved under the mounted id shows on the never-mounted turn.
    expect(dots()[0].getAttribute('aria-pressed')).toBe('true');
    // Mounted turns keep the id the DOM-only rail gave them.
    expect(bubble(items[3]).getAttribute('data-gv-turn-id')).toBe(buildTurnId('Newest question'));
  });

  it('lists the mounted prompts when the conversation endpoint fails', async () => {
    openAtBottom();
    await mount();

    expect(labels()).toEqual(['Third question', 'Newest question']);
  });

  it('keeps a prompt sent after the read in place and does not duplicate it once re-read', async () => {
    const fetch = serveConversation(PROMPTS.slice(0, 2));
    PROMPTS.slice(0, 2).forEach((prompt) => exchange(prompt));
    await mount();
    expect(labels()).toEqual(PROMPTS.slice(0, 2));

    exchange('Follow-up');
    await settle();
    expect(labels()).toEqual([...PROMPTS.slice(0, 2), 'Follow-up']);

    const reread = serveConversation([...PROMPTS.slice(0, 2), 'Follow-up']);
    await settle(3_500);
    expect(fetch).toHaveBeenCalled();
    expect(reread).toHaveBeenCalled();
    expect(labels()).toEqual([...PROMPTS.slice(0, 2), 'Follow-up']);
  });
});
