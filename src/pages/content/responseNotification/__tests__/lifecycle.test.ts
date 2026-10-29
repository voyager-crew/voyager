// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { showStopButton } from './pageFixture';

const toast = vi.hoisted(() => ({ showIfNeeded: vi.fn(), stop: vi.fn() }));

vi.mock('@/features/plugins/responseNotification/foregroundCompletionToast', () => ({
  createForegroundCompletionToast: () => toast,
}));

const PAGE_OBSERVER_SOURCE = 'gemini-voyager-response-complete-observer';
const ENABLED_KEY = StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED;

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

let cleanup: (() => void) | null = null;

function dispatchPageObserverMessage(
  type: 'request-start' | 'request-complete',
  requestId = 1,
  shouldNotify = true,
  identity: { prompt?: string; conversationId?: string; pageUrl?: string; outcome?: string } = {},
): void {
  const event = new MessageEvent('message', {
    data: {
      source: PAGE_OBSERVER_SOURCE,
      type,
      payload: {
        requestId,
        shouldNotify,
        outcome: 'success',
        ...identity,
      },
    },
  });
  Object.defineProperty(event, 'source', { value: window });
  window.dispatchEvent(event);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function lastStorageListener(): StorageListener {
  const calls = (chrome.storage.onChanged.addListener as unknown as Mock).mock.calls;
  return calls.at(-1)?.[0] as StorageListener;
}

function notifyCalls(): unknown[] {
  return (chrome.runtime.sendMessage as unknown as Mock).mock.calls.filter(
    ([message]) => (message as { type?: string })?.type === 'gv.responseComplete.notify',
  );
}

/** Lets the user come back to the tab, which flushes a queued foreground fallback. */
function returnToTab(): void {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  window.dispatchEvent(new Event('focus'));
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The signed-in account control Gemini renders; its label carries the email. */
function showAccount(email: string): void {
  let control = document.getElementById('account');
  if (!control) {
    control = document.createElement('button');
    control.id = 'account';
    document.body.prepend(control);
  }
  control.setAttribute('aria-label', `Google Account: ${email}`);
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  cleanup = null;
  window.history.replaceState({}, '', '/app/chat-a');
  document.body.innerHTML = `
    <article data-author="assistant">
      <p>Final answer</p>
      <button aria-label="Copy response">Copy</button>
    </article>
  `;
  (chrome.storage.sync.get as unknown as Mock).mockResolvedValue({ [ENABLED_KEY]: true });
  (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValue({ ok: true });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});

/** Start a run as the page does and wait until its initial setting read was applied. */
async function startedRun(
  create: typeof import('../index').createResponseNotificationRun,
): Promise<() => void> {
  const run = create();
  await run.ready;
  return run.stop;
}

afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('response notification session and setting lifecycle', () => {
  it('a toggle made while the setting loads is not overwritten by the late read', async () => {
    const read = deferred<Record<string, unknown>>();
    (chrome.storage.sync.get as unknown as Mock).mockReturnValueOnce(read.promise);
    const { createResponseNotificationRun } = await import('../index');

    const run = createResponseNotificationRun();
    cleanup = run.stop;
    lastStorageListener()({ [ENABLED_KEY]: { oldValue: true, newValue: false } }, 'sync');
    read.resolve({ [ENABLED_KEY]: true });
    await run.ready;

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it("an old run's cleanup does not silence a new run", async () => {
    const { createResponseNotificationRun } = await import('../index');

    const stopOld = await startedRun(createResponseNotificationRun);
    cleanup = await startedRun(createResponseNotificationRun);
    stopOld();

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');

    expect(notifyCalls()).toHaveLength(1);
  });

  it('ignores a completion whose start belongs to an earlier run', async () => {
    const { createResponseNotificationRun } = await import('../index');

    const stopOld = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1);
    stopOld();

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 2);
    dispatchPageObserverMessage('request-complete', 1);
    expect(notifyCalls()).toHaveLength(0);

    // Only the new run's own request completes a notification, and only once.
    dispatchPageObserverMessage('request-complete', 2);
    await settle();
    expect(notifyCalls()).toHaveLength(1);
  });

  it("does not notify for chat A's reply after moving to chat B", async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    window.history.pushState({}, '', '/app/chat-b');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it.each([
    ['/app/chat-a', '/u/0/app/chat-a'],
    ['/u/0/app/chat-a', '/app/chat-a'],
  ])('a pending reply survives Gemini rewriting %s as %s', async (from, to) => {
    window.history.replaceState({}, '', from);
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    navigate(to);
    dispatchPageObserverMessage('request-complete');

    expect(notifyCalls()).toHaveLength(1);
  });

  it('switching account on the same URL drops a pending completion', async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    showAccount('alice@example.com');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    showAccount('bob@example.com');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('a notify reply that returns after a same-URL account switch leaves no fallback toast', async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    showAccount('alice@example.com');
    const reply = deferred<{ ok: boolean }>();
    (chrome.runtime.sendMessage as unknown as Mock).mockReturnValueOnce(reply.promise);
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    expect(notifyCalls()).toHaveLength(1);

    showAccount('bob@example.com');
    reply.resolve({ ok: false });
    await settle();
    returnToTab();

    expect(toast.showIfNeeded).not.toHaveBeenCalled();
  });

  it('an account email that vanishes for a moment is still compared when it returns', async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    showAccount('alice@example.com');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    document.getElementById('account')?.remove();
    window.dispatchEvent(new Event('focus'));
    showAccount('bob@example.com');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('an account email that appears mid-request is the same account', async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    showAccount('alice@example.com');
    dispatchPageObserverMessage('request-complete');

    expect(notifyCalls()).toHaveLength(1);
  });

  it('switching account drops a pending completion and its fallback toast', async () => {
    window.history.replaceState({}, '', '/u/0/app/chat-a');
    (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValueOnce({ ok: false });
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1);
    dispatchPageObserverMessage('request-complete', 1);
    await settle();
    expect(notifyCalls()).toHaveLength(1);

    dispatchPageObserverMessage('request-start', 2);
    window.history.pushState({}, '', '/u/1/app/chat-a');
    dispatchPageObserverMessage('request-complete', 2);
    returnToTab();
    await settle();

    expect(notifyCalls()).toHaveLength(1);
    expect(toast.showIfNeeded).not.toHaveBeenCalled();
  });

  it('a notify reply that returns after a chat switch does nothing', async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    const reply = deferred<{ ok: boolean }>();
    (chrome.runtime.sendMessage as unknown as Mock).mockReturnValueOnce(reply.promise);
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    expect(notifyCalls()).toHaveLength(1);

    window.history.pushState({}, '', '/app/chat-b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    reply.resolve({ ok: false });
    await settle();
    returnToTab();

    expect(toast.showIfNeeded).not.toHaveBeenCalled();
  });

  it('a deferred fallback toast does not fire once the next generation has started', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const first = deferred<{ ok: boolean }>();
    (chrome.runtime.sendMessage as unknown as Mock).mockReturnValueOnce(first.promise);
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1);
    dispatchPageObserverMessage('request-complete', 1);
    expect(notifyCalls()).toHaveLength(1);

    // Back before the background answered, so no focus event follows the failed answer.
    returnToTab();
    first.resolve({ ok: false });
    await vi.advanceTimersByTimeAsync(0);
    dispatchPageObserverMessage('request-start', 2);
    const stop = showStopButton();
    await vi.advanceTimersByTimeAsync(500);
    // Away and back while the second reply is still being written.
    window.dispatchEvent(new Event('focus'));
    expect(toast.showIfNeeded).not.toHaveBeenCalled();

    // The second generation's own fallback still shows when the user comes back.
    vi.mocked(document.hasFocus).mockReturnValue(false);
    (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValueOnce({ ok: false });
    stop.remove();
    dispatchPageObserverMessage('request-complete', 2);
    await vi.advanceTimersByTimeAsync(0);
    returnToTab();
    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('a page-only generation after a network-owned one still notifies', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1);
    dispatchPageObserverMessage('request-complete', 1);
    expect(notifyCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);

    // The next prompt goes over a channel the page observer does not see: only the page shows it.
    document.body.insertAdjacentHTML('beforeend', '<user-query>Next question</user-query>');
    const stop = showStopButton();
    await vi.advanceTimersByTimeAsync(1000);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<article data-author="assistant"><p>Next answer</p><button aria-label="Copy response">Copy</button></article>',
    );
    stop.remove();
    await vi.advanceTimersByTimeAsync(5000);

    expect(notifyCalls()).toHaveLength(2);
  });

  it("a retired run's late setting read neither starts it nor disturbs its successor", async () => {
    const oldRead = deferred<Record<string, unknown>>();
    (chrome.storage.sync.get as unknown as Mock).mockReturnValueOnce(oldRead.promise);
    const { createResponseNotificationRun } = await import('../index');

    const old = createResponseNotificationRun();
    old.stop();
    cleanup = await startedRun(createResponseNotificationRun);
    oldRead.resolve({ [ENABLED_KEY]: true });
    await old.ready;

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it("a retired run's late notify reply leaves its successor notifying alone", async () => {
    window.history.replaceState({}, '', '/app/chat-a');
    const oldReply = deferred<{ ok: boolean }>();
    (chrome.runtime.sendMessage as unknown as Mock).mockReturnValueOnce(oldReply.promise);
    const { createResponseNotificationRun } = await import('../index');

    const stopOld = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1);
    dispatchPageObserverMessage('request-complete', 1);
    expect(notifyCalls()).toHaveLength(1);

    cleanup = await startedRun(createResponseNotificationRun);
    stopOld();
    oldReply.resolve({ ok: false });
    await settle();
    returnToTab();
    expect(toast.showIfNeeded).not.toHaveBeenCalled();

    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    dispatchPageObserverMessage('request-start', 2);
    dispatchPageObserverMessage('request-complete', 2);
    await settle();
    expect(notifyCalls()).toHaveLength(2);
  });

  it('stop during the initial read starts nothing', async () => {
    const read = deferred<Record<string, unknown>>();
    (chrome.storage.sync.get as unknown as Mock).mockReturnValueOnce(read.promise);
    const { createResponseNotificationRun } = await import('../index');

    const run = createResponseNotificationRun();
    const listener = lastStorageListener();
    run.stop();
    read.resolve({ [ENABLED_KEY]: true });
    await run.ready;

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });

  it('aborting the signal stops the run', async () => {
    const { createResponseNotificationRun } = await import('../index');
    const owner = new AbortController();

    const run = createResponseNotificationRun({ signal: owner.signal });
    cleanup = run.stop;
    await run.ready;
    owner.abort();

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });
});
