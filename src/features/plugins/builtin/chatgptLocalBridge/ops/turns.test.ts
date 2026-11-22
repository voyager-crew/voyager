// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/conv-1" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { type ChatGptPageFixture, mountChatGptPage } from '../__tests__/chatgptPageFixture';
import { type Harness, createHarness, errorCode } from '../__tests__/harness';
import { createPageDataFeed } from '../__tests__/pageDataFeed';
import { throttleChainedTimers } from '../__tests__/throttledTimers';
import { BAR_CONFIRM_CYCLES, PROGRESS_EVERY_MS } from './turnsWaitReply';

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
const WAIT = { conversationId: 'conv-1', afterUserTurnKey: 'turn-1' } as const;

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

describe('Local Bridge turns.waitReply', () => {
  it('does not finish on a reply that is still being written, even with its action row showing', async () => {
    bridge.start('turns.waitReply', WAIT);
    page.setReply('turn-1', {
      text: 'Thinking about',
      turnState: 'streaming',
      actions: true,
      replyId: 'r-1',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bridge.outcome()).toBeUndefined();

    // Finished state without its action row is not proof either.
    page.setReply('turn-1', { text: 'The answer.', turnState: 'complete', replyId: 'r-1' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bridge.outcome()).toBeUndefined();

    page.setReply('turn-1', {
      text: 'The answer.',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES + 2) * 1_000);
    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { assistantTurnKey: 'r-1', status: 'complete' },
    });
  });

  it('does not take an action row that flashes on a quiet, unfinished reply as the end', async () => {
    bridge.start('turns.waitReply', WAIT);
    page.setReply('turn-1', { text: 'Let me think.', replyId: 'r-1' });
    await vi.advanceTimersByTimeAsync(5_000);
    page.setReply('turn-1', { text: 'Let me think.', actions: true, replyId: 'r-1' });
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES - 1) * 1_000);
    page.setReply('turn-1', { text: 'Let me think.', replyId: 'r-1' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.outcome()).toBeUndefined();
  });

  it('waits out text that keeps changing and a stop control before finishing', async () => {
    bridge.start('turns.waitReply', { ...WAIT, stableMs: 1_500 });
    page.showStopControl(true);
    for (let second = 0; second < 6; second += 1) {
      page.setReply('turn-1', { text: `part ${second}`, actions: true, replyId: 'r-1' });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(bridge.outcome()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.outcome()).toBeUndefined();

    page.showStopControl(false);
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES + 2) * 1_000);
    expect(bridge.outcome()?.ok).toBe(true);
  });

  // Hours of thinking are covered by the clock-jump test below; ticking every poll through
  // 30 minutes timed out on CI.
  it('reports thinking progress every 15 s while the stop control shows', async () => {
    bridge.start('turns.waitReply', WAIT);
    // Pro thinks with the composer's stop control showing and no reply text yet.
    page.showStopControl(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(bridge.outcome()).toBeUndefined();
    const progress = bridge.progress();
    expect(progress.length).toBeGreaterThanOrEqual((2 * 60_000) / PROGRESS_EVERY_MS - 1);
    expect(progress[0]).toMatchObject({ phase: 'thinking', textLength: 0 });

    page.showStopControl(false);
    page.setReply('turn-1', { text: 'Done.', turnState: 'complete', actions: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bridge.outcome()).toMatchObject({ ok: true, data: { assistantTurnKey: 'turn-1-r' } });
  });

  it('keeps waiting for a reply ChatGPT is still generating after 3 hours', async () => {
    bridge.start('turns.waitReply', WAIT);
    page.showStopControl(true);
    // A hidden tab's timers drift; the clock jumps between polls instead of ticking each second.
    for (let step = 0; step < 9; step += 1) {
      vi.setSystemTime(Date.now() + 20 * 60_000);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    page.showStopControl(false);
    for (let step = 0; step < 4; step += 1) {
      page.setReply('turn-1', { text: `streamed part ${step}`, replyId: 'r-1' });
      vi.setSystemTime(Date.now() + 15 * 60_000);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(bridge.outcome()).toBeUndefined();

    page.setReply('turn-1', {
      text: 'The answer.',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES + 3) * 1_000);
    expect(bridge.outcome()).toMatchObject({ ok: true, data: { assistantTurnKey: 'r-1' } });
  });

  // Two minutes, not the default 20: each 15 s beat is a full look, and 21 minutes of them
  // timed out on CI.
  it('fails as reply-stalled once the reply shows no activity for its stall window', async () => {
    bridge.start('turns.waitReply', { ...WAIT, stallMs: 2 * 60_000 });
    page.setReply('turn-1', { text: 'Half an answer', replyId: 'r-1' });
    // A quiet page is looked at only on its beat and at its stall, so the clock runs for real.
    await vi.advanceTimersByTimeAsync(110_000);
    expect(bridge.outcome()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = bridge.outcome();
    expect(errorCode(outcome)).toBe('reply-stalled');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      conversationId: 'conv-1',
      textLength: 'Half an answer'.length,
    });
  });

  it('waits for the reply in a background tab without the foreground', async () => {
    const clock = throttleChainedTimers();
    try {
      bridge = createHarness(undefined, chatgptAdapter, clock.defer);
      bridge.start('turns.waitReply', WAIT);
      page.showStopControl(true);
      for (let second = 0; second < 5; second += 1) {
        page.setReply('turn-1', { text: `streamed part ${second}`, replyId: 'r-1' });
        await clock.advance(1_000);
      }
      page.showStopControl(false);
      page.setReply('turn-1', {
        text: 'The answer.',
        turnState: 'complete',
        actions: true,
        replyId: 'r-1',
      });
      await clock.advance((BAR_CONFIRM_CYCLES + 2) * 1_000);
    } finally {
      clock.restore();
    }
    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { assistantTurnKey: 'r-1', evidence: { hidden: true } },
    });
  });

  it('does not read a frozen stretch as a stalled reply', async () => {
    bridge.start('turns.waitReply', WAIT);
    page.setReply('turn-1', { text: 'Half an answer', replyId: 'r-1' });
    await vi.advanceTimersByTimeAsync(2_000);
    // The browser froze the tab for 25 minutes: nothing ran, then the page resumes.
    vi.setSystemTime(Date.now() + 25 * 60_000);
    document.dispatchEvent(new Event('resume'));
    await vi.advanceTimersByTimeAsync(PROGRESS_EVERY_MS);
    expect(bridge.outcome()).toBeUndefined();

    page.setReply('turn-1', {
      text: 'Half an answer, then the rest.',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES + 2) * 1_000);
    expect(bridge.outcome()?.ok).toBe(true);
  });

  it('names an alert it could not classify when the reply stalls behind it', async () => {
    bridge.start('turns.waitReply', WAIT);
    page.setReply('turn-1', { text: 'Half an answer', replyId: 'r-1' });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="alert">Du hast dein Limit erreicht.</div>',
    );
    await vi.advanceTimersByTimeAsync(2_000);
    vi.setSystemTime(Date.now() + 20 * 60_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const outcome = bridge.outcome();
    expect(errorCode(outcome)).toBe('reply-stalled');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      alerts: ['Du hast dein Limit erreicht.'],
    });
  });

  it('fails as rate-limited on a usage alert in the words the site data names', async () => {
    bridge = createHarness(undefined, {
      ...chatgptAdapter,
      pageHooks: { ...chatgptAdapter.pageHooks!, rateLimit: ['limit erreicht'] },
    });
    bridge.start('turns.waitReply', WAIT);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="alert">Du hast dein Limit erreicht.</div>',
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(errorCode(bridge.outcome())).toBe('rate-limited');
  });

  it('fails as reply-failed on failure copy the site data names, instead of returning it', async () => {
    bridge = createHarness(undefined, {
      ...chatgptAdapter,
      pageHooks: { ...chatgptAdapter.pageHooks!, replyFailed: ['^denken fehlgeschlagen$'] },
    });
    bridge.start('turns.waitReply', WAIT);
    page.setReply('turn-1', {
      text: 'Denken fehlgeschlagen',
      turnState: 'complete',
      actions: true,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errorCode(bridge.outcome())).toBe('reply-failed');
  });

  it('ends with challenge and a toast when a verification page replaces the thread', async () => {
    bridge.start('turns.waitReply', WAIT);
    await vi.advanceTimersByTimeAsync(5_000);
    document.title = 'Just a moment...';
    document.body.innerHTML = '<iframe src="https://challenges.cloudflare.com/x"></iframe>';
    await vi.advanceTimersByTimeAsync(500);
    expect(errorCode(bridge.outcome())).toBe('challenge');
    expect(toasts.show).toHaveBeenCalledTimes(1);
  });

  it('times out with the conversation id so the job can be harvested later', async () => {
    bridge.start('turns.waitReply', { ...WAIT, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(61_000);
    const outcome = bridge.outcome();
    expect(errorCode(outcome)).toBe('timeout');
    expect(outcome?.ok === false && outcome.error.details).toMatchObject({
      conversationId: 'conv-1',
    });
  });

  it("does not take the reply to the person's next prompt as this prompt's reply", async () => {
    page.addTurn({
      key: 'turn-2',
      user: 'a different question',
      reply: { text: 'reply-B', turnState: 'complete', actions: true, replyId: 'r-b' },
    });
    bridge.start('turns.waitReply', { ...WAIT, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(errorCode(bridge.outcome())).toBe('timeout');
  });

  it('still finds a reply rendered in its own item right after the prompt', async () => {
    // An earlier ChatGPT DOM put the reply in the next item, with no prompt of its own.
    const next = page.addTurn({
      key: 'turn-1-a',
      user: '',
      reply: { text: 'The answer.', turnState: 'complete', actions: true, replyId: 'r-1' },
    });
    next.querySelector('[data-chatgpt-search-unit-key$=":user"]')?.remove();
    bridge.start('turns.waitReply', WAIT);
    await vi.advanceTimersByTimeAsync((BAR_CONFIRM_CYCLES + 3) * 1_000);
    expect(bridge.outcome()).toMatchObject({ ok: true, data: { assistantTurnKey: 'r-1' } });
  });

  it('refuses to watch another conversation than the tab shows', async () => {
    bridge.start('turns.waitReply', { ...WAIT, conversationId: 'conv-2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(errorCode(bridge.outcome())).toBe('unverified');
  });
});

describe('Local Bridge turns.read', () => {
  it('reads the reply as Markdown without the localized role heading', async () => {
    page.setReply('turn-1', {
      text: 'Use `map` here.',
      turnState: 'complete',
      actions: true,
      replyId: 'r-1',
    });
    bridge.start('turns.read', { conversationId: 'conv-1', assistantTurnKey: 'r-1' });
    const outcome = await readOutcome();
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    const data = outcome.data as { markdown: string; messageId: string; textSha256: string };
    expect(data.markdown).toContain('Use `map` here.');
    expect(data.markdown).not.toContain('ChatGPT 说');
    expect(data.messageId).toBe('r-1');
    expect(data.textSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves the heading out when it sits inside the reply element too', async () => {
    page.setReply('turn-1', { text: 'Inner.', turnState: 'complete', replyId: 'r-1' });
    const reply = document.querySelector('[data-chatgpt-selection-message-id="r-1"]')!;
    const heading = document.querySelector('h4[data-conversation-role]')!;
    reply.prepend(heading);
    bridge.start('turns.read', { conversationId: 'conv-1', assistantTurnKey: 'r-1' });
    const outcome = await readOutcome();
    expect(outcome?.ok && (outcome.data as { markdown: string }).markdown).toBe('Inner.');
    expect(reply.querySelector('h4')).not.toBeNull();
  });

  it('leaves out the file card ChatGPT shows under a reply that cites a file', async () => {
    page.setReply('turn-1', { text: 'From note.txt.', turnState: 'complete', replyId: 'r-1' });
    const reply = document.querySelector('[data-chatgpt-selection-message-id="r-1"]')!;
    const card = document.createElement('div');
    // Measured live: a span with role=button, not a <button>, so the export does not skip it.
    card.innerHTML =
      '<div><span data-file-reference="true" role="button">note.txt</span></div><div>文档</div>';
    reply.appendChild(card);
    bridge.start('turns.read', { conversationId: 'conv-1', assistantTurnKey: 'r-1' });
    const outcome = await readOutcome();
    expect(outcome?.ok && (outcome.data as { markdown: string }).markdown).toBe('From note.txt.');
  });

  it('lists the sandbox files the reply links, in reply order and once each', async () => {
    const feed = createPageDataFeed();
    page.setReply('turn-1', { text: 'Files are ready.', turnState: 'complete', replyId: 'r-1' });
    const link = (name: string, label = name) => ({
      label,
      href: `sandbox:/mnt/data/${name}`,
    });
    feed.conversation('conv-1', 'r-1', [
      { id: 'u-0', role: 'user', links: [] },
      // An earlier turn's file is not this reply's.
      { id: 'r-0', role: 'assistant', links: [link('old.csv')] },
      { id: 'u-1', role: 'user', links: [] },
      { id: 'sub-1', role: 'assistant', links: [link('data.csv', 'Download the data')] },
      { id: 'tool-1', role: 'tool', links: [] },
      { id: 'r-1', role: 'assistant', links: [link('chart.png'), link('data.csv', 'again')] },
    ]);
    bridge.start('turns.read', { conversationId: 'conv-1', assistantTurnKey: 'r-1' });
    const outcome = await readOutcome();
    expect(outcome?.ok && (outcome.data as { files: unknown[] }).files).toEqual([
      {
        kind: 'sandbox',
        label: 'Download the data',
        href: 'sandbox:/mnt/data/data.csv',
        controlRef: 'sub-1',
      },
      {
        kind: 'sandbox',
        label: 'chart.png',
        href: 'sandbox:/mnt/data/chart.png',
        controlRef: 'r-1',
      },
    ]);
  });

  it('refuses a reply that is still being written', async () => {
    page.setReply('turn-1', { text: 'partial', turnState: 'streaming', replyId: 'r-1' });
    bridge.start('turns.read', { conversationId: 'conv-1', assistantTurnKey: 'r-1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(errorCode(bridge.outcome())).toBe('unverified');
  });
});

describe('Local Bridge conversation.ready', () => {
  it('reports a signed-in chat-mode page and its conversation', async () => {
    bridge.start('conversation.ready', { expect: { conversationId: 'conv-1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { conversationId: 'conv-1', loggedIn: true, mode: 'chat' },
    });
  });

  it('reads an unknown composer label as an unknown mode', async () => {
    page.composer.setAttribute('aria-label', 'Ask anything');
    bridge.start('conversation.ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.outcome()).toMatchObject({ ok: true, data: { mode: 'unknown' } });
  });

  it('reports login-required when the page offers a login instead of a composer', async () => {
    page.form.remove();
    document.body.insertAdjacentHTML('beforeend', '<a href="/auth/login">Log in</a>');
    bridge.start('conversation.ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(errorCode(bridge.outcome())).toBe('login-required');
  });
});
