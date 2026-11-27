// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/abcdef0123456789" }
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  GeminiPage,
  activeDotLabel,
  dotFor,
  dotLabels,
  navigateTo,
  settle,
  startTimelineOnPage,
  useTimelinePage as setupTimelinePage,
} from './geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

const PATH = '/u/0/app/abcdef0123456789';
const newest = [
  { serverId: '3333333333333333', prompt: '2ft question' },
  { serverId: '4444444444444444', prompt: 'Latest question' },
];
const oldest = [
  { serverId: '1111111111111111', prompt: 'First question' },
  { serverId: '2222222222222222', prompt: 'An older question' },
];

const extension = setupTimelinePage(PATH);
let page: GeminiPage;
let post: MockInstance<typeof window.postMessage>;
function answer(index: number, turns: typeof newest, hasOlder: boolean) {
  const [request] =
    post.mock.calls.find(
      ([data]) => data?.type === 'timeline-start' && data.payload.path === PATH,
    ) ?? [];
  expect(request).toBeDefined();
  const summaries = turns.map(({ serverId, prompt }) => [`r_${serverId}`, prompt]).reverse();
  const payload = { ...request.payload, page: index, turns: summaries, hasOlder };
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: { source: 'gv-history-observer', type: 'timeline-page', payload },
    }),
  );
}

beforeEach(async () => {
  extension().seed('sync', {
    [StorageKeys.GV_TIMELINE_ENABLED]: true,
    [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: false,
    [StorageKeys.TIMELINE_SCROLL_MODE]: 'jump',
    [StorageKeys.TIMELINE_STYLE]: 'dots',
  });
  page = new GeminiPage(newest);
  page.scrollTo(300);
  post = vi.spyOn(window, 'postMessage');
  await startTimelineOnPage();
});

describe('Gemini timeline background history', () => {
  it('fills the rail without moving the transcript and reaches the oldest turn in one jump', async () => {
    expect(dotLabels()).toEqual(newest.map(({ prompt }) => prompt));
    answer(0, newest, true);
    await settle(300);
    answer(1, [oldest[1], newest[0]], true);
    await settle(300);
    expect(dotLabels()).toEqual([oldest[1].prompt, ...newest.map(({ prompt }) => prompt)]);
    answer(2, [oldest[0]], false);
    await settle(300);
    const prompts = [...oldest, ...newest].map(({ prompt }) => prompt);
    expect(dotLabels()).toEqual(prompts);
    expect(page.viewport.querySelectorAll('.conversation-container')).toHaveLength(2);
    expect(page.viewport.scrollTop).toBe(300);

    dotFor(newest[0].prompt).click();
    await settle();
    expect(page.viewport.scrollTop).toBe(page.topOf(newest[0].prompt));
    expect(activeDotLabel()).toBe(newest[0].prompt);

    page.scrollTo(300);
    dotFor(oldest[0].prompt).click();
    expect(page.viewport.scrollTop).toBe(0);
    page.prepend([oldest[1]]);
    // Gemini restores the previous scroll anchor after inserting the older page.
    window.setTimeout(() => page.scrollTo(600), 40);
    await settle(600);
    expect(page.viewport.scrollTop).toBe(0);

    page.prepend([oldest[0]]);
    await settle(240);
    const bubble = page.bubble(oldest[0].prompt);
    const measure = bubble.getBoundingClientRect;
    bubble.getBoundingClientRect = () => {
      const bounds = measure();
      return new DOMRect(bounds.x, bounds.y + 300, bounds.width, bounds.height);
    };
    await settle();
    expect(page.viewport.scrollTop).toBe(300);
    expect(activeDotLabel()).toBe(oldest[0].prompt);
    expect(dotLabels()).toEqual(prompts);
  });

  it('ignores an in-flight page after switching accounts', async () => {
    answer(0, newest, true);
    await settle(300);
    const other = { prompt: 'Other account', serverId: '5555555555555555' };
    page.render([other]);
    await navigateTo(PATH.replace('/u/0/', '/u/1/'));
    answer(1, oldest, false);
    await settle(300);
    expect(dotLabels()).toEqual([other.prompt]);
  });
});
