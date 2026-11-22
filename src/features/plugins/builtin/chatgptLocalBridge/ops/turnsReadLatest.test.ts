// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/conv-1" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChatGptPageFixture, mountChatGptPage } from '../__tests__/chatgptPageFixture';
import { type Harness, createHarness, errorCode } from '../__tests__/harness';
import { type PageDataFeed, createPageDataFeed } from '../__tests__/pageDataFeed';

const toasts = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: vi.fn(async () => 'en') }));
vi.mock('@/core/ui/toast/toaster', () => ({
  createToaster: () => ({
    show: toasts.show,
    dismiss: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
  }),
}));

let page: ChatGptPageFixture;
let bridge: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  toasts.show.mockClear();
  page = mountChatGptPage({ route: '/c/conv-1' });
  page.addTurn({
    key: 'turn-0',
    user: 'earlier',
    reply: { text: 'old answer', turnState: 'complete', actions: true },
  });
  page.addTurn({ key: 'turn-1', user: 'explain this function' });
  bridge = createHarness();
});

afterEach(() => {
  const running = bridge.runtime.runningTaskId;
  if (running) bridge.runtime.abort(running);
  vi.useRealTimers();
});

/** The reply's digest resolves outside the fake clock. */
async function readOutcome(): Promise<ReturnType<Harness['outcome']>> {
  await vi.waitFor(() => expect(bridge.outcome()).toBeDefined());
  return bridge.outcome();
}

describe('Local Bridge turns.read latest', () => {
  const LATEST = { conversationId: 'conv-1', latest: true } as const;
  let feed: PageDataFeed;

  beforeEach(() => {
    feed = createPageDataFeed();
  });

  it("reads the conversation's last reply, not an earlier one", async () => {
    page.setReply('turn-1', {
      text: 'new answer',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    feed.conversation('conv-1', 'r-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(2_000);
    const outcome = await readOutcome();
    expect(outcome).toMatchObject({ ok: true, data: { turnKey: 'r-1', markdown: 'new answer' } });
  });

  it('never returns an older reply while the history is still loading', async () => {
    page.setReply('turn-1', {
      text: 'older answer',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    feed.conversation('conv-1', 'r-2');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(bridge.outcome()).toBeUndefined();
    page.addTurn({
      key: 'turn-2',
      user: 'and then?',
      reply: { text: 'latest answer', turnState: 'complete', actions: true, replyId: 'r-2' },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await readOutcome();
    expect(outcome).toMatchObject({
      ok: true,
      data: { turnKey: 'r-2', markdown: 'latest answer' },
    });
  });

  it('waits for a background-tab reply body that mounts after its action row', async () => {
    page.setReply('turn-1', { text: '', turnState: 'complete', actions: true, replyId: 'r-1' });
    feed.conversation('conv-1', 'r-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(bridge.outcome()).toBeUndefined();
    page.setReply('turn-1', {
      text: 'hydrated answer',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await readOutcome();
    expect(outcome).toMatchObject({
      ok: true,
      data: { turnKey: 'r-1', markdown: 'hydrated answer' },
    });
  });

  it('fails as an empty reply instead of returning blank Markdown', async () => {
    page.setReply('turn-1', { text: '', turnState: 'complete', actions: true, replyId: 'r-1' });
    feed.conversation('conv-1', 'r-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(25_000);
    const outcome = await readOutcome();
    expect(errorCode(outcome)).toBe('unverified');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      reason: 'empty-reply',
    });
  });

  it('fails unverified when ChatGPT never said where the conversation ends', async () => {
    page.setReply('turn-1', {
      text: 'an answer',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(25_000);
    const outcome = bridge.outcome();
    expect(errorCode(outcome)).toBe('unverified');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      reason: 'history-unconfirmed',
    });
  });

  it('refuses while the last reply is still being written, instead of reading the one before', async () => {
    page.setReply('turn-1', { text: 'partial', turnState: 'streaming', replyId: 'r-1' });
    feed.conversation('conv-1', 'r-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(2_000);
    const outcome = bridge.outcome();
    expect(errorCode(outcome)).toBe('unverified');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      reason: 'still-generating',
    });
  });

  it('does not return the reply of a conversation the person switched to while it settled', async () => {
    page.setReply('turn-1', {
      text: 'answer in A',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    feed.conversation('conv-1', 'r-a-later');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(600);
    page.list.innerHTML = '';
    page.addTurn({
      key: 'b-1',
      user: 'question in B',
      reply: { text: 'answer in B', turnState: 'complete', actions: true, replyId: 'r-b' },
    });
    history.pushState(null, '', '/c/conv-2');
    await vi.advanceTimersByTimeAsync(3_000);
    const outcome = await readOutcome();
    expect(errorCode(outcome)).toBe('unverified');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      reason: 'route-changed',
    });
  });

  it('refuses when the last prompt has no reply yet', async () => {
    feed.conversation('conv-1', 'turn-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(errorCode(bridge.outcome())).toBe('unverified');
  });

  it('refuses a reply that has text but no action row yet', async () => {
    page.setReply('turn-1', { text: 'almost', replyId: 'r-1' });
    feed.conversation('conv-1', 'r-1');
    bridge.start('turns.read', LATEST);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(errorCode(bridge.outcome())).toBe('unverified');
  });
});
