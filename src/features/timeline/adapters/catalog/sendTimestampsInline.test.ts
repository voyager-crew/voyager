// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * Message times inline in ChatGPT's thread (its bundled site.json), with the
 * "message timestamps" setting on: a sent user message shows its time above
 * its bubble, once, and the label follows the setting, re-renders and leaving
 * the chat. The rail's tooltips and the stored times live in
 * `sendTimestamps.test.ts`.
 */
import './testSetup';
import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  SENT_AT,
  SENT_LABEL,
  exchange,
  inlineTimes,
  installChatGPTSendTimes,
  itemOf,
  scope,
  send,
  storage,
} from './sendTimestampsHarness';

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

installChatGPTSendTimes();

describe('message times in the ChatGPT thread', () => {
  const bubbleOf = (key: string): HTMLElement =>
    itemOf(key).querySelector<HTMLElement>('[data-user-message-bubble]')!;

  it('a ChatGPT user message shows its send time when message times are on', async () => {
    await send('New question', 'turn-2');

    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
    // Above the bubble, inside the prompt's right-aligned block, never inside the message.
    const label = itemOf('turn-2').querySelector('.gv-timestamp')!;
    expect(label.nextElementSibling).toBe(bubbleOf('turn-2'));
    expect(bubbleOf('turn-2').textContent).toBe('New question');
    // History with no stored time shows none.
    expect(inlineTimes('turn-1')).toEqual([]);
  });

  it('turning message times off removes the inline times', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, false);
    await vi.waitFor(() => expect(inlineTimes()).toEqual([]));

    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, true);
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
  });

  it('a re-rendered ChatGPT turn shows its time once', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    // ChatGPT remounts the whole item, as scrolling it out and back does.
    itemOf('turn-2').replaceWith(exchange('turn-2', 'New question'));
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
    expect(inlineTimes()).toEqual([SENT_LABEL]);

    // ChatGPT re-renders only the bubble, leaving the label beside it.
    const bubble = bubbleOf('turn-2');
    const fresh = bubble.cloneNode(true) as HTMLElement;
    bubble.replaceWith(fresh);
    await vi.waitFor(() =>
      expect(itemOf('turn-2').querySelector('.gv-timestamp')?.nextElementSibling).toBe(fresh),
    );
    expect(inlineTimes()).toEqual([SENT_LABEL]);
  });

  it('an assistant message gets no inline time', async () => {
    await send('New question', 'turn-2', SENT_AT, 'An answer');
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));

    const reply = itemOf('turn-2').querySelector('[data-chatgpt-search-unit-key="turn-2-a"]')!;
    expect(reply.querySelector('.gv-timestamp')).toBeNull();
    expect(reply.previousElementSibling?.querySelector('.gv-timestamp')).not.toBeNull();
  });

  it('leaving the chat or closing the timeline removes the inline times', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    // The host routes to another chat before it swaps the thread.
    history.pushState({}, '', '/c/two');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(inlineTimes()).toEqual([]));

    history.replaceState({}, '', '/c/one');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));
    await scope.dispose();
    expect(inlineTimes()).toEqual([]);
  });
});
