// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  type CompletionEvent,
  type CompletionPort,
  type CompletionState,
  INITIAL_COMPLETION_STATE,
  completionEffects,
  completionTransition,
  startCompletion,
} from '../completionMachine';

const reply = document.createElement('article');

function run(events: CompletionEvent[], from: CompletionState = INITIAL_COMPLETION_STATE) {
  return events.reduce(completionTransition, from);
}

describe('completion transitions', () => {
  it('asks for the system notification when the user is away, else shows the toast', () => {
    expect(run([{ type: 'completed', reply, background: true }])).toEqual({
      status: 'notifying',
      reply,
    });
    expect(run([{ type: 'completed', reply, background: false }])).toEqual({
      status: 'showing',
      reply,
    });
  });

  it('a notification that did not show falls back to the toast once the user is back', () => {
    const away: CompletionEvent = { type: 'completed', reply, background: true };
    expect(run([away, { type: 'answered', ok: true }])).toEqual({
      status: 'ended',
      reason: 'notified',
    });
    expect(run([away, { type: 'answered', ok: false }])).toEqual({ status: 'deferred', reply });
    expect(run([away, { type: 'answered', ok: false }, { type: 'returned' }])).toEqual({
      status: 'showing',
      reply,
    });
  });

  it.each(['stopped', 'failed', 'unprompted'] as const)(
    'a generation abandoned as %s announces nothing that completes later',
    (reason) => {
      expect(
        run([
          { type: 'abandoned', reason },
          { type: 'completed', reply, background: true },
        ]),
      ).toEqual({ status: 'ended', reason });
    },
  );

  it('a stop after the reply was delivered does not undo the delivery', () => {
    const notifying = run([{ type: 'completed', reply, background: true }]);
    expect(completionTransition(notifying, { type: 'abandoned', reason: 'stopped' })).toBe(
      notifying,
    );
  });

  it('one generation delivers at most once', () => {
    const delivered = run([{ type: 'completed', reply, background: false }, { type: 'shown' }]);
    expect(delivered).toEqual({ status: 'ended', reason: 'shown' });
    expect(completionTransition(delivered, { type: 'completed', reply, background: true })).toBe(
      delivered,
    );
  });
});

function fakePort(answer: Promise<boolean>, canFlush: () => boolean = () => true) {
  return {
    notify: vi.fn<CompletionPort['notify']>(() => answer),
    showToast: vi.fn<CompletionPort['showToast']>(),
    canFlush: vi.fn<CompletionPort['canFlush']>(canFlush),
  };
}

describe('completion effects', () => {
  it('treats a rejected notification as unavailable and leaves the next run usable', async () => {
    const failed = fakePort(Promise.reject(new Error('Permission unavailable')));
    const old = startCompletion(completionEffects(failed));
    old.send({ type: 'completed', reply, background: true });
    await Promise.resolve();
    expect(old.state.status).toBe('deferred');
    await old.stop();

    const next = fakePort(Promise.resolve(false));
    const delivery = startCompletion(completionEffects(next));
    delivery.send({ type: 'completed', reply, background: true });
    await Promise.resolve();
    window.dispatchEvent(new Event('focus'));
    expect(failed.showToast).not.toHaveBeenCalled();
    expect(next.showToast).toHaveBeenCalledWith(reply);
    await delivery.stop();
  });

  it('shows the fallback toast for its reply once, when the user comes back', async () => {
    const port = fakePort(Promise.resolve(false));
    const delivery = startCompletion(completionEffects(port));
    delivery.send({ type: 'completed', reply, background: true });
    expect(port.notify).toHaveBeenCalledWith(reply);
    await Promise.resolve();
    expect(delivery.state.status).toBe('deferred');

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(port.showToast).toHaveBeenCalledTimes(1);
    expect(port.showToast).toHaveBeenCalledWith(reply);
    await delivery.stop();
  });

  it('keeps the fallback while the page cannot show it yet', async () => {
    let ready = false;
    const port = fakePort(Promise.resolve(false), () => ready);
    const delivery = startCompletion(completionEffects(port));
    delivery.send({ type: 'completed', reply, background: true });
    await Promise.resolve();

    window.dispatchEvent(new Event('focus'));
    expect(port.showToast).not.toHaveBeenCalled();
    ready = true;
    window.dispatchEvent(new Event('focus'));
    expect(port.showToast).toHaveBeenCalledTimes(1);
    await delivery.stop();
  });

  it('a stopped delivery ignores its late notify answer and the return that follows', async () => {
    let answer!: (ok: boolean) => void;
    const port = fakePort(new Promise((resolve) => (answer = resolve)));
    const delivery = startCompletion(completionEffects(port));
    delivery.send({ type: 'completed', reply, background: true });

    await delivery.stop();
    answer(false);
    await Promise.resolve();
    window.dispatchEvent(new Event('focus'));

    expect(delivery.state.status).toBe('notifying');
    expect(port.canFlush).not.toHaveBeenCalled();
    expect(port.showToast).not.toHaveBeenCalled();
  });

  it('a resync that stops the delivery while checking the page shows no toast', async () => {
    let delivery!: ReturnType<typeof startCompletion>;
    const port = fakePort(Promise.resolve(false), () => {
      void delivery.stop();
      return true;
    });
    delivery = startCompletion(completionEffects(port));
    delivery.send({ type: 'completed', reply, background: true });
    await Promise.resolve();

    window.dispatchEvent(new Event('focus'));

    expect(port.showToast).not.toHaveBeenCalled();
  });
});
