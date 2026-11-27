import './__tests__/chatgptTimelineHarness';
import { expect, it, vi } from 'vitest';

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

it.each([
  { direction: 'back to its prompt', target: 0, start: 30_000, landing: 0 },
  { direction: 'forward to the next prompt', target: 1, start: 18_000, landing: 30_050 },
])('crosses a mounted oversized reply $direction', async ({ target, start, landing }) => {
  const prompts = ['Opening question', 'Follow-up question'];
  serveConversation(prompts);
  const scroller = makeScroller();
  const [first, second] = prompts.map((prompt) => exchange(prompt));
  const height = 30_200;
  let top = start;
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, get: () => top },
    scrollHeight: { configurable: true, value: height + 4000 },
  });
  first.getBoundingClientRect = () => ({ ...rect(-top)(), bottom: height - top, height });
  bubble(first).getBoundingClientRect = () => rect(100 - top)();
  bubble(second).getBoundingClientRect = () => rect(height + 100 - top)();
  second.remove();
  scroller.scrollTo = vi.fn(({ top: next }: ScrollToOptions) => {
    top = Math.max(0, next ?? top);
    if (top + scroller.clientHeight >= height && !second.isConnected) first.after(second);
  }) as never;
  await mount();

  dots()[target].click();
  await settle(1500);

  expect(top).toBe(landing);
  expect(dots()[target].getAttribute('aria-current')).toBe('true');
});
