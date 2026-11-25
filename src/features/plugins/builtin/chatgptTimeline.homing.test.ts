import './__tests__/chatgptTimelineHarness';
/**
 * Reaching an unmounted ChatGPT turn (#1112, #1116). ChatGPT loads its history
 * in pages and keeps an estimated height only for turns it has fetched, so the
 * rail jumps to the turn's estimated place, waits for ChatGPT's DOM to answer
 * and aligns once the turn mounts; at the start of what is loaded it waits for
 * the older page without scrolling again.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  bubble,
  dots,
  exchange,
  makeScroller,
  mount,
  rect,
  serveConversation,
  settle,
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
  return { scroller, scrollTo, top: () => top };
}

/** ChatGPT mounts the opening exchange (or loads it with the older page). */
function mountOpening(items: HTMLElement[], top: number): HTMLElement {
  const remounted = exchange('Opening question');
  remounted.setAttribute('data-turn-key', items[0].getAttribute('data-turn-key')!);
  items[2].before(remounted);
  bubble(remounted).getBoundingClientRect = rect(top);
  return remounted;
}

function waiting(): boolean {
  return !!document.querySelector('.gv-timeline-homing-wait');
}

describe('ChatGPT timeline homing', () => {
  it('jumps straight to the estimated place of an unmounted turn and aligns it once mounted', async () => {
    serveConversation(PROMPTS);
    const { scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    // Centred 1520 and 1820px in: 300px a turn.
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    // Two turns of 300px above the third: 1520 - 600 - 0.45 * 600, in one jump past the pin.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 650, behavior: 'instant' });
    expect(top()).toBe(650);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');

    mountOpening(items, 300);
    await settle(200);
    // 650 + 300 + 20 - 270, without waiting out a glide.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: 'instant' });

    await settle(2_000);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
  });

  it('aims again once when ChatGPT re-measures the turns it mounted', async () => {
    serveConversation(PROMPTS);
    const { scrollTo } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    const remounted = mountOpening(items, 300);
    await settle(200);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: 'instant' });

    // ChatGPT measures what it mounted: the target ends up lower.
    bubble(remounted).getBoundingClientRect = rect(900);
    remounted.style.height = '900px';
    await settle(200);
    // 700 + 900 + 20 - 270.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1350, behavior: 'instant' });

    const calls = scrollTo.mock.calls.length;
    await settle(3_000);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
  });

  it('waits at the start for the older page without scrolling again, then aligns', async () => {
    serveConversation(PROMPTS);
    const { scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    // Near the start of what is loaded: two turns of 590px put the opening one above it.
    bubble(items[2]).getBoundingClientRect = rect(0);
    bubble(items[3]).getBoundingClientRect = rect(590);
    await mount();

    dots()[0].click();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    await settle(1_500);
    expect(top()).toBe(0);
    expect(waiting()).toBe(true);

    // ChatGPT takes seconds per page; no scroll or wheel while it fetches.
    const calls = scrollTo.mock.calls.length;
    await settle(6_000);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');

    mountOpening(items, 300);
    await settle(200);
    // 0 + 300 + 20 - 270.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 50, behavior: 'instant' });
    expect(waiting()).toBe(false);
  });

  it('gives up after the edge patience and shows the turn the view is on', async () => {
    serveConversation(PROMPTS);
    const { scrollTo } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(0);
    bubble(items[3]).getBoundingClientRect = rect(590);
    await mount();

    dots()[0].click();
    await settle(1_500);
    expect(waiting()).toBe(true);
    await settle(10_000);

    expect(waiting()).toBe(false);
    const calls = scrollTo.mock.calls.length;
    await settle(5_000);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    // Never reached: the marker the view is nearest takes over again.
    expect(dots()[0].getAttribute('aria-current')).toBe('false');
    expect(dots()[2].getAttribute('aria-current')).toBe('true');
  });

  it('glides to a mounted turn nearby and stops once it is on the anchor', async () => {
    serveConversation(PROMPTS);
    const { scrollTo } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[2].click();
    // 1400 + 100 + 20 - 270.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1250, behavior: 'smooth' });
    bubble(items[2]).getBoundingClientRect = rect(250);
    await settle(2_000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
