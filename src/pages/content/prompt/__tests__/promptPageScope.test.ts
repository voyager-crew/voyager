// @vitest-environment-options {"url":"https://gemini.google.com"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPromptSendReplay, startPromptScopedRead } from '../promptPageScope';

let stop: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button data-email="first@example.com"></button>';
  window.history.replaceState({}, '', '/u/0/app/first');
});
afterEach(() => {
  for (const cleanup of stop) cleanup();
  stop = [];
  vi.useRealTimers();
});
function pendingRead(accepted: string[]) {
  let finish: (value: string) => void = () => {};
  const machine = startPromptScopedRead({
    read: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    accept: (value) => accepted.push(value),
    failed: () => {},
  });
  stop.push(() => {
    void machine.stop();
  });
  return finish;
}

describe('prompt page cancellation', () => {
  it.each(['route', 'account'] as const)(
    'a late history scope read cannot capture into the next %s',
    async (change) => {
      const accepted: string[] = [];
      const first = pendingRead(accepted);
      if (change === 'route') window.history.replaceState({}, '', '/u/0/app/second');
      else document.querySelector('button')!.setAttribute('data-email', 'second@example.com');
      // Resolve before the route watcher or MutationObserver gets an opportunity to run.
      first('stale');
      await Promise.resolve();
      const second = pendingRead(accepted);
      second('current');
      await Promise.resolve();
      expect(accepted).toEqual(['current']);
    },
  );

  it.each(['route', 'account', 'teardown'] as const)(
    'a deferred send cannot run after %s but the next page can send normally',
    async (change) => {
      const replay = createPromptSendReplay();
      stop.push(replay.destroy);
      const sent: string[] = [];
      replay.schedule(() => sent.push('old'));
      if (change === 'route') window.history.replaceState({}, '', '/u/0/app/second');
      else if (change === 'account')
        document.querySelector('button')!.setAttribute('data-email', 'second@example.com');
      else replay.destroy();
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      replay.schedule(() => sent.push('current'));
      vi.advanceTimersByTime(0);
      expect(sent).toEqual(['current']);
    },
  );
});
