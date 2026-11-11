import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_INTERVAL_MS,
  OBSERVER_CALLBACKS_PER_SECOND,
  type SafeguardScope,
  installScriptedSafeguards,
} from '../safeguards';

function guardedScope(clock: { now: number }, warn = vi.fn()) {
  const scope: SafeguardScope = {
    MutationObserver: window.MutationObserver,
    setInterval: window.setInterval.bind(window),
  };
  installScriptedSafeguards(scope, { now: () => clock.now, warn });
  return { scope, warn };
}

/** Lets jsdom deliver every queued observer callback. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('installScriptedSafeguards', () => {
  it('disconnects an observer that keeps re-triggering itself', async () => {
    const clock = { now: 0 };
    const { scope, warn } = guardedScope(clock);
    const target = document.createElement('div');
    document.body.append(target);
    let calls = 0;
    const observer = new scope.MutationObserver(() => {
      calls += 1;
      // A cap far above the limit turns a broken guard into a failed assertion, not a hang.
      if (calls < 10_000) target.append(document.createElement('span'));
    });
    observer.observe(target, { childList: true });
    target.append(document.createElement('span'));
    await settle();

    expect(calls).toBe(OBSERVER_CALLBACKS_PER_SECOND);
    expect(warn).toHaveBeenCalledOnce();

    observer.observe(target, { childList: true });
    target.append(document.createElement('span'));
    await settle();
    expect(calls).toBe(OBSERVER_CALLBACKS_PER_SECOND);
  });

  it('leaves a busy observer that stays under the rate running', async () => {
    const clock = { now: 0 };
    const { scope, warn } = guardedScope(clock);
    const target = document.createElement('div');
    let calls = 0;
    const observer = new scope.MutationObserver(() => {
      calls += 1;
    });
    observer.observe(target, { childList: true });
    for (let second = 0; second < 3; second += 1) {
      clock.now = second * 1000;
      for (let i = 0; i < OBSERVER_CALLBACKS_PER_SECOND; i += 1) {
        target.append(document.createElement('span'));
        await Promise.resolve();
      }
    }
    await settle();

    expect(calls).toBe(OBSERVER_CALLBACKS_PER_SECOND * 3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes the observer and its records to the plugin’s callback', async () => {
    const { scope } = guardedScope({ now: 0 });
    const target = document.createElement('div');
    const callback = vi.fn();
    const observer = new scope.MutationObserver(callback);
    observer.observe(target, { attributes: true });
    target.setAttribute('data-x', '1');
    await settle();

    expect(callback).toHaveBeenCalledOnce();
    const [records, passed] = callback.mock.calls[0];
    expect(passed).toBe(observer);
    expect(records[0].attributeName).toBe('data-x');
  });

  it('runs a near-zero interval no more often than the floor', () => {
    vi.useFakeTimers();
    const { scope } = guardedScope({ now: 0 });
    const tick = vi.fn();
    const id = scope.setInterval(tick, 0);
    vi.advanceTimersByTime(MIN_INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledOnce();
    clearInterval(id);

    const slow = vi.fn();
    scope.setInterval(slow, 200, 'arg');
    vi.advanceTimersByTime(400);
    expect(slow.mock.calls).toEqual([['arg'], ['arg']]);
  });
});
