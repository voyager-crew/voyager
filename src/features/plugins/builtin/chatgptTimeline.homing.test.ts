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
    bubble(remounted).getBoundingClientRect = rect(700);
    remounted.style.height = '700px';
    await settle(200);
    // 700 + 700 + 20 - 270.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1150, behavior: 'instant' });

    const calls = scrollTo.mock.calls.length;
    await settle(3_000);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
  });

  it('lands on the same history turn when the mounted text changes its hash', async () => {
    serveConversation(PROMPTS);
    const { top } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    expect(dots()[0].getAttribute('aria-label')).toBe('Opening question');
    dots()[0].click();
    await settle(150);
    const mounted = mountOpening(items, 300);
    bubble(mounted).textContent = 'Opening question with rendered attachment';
    bubble(mounted).getBoundingClientRect = () => rect(950 - top())();
    await settle(1_000);

    expect(dots()[0].getAttribute('aria-label')).toBe('Opening question with rendered attachment');
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
    expect(Math.abs(top() - 700)).toBeLessThan(72);
  });

  it('lands on a keyed ChatGPT attachment without a user text bubble', async () => {
    serveConversation(PROMPTS);
    const { top } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(100);
    bubble(items[3]).getBoundingClientRect = rect(400);
    await mount();

    dots()[0].click();
    await settle(150);
    const attachment = document.createElement('div');
    attachment.setAttribute('data-chatgpt-search-unit-key', '');
    attachment.append(document.createElement('img'));
    attachment.getBoundingClientRect = () => rect(950 - top())();
    const heading = document.createElement('h4');
    heading.setAttribute('data-conversation-role', 'user');
    bubble(items[0]).replaceWith(heading, attachment);
    items[2].before(items[0]);
    await settle(1_000);

    expect(dots()[0].getAttribute('aria-label')).toBe('Opening question');
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
    expect(Math.abs(top() - 700)).toBeLessThan(72);
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
    const { scroller, scrollTo } = pinnedScroller();
    const items = openAtBottom();
    bubble(items[2]).getBoundingClientRect = rect(0);
    bubble(items[3]).getBoundingClientRect = rect(590);
    await mount();

    dots()[0].click();
    await settle(1_500);
    expect(waiting()).toBe(true);
    await settle(7_500);
    // A reply streaming at the bottom grows the page; no older turn arrives.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2600 });
    items[3].querySelector('[data-chatgpt-selection-message-id]')!.append(' and more');
    await settle(2_500);

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

  it('lets a glide to a nearby turn finish before reading where it landed', async () => {
    serveConversation(PROMPTS);
    const { scroller, scrollTo } = pinnedScroller();
    const items = openAtBottom();
    const at = (y: number) => () => rect(y - scroller.scrollTop)();
    bubble(items[2]).getBoundingClientRect = at(700);
    bubble(items[3]).getBoundingClientRect = at(1000);
    await mount();
    // A smooth scroll travels for 700 ms, emitting a scroll event a frame.
    let position = 1400;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => position });
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      const from = position;
      const to = options.top ?? from;
      if (options.behavior !== 'smooth') {
        position = to;
        return;
      }
      for (let frame = 1; frame <= 44; frame++)
        setTimeout(() => {
          position = from + ((to - from) * frame) / 44;
          scroller.dispatchEvent(new Event('scroll'));
        }, frame * 16);
    });

    dots()[2].click();
    // 700 + 20 - 270, 950px up: still travelling when a 400 ms read would come.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
    await settle(3_000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(450);
  });

  it('keeps moving toward a turn behind a long reply when the estimate lands on the same window', async () => {
    serveConversation(PROMPTS);
    const { scroller, scrollTo, top } = pinnedScroller();
    const items = openAtBottom();
    // Bubbles placed in the thread's own coordinates, so they move with the scroll.
    const at = (y: number) => () => rect(y - scroller.scrollTop)();
    bubble(items[2]).getBoundingClientRect = at(1900);
    bubble(items[3]).getBoundingClientRect = at(2200);
    await mount();
    // The second turn's long reply fills 1140-1900: ChatGPT mounts it only once the view reaches 800.
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => options.top ?? 0,
      });
      if ((options.top ?? 0) > 800 || items[1].isConnected) return;
      items[2].before(items[1]);
      bubble(items[1]).getBoundingClientRect = at(1100);
    });
    expect(top()).toBe(1400);

    dots()[1].click();
    // The mounted pitch puts it at 1620, 50px above the view: a jump that alone
    // lands on the same window, again and again, until the run stalls.
    expect(scrollTo.mock.calls[0][0].top).toBeLessThanOrEqual(1400 - 0.75 * 600);
    await settle(350);

    // 1100 + 20 - 270: on the anchor.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 850, behavior: 'instant' });
    expect(dots()[1].getAttribute('aria-current')).toBe('true');
  });

  it('corrects a far overshoot without walking through unrelated replies', async () => {
    const prompts = ['First', 'Second', 'Target', 'Fourth', 'Overshoot'];
    serveConversation(prompts);
    const { scroller, scrollTo } = pinnedScroller();
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 17_000 });
    let position = 1400;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => position });
    const items = prompts.map((prompt, index) => {
      const item = exchange(prompt);
      const top = [1500, 5800, 6200, 8500, 10300][index];
      bubble(item).getBoundingClientRect = () => rect(top - position)();
      if (index >= 2) item.remove();
      return item;
    });
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      position = options.top ?? position;
      const mounted = position > 8000 ? [4] : position >= 5200 ? [2] : [0, 1];
      // The host mounts the landing window on the frame after the scroll.
      setTimeout(() => {
        items.forEach((item, index) => {
          if (!mounted.includes(index)) item.remove();
          else if (!item.isConnected) scroller.firstElementChild!.append(item);
        });
      }, 16);
    });
    await mount();

    dots()[2].click();
    expect(position).toBeGreaterThan(8000);
    await settle(950);

    expect(items[2].isConnected).toBe(true);
    expect(Math.abs(position - 5950)).toBeLessThan(72);
    expect(dots()[2].getAttribute('aria-current')).toBe('true');
  });

  it('approaches a turn mounted far off the view in steps ChatGPT keeps it mounted through', async () => {
    serveConversation(PROMPTS);
    const { scroller, scrollTo } = pinnedScroller();
    const items = openAtBottom();
    const at = (y: number) => () => rect(y - scroller.scrollTop)();
    bubble(items[2]).getBoundingClientRect = at(1500);
    bubble(items[3]).getBoundingClientRect = at(1800);
    // The opening turn is mounted 2500px above the anchor, at the top of a long reply.
    items[2].before(items[0]);
    bubble(items[0]).getBoundingClientRect = at(-500);
    await mount();
    // A scroll of more than a view re-lays ChatGPT's list out without that turn.
    let position = 1400;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => position });
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      const next = Math.max(0, options.top ?? position);
      if (Math.abs(next - position) > 600) items[0].remove();
      position = next;
    });

    dots()[0].click();
    await settle(3_000);

    expect(items[0].isConnected).toBe(true);
    // -500 + 20 - 270, reached in steps of 0.9 of the view.
    expect(position).toBe(0);
    const tops = scrollTo.mock.calls.map(([options]) => options.top ?? 0);
    expect(tops.slice(0, 2)).toEqual([860, 320]);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
  });

  it('stops a run the host keeps undoing and shows where the view is', async () => {
    serveConversation(PROMPTS);
    const { scroller, scrollTo } = pinnedScroller();
    const items = openAtBottom();
    const at = (y: number) => () => rect(y - scroller.scrollTop)();
    bubble(items[2]).getBoundingClientRect = at(1500);
    bubble(items[3]).getBoundingClientRect = at(1800);
    await mount();
    // Every jump mounts the opening turn and every aim at it loses it again.
    let position = 1400;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => position });
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      position = Math.max(0, options.top ?? position);
      if (items[0].isConnected) items[0].remove();
      else {
        items[2].before(items[0]);
        bubble(items[0]).getBoundingClientRect = at(position + 300);
      }
    });

    // The capped run re-reads every turn's style about 4,000 times, and jsdom recomputes
    // each one, which outlasts the test timeout on a loaded CI runner. No style changes
    // here, so one computation per element gives the same answers.
    const computed = new Map<Element, CSSStyleDeclaration>();
    const compute = window.getComputedStyle.bind(window);
    const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (pseudo) return compute(element, pseudo);
      const style = computed.get(element) ?? compute(element);
      computed.set(element, style);
      return style;
    });

    dots()[0].click();
    await settle(60_000);
    const calls = scrollTo.mock.calls.length;
    await settle(10_000);

    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(calls).toBeLessThanOrEqual(61);
    styles.mockRestore();
  });

  it('steps when a far jump keeps landing on the same side of the turn', async () => {
    serveConversation(PROMPTS);
    const { scroller, scrollTo } = pinnedScroller();
    const items = openAtBottom();
    const at = (y: number) => () => rect(y - scroller.scrollTop)();
    bubble(items[2]).getBoundingClientRect = at(1500);
    bubble(items[3]).getBoundingClientRect = at(1800);
    await mount();
    // ChatGPT re-anchors on the turn it measured after any jump longer than a view,
    // landing back where it was; the opening turn mounts once the view reaches 800.
    let position = 1400;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => position });
    scrollTo.mockImplementation((options: ScrollToOptions) => {
      const next = Math.max(0, options.top ?? position);
      if (Math.abs(next - position) <= 600) position = next;
      if (position > 800 || items[0].isConnected) return;
      items[2].before(items[0]);
      bubble(items[0]).getBoundingClientRect = at(900);
    });

    dots()[0].click();
    await settle(4_000);

    expect(items[0].isConnected).toBe(true);
    // 900 + 20 - 270.
    expect(position).toBe(650);
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
  });
});
