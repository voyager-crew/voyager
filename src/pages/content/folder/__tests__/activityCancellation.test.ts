// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/chat" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deferActivitySend, startActivityLifetime } from '../gemini/activityLifetime';
import * as accountRoute from '../session/geminiAccountRoute';
import { showGeminiAccount } from './geminiAccountControl';

const stopped: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/u/0/app/chat');
});
afterEach(async () => {
  stopped.splice(0).forEach((stop) => stop());
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it('a switched route keeps its own activity when an old send reaches the next task', async () => {
  const apply = vi.fn();
  const old = deferActivitySend(new Event('click'), apply);
  stopped.push(() => {
    void old.stop();
  });
  history.pushState({}, '', '/u/1/app/chat');
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).not.toHaveBeenCalled();
  const current = deferActivitySend(new Event('click'), apply);
  stopped.push(() => {
    void current.stop();
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).toHaveBeenCalledTimes(1);
});

it('an account switch cannot inherit a send pending on the same URL', async () => {
  showGeminiAccount('a@example.com');
  const apply = vi.fn();
  const old = deferActivitySend(new Event('click'), apply);
  stopped.push(() => {
    void old.stop();
  });
  showGeminiAccount('b@example.com');
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).not.toHaveBeenCalled();
  const current = deferActivitySend(new Event('click'), apply);
  stopped.push(() => {
    void current.stop();
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).toHaveBeenCalledTimes(1);
});

it('stopped tracking cannot attach a late listener after a replacement has started', async () => {
  let finish = (_ready: boolean) => {};
  const oldReady = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const activate = vi.fn(() => vi.fn());
  const old = startActivityLifetime({ initialize: () => oldReady, activate });
  old.stop();
  const current = startActivityLifetime({ initialize: async () => true, activate });
  stopped.push(current.stop);
  await current.ready;
  finish(true);
  await old.ready;
  await Promise.resolve();
  expect(activate).toHaveBeenCalledTimes(1);
  current.stop();
  expect(activate.mock.results[0].value).toHaveBeenCalledTimes(1);
});

it('retiring the send phase clears its timer while a later send still records activity', async () => {
  const apply = vi.fn();
  const old = deferActivitySend(new Event('click'), apply);
  await old.stop();
  const current = deferActivitySend(new Event('click'), apply);
  stopped.push(() => {
    void current.stop();
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(apply).toHaveBeenCalledTimes(1);
});

it.each(['route', 'account'] as const)(
  'a %s change retires pending initialization and a later start can activate',
  async (change) => {
    showGeminiAccount('a@example.com');
    let finish = (_ready: boolean) => {};
    const waiting = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const activate = vi.fn(() => () => {});
    const old = startActivityLifetime({ initialize: () => waiting, activate });
    stopped.push(old.stop);
    if (change === 'route') {
      history.pushState({}, '', '/u/1/app/next');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else showGeminiAccount('b@example.com');
    await Promise.resolve();
    finish(true);
    await old.ready;
    expect(old.isRunning()).toBe(false);
    const current = startActivityLifetime({ initialize: async () => true, activate });
    stopped.push(current.stop);
    await current.ready;
    expect(activate).toHaveBeenCalledTimes(1);
    expect(current.isRunning()).toBe(true);
  },
);

it('an unavailable timestamp store waits for an explicit retry instead of restarting itself', async () => {
  const initialize = vi.fn(async () => false);
  const onCancelled = vi.fn();
  const activate = vi.fn(() => () => {});
  const unavailable = startActivityLifetime({ initialize, activate, onCancelled });
  stopped.push(unavailable.stop);
  await unavailable.ready;
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(onCancelled).not.toHaveBeenCalled();
  const available = startActivityLifetime({ initialize: async () => true, activate, onCancelled });
  stopped.push(available.stop);
  await available.ready;
  expect(activate).toHaveBeenCalledTimes(1);
});

it('streaming replies do not repeatedly scan the account while activity is loading', async () => {
  showGeminiAccount('a@example.com');
  const read = vi.spyOn(accountRoute, 'geminiPageAccountFingerprint');
  const activate = vi.fn(() => () => {});
  const old = startActivityLifetime({ initialize: () => new Promise(() => {}), activate });
  stopped.push(old.stop);
  const reply = document.createElement('model-response');
  document.body.append(reply);
  for (let i = 0; i < 30; i++) {
    reply.append(document.createTextNode('streaming text'));
    await Promise.resolve();
  }
  expect(read.mock.calls.length).toBeLessThanOrEqual(2);
  showGeminiAccount('b@example.com');
  await vi.advanceTimersByTimeAsync(1200);
  await old.ready;
  expect(old.isRunning()).toBe(false);
  const current = startActivityLifetime({ initialize: async () => true, activate });
  stopped.push(current.stop);
  await current.ready;
  expect(activate).toHaveBeenCalledTimes(1);
});
