import './__tests__/chatgptTimelineHarness';
/**
 * The ChatGPT rail lists the whole conversation from ChatGPT's own endpoint
 * (#1112): its virtual list mounts a few exchange items and reserves no height
 * for the rest, so the DOM alone never shows every prompt.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import {
  bubble,
  dots,
  exchange,
  labels,
  makeScroller,
  mount,
  rect,
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

/**
 * ChatGPT's thread, 1400px in and pinned to its newest turn: a scripted scroll
 * up snaps back unless a wheel event reached the scroller first.
 */
function pinnedScroller() {
  const scroller = makeScroller();
  let top = 1400;
  let released = false;
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top });
  scroller.addEventListener('wheel', () => {
    released = true;
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    const next = options.top ?? top;
    if (next >= top || released) top = next;
    released = false;
  });
  scroller.scrollTo = scrollTo as never;
  return { scrollTo, top: () => top };
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

  it('steps towards an unmounted turn and aligns it once ChatGPT mounts it', async () => {
    serveConversation(PROMPTS);
    const { scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    // A bounded step (0.8 of the 600px view) up, never a jump to the start,
    // after a scripted wheel released the pin to the newest turn.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 920, behavior: 'instant' });
    expect(top()).toBe(920);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');

    // ChatGPT mounts the opening exchange where the steps reached.
    const remounted = exchange('Opening question');
    remounted.setAttribute('data-turn-key', items[0].getAttribute('data-turn-key')!);
    items[2].before(remounted);
    bubble(remounted).getBoundingClientRect = rect(300);
    await settle(1_000);

    // Centred on the anchor line: 920 + 300 + 20 - 0.45 * 600, past the pin too.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 970, behavior: 'smooth' });
    expect(top()).toBe(970);
    expect(labels()).toEqual(PROMPTS);
  });

  it('waits at the start for ChatGPT to load older turns before giving up', async () => {
    serveConversation(PROMPTS);
    const { scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    await settle(1_000);
    expect(top()).toBe(0);
    // Longer than five hops with nothing new: ChatGPT is still loading.
    await settle(2_000);

    const remounted = exchange('Opening question');
    remounted.setAttribute('data-turn-key', items[0].getAttribute('data-turn-key')!);
    items[2].before(remounted);
    bubble(remounted).getBoundingClientRect = rect(300);
    await settle(1_000);

    // 0 + 300 + 20 - 0.45 * 600, aimed at the turn that loaded late.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 50, behavior: 'smooth' });
  });

  it('aims again at a target that layout moved off the anchor after the align', async () => {
    serveConversation(PROMPTS);
    const { scrollTo } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    const remounted = exchange('Opening question');
    remounted.setAttribute('data-turn-key', items[0].getAttribute('data-turn-key')!);
    items[2].before(remounted);
    bubble(remounted).getBoundingClientRect = rect(300);
    await settle(200);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 970, behavior: 'smooth' });

    // ChatGPT measures the turns it mounted: the target ends up lower.
    bubble(remounted).getBoundingClientRect = rect(900);
    await settle(2_000);

    // 970 + 900 + 20 - 0.45 * 600.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1620, behavior: 'smooth' });
    // A target that never settles is aimed at a bounded number of times.
    const calls = scrollTo.mock.calls.length;
    await settle(3_000);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
  });

  it('stops stepping when the steps no longer move the thread or mount anything', async () => {
    serveConversation(PROMPTS);
    const { scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    // At the start it waits a few seconds for older turns, then gives up.
    await settle(6_000);
    const calls = scrollTo.mock.calls.length;
    await settle(5_000);

    expect(top()).toBe(0);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
  });
});
