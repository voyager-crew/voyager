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

/** A user typing in the visible tab: completion goes to the foreground toast, not the system. */
function typeInForeground(): void {
  returnToTab();
  const composer = document.createElement('rich-textarea');
  document.body.appendChild(composer);
  composer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
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

describe('response notification run', () => {
  it.each([
    ['failed', false],
    ['cancelled', false],
    ['failed', true],
    ['cancelled', true],
  ] as const)(
    'does not announce a %s request when stale generation UI settles (foreground=%s), and the next send recovers',
    async (outcome, foreground) => {
      vi.useFakeTimers();
      vi.mocked(document.hasFocus).mockReturnValue(foreground);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
        foreground ? 'visible' : 'hidden',
      );
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start');
      dispatchPageObserverMessage('request-complete', 1, true, { outcome });
      const stop = document.createElement('button');
      stop.setAttribute('aria-label', 'Stop response');
      Object.defineProperty(stop, 'offsetWidth', { value: 20 });
      document.body.appendChild(stop);
      await vi.advanceTimersByTimeAsync(500);
      stop.remove();
      document.querySelector('p')!.textContent = 'Partial failed answer';
      await vi.advanceTimersByTimeAsync(5000);
      expect(notifyCalls()).toHaveLength(0);
      expect(toast.showIfNeeded).not.toHaveBeenCalled();

      vi.mocked(document.hasFocus).mockReturnValue(false);
      dispatchPageObserverMessage('request-start', 2);
      dispatchPageObserverMessage('request-complete', 2);
      expect(notifyCalls()).toHaveLength(1);
    },
  );

  it.each(['success', 'failed', 'cancelled'])(
    'an older %s terminal event cannot replace the latest failed generation',
    async (outcome) => {
      vi.useFakeTimers();
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start', 1);
      dispatchPageObserverMessage('request-start', 2);
      dispatchPageObserverMessage('request-complete', 2, true, { outcome: 'failed' });
      dispatchPageObserverMessage('request-complete', 1, true, { outcome });
      await vi.advanceTimersByTimeAsync(5000);
      expect(notifyCalls()).toHaveLength(0);
      dispatchPageObserverMessage('request-start', 3);
      dispatchPageObserverMessage('request-complete', 3);
      expect(notifyCalls()).toHaveLength(1);
    },
  );

  it('shows a foreground completion that rendered before the network ended, once the page is quiet', async () => {
    vi.useFakeTimers();
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    typeInForeground();
    dispatchPageObserverMessage('request-start');
    document.querySelector('p')!.textContent = 'A short final answer';
    await vi.advanceTimersByTimeAsync(2000);
    expect(toast.showIfNeeded).not.toHaveBeenCalled();
    dispatchPageObserverMessage('request-complete');
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
    expect(notifyCalls()).toHaveLength(0);
  });

  it('uses an empty summary for consecutive requests whose new prompt never renders', async () => {
    document.body.insertAdjacentHTML('afterbegin', '<user-query>Old prompt</user-query>');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    for (const requestId of [1, 2]) {
      dispatchPageObserverMessage('request-start', requestId, true, {
        prompt: `New prompt ${requestId}`,
      });
      dispatchPageObserverMessage('request-complete', requestId);
      expect(notifyCalls()).toHaveLength(requestId);
      expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ userPrompt: '' }) }),
      );
    }
  });

  it('keeps the fresh send-time prompt even when later DOM shows another question', async () => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<textarea></textarea><user-query>Old prompt</user-query>',
    );
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    document.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.insertAdjacentHTML('beforeend', '<user-query>This request</user-query>');
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'This request' });
    document.body.insertAdjacentHTML('beforeend', '<user-query>Later question</user-query>');
    dispatchPageObserverMessage('request-complete');
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ userPrompt: 'This request' }) }),
    );
  });

  it('does not let a protocol hint authorize an old identical prompt or a conflicting fresh prompt', async () => {
    document.body.insertAdjacentHTML('afterbegin', '<user-query>Same prompt</user-query>');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Same prompt' });
    dispatchPageObserverMessage('request-complete');
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ userPrompt: '' }) }),
    );
    dispatchPageObserverMessage('request-start', 2, true, { prompt: 'Intended question' });
    document.body.insertAdjacentHTML('beforeend', '<user-query>Other question</user-query>');
    dispatchPageObserverMessage('request-complete', 2);
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ userPrompt: '' }) }),
    );
  });

  it('notifies each background request before Gemini renders any answer node', async () => {
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);

    dispatchPageObserverMessage('request-complete', 99);
    expect(notifyCalls()).toHaveLength(0);
    for (const requestId of [1, 2, 3]) {
      dispatchPageObserverMessage('request-start', requestId);
      dispatchPageObserverMessage('request-complete', requestId);
      expect(notifyCalls()).toHaveLength(requestId);
      dispatchPageObserverMessage('request-complete', requestId);
      expect(notifyCalls()).toHaveLength(requestId);
    }
  });

  it('does not notify old history while its next network request is still running', async () => {
    vi.useFakeTimers();
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);

    dispatchPageObserverMessage('request-start');
    document.body.appendChild(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(notifyCalls()).toHaveLength(0);
    dispatchPageObserverMessage('request-complete');
    expect(notifyCalls()).toHaveLength(1);
  });

  it('does not wait for a stale stop button or notify again when background UI catches up', async () => {
    vi.useFakeTimers();
    document.querySelector('button')!.remove();
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop response');
    Object.defineProperty(stop, 'offsetWidth', { value: 20 });
    document.body.appendChild(stop);
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);

    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    expect(notifyCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    stop.remove();
    document.querySelector('p')!.textContent = 'The delayed new answer';
    document
      .querySelector('article')!
      .insertAdjacentHTML('beforeend', '<button aria-label="Copy response">Copy</button>');
    await vi.advanceTimersByTimeAsync(5000);
    expect(notifyCalls()).toHaveLength(1);

    dispatchPageObserverMessage('request-start', 2);
    dispatchPageObserverMessage('request-complete', 2);
    expect(notifyCalls()).toHaveLength(2);
  });

  it('does not postpone completion forever while unrelated page elements keep changing', async () => {
    vi.useFakeTimers();
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    typeInForeground();
    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    const decoration = document.createElement('aside');
    document.body.appendChild(decoration);

    for (let tick = 0; tick < 50; tick += 1) {
      decoration.className = `animation-frame-${tick}`;
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('rechecks completion when the request ends before Gemini removes the stop button', async () => {
    vi.useFakeTimers();
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop response');
    Object.defineProperty(stop, 'offsetWidth', { value: 20 });
    document.body.appendChild(stop);
    typeInForeground();
    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');
    await vi.advanceTimersByTimeAsync(500);
    expect(toast.showIfNeeded).not.toHaveBeenCalled();

    stop.remove();
    document.querySelector('p')!.textContent = 'Final streamed answer';
    await vi.advanceTimersByTimeAsync(5000);
    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('notifies a hidden-page reply whose typing animation never plays', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);

    // No network signal: the processSession channel ends no request when a reply does.
    const stop = showStopButton();
    await vi.advanceTimersByTimeAsync(500);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<article data-author="assistant"><div class="markdown" aria-busy="true">OK</div></article>',
    );
    Object.defineProperty(document.querySelector('.markdown')!, 'offsetWidth', { value: 300 });
    stop.remove();
    await vi.advanceTimersByTimeAsync(5000);

    expect(notifyCalls()).toHaveLength(1);
  });

  it('notifies each of two identical background replies', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);

    for (const expected of [1, 2]) {
      const stop = showStopButton();
      await vi.advanceTimersByTimeAsync(500);
      document.body.insertAdjacentHTML(
        'beforeend',
        '<article data-author="assistant"><p>OK</p><button aria-label="Copy response">Copy</button></article>',
      );
      stop.remove();
      await vi.advanceTimersByTimeAsync(5000);
      expect(notifyCalls()).toHaveLength(expected);
    }
  });

  it('strips hidden Gemini user labels from notification prompt summaries', async () => {
    document.body.innerHTML = `
      <div class="user-query-bubble-with-background">
        <span class="cdk-visually-hidden">You said</span>
        <p>请总结这个页面</p>
      </div>
      <article data-author="assistant">
        <p>Final answer</p>
        <button aria-label="Copy response">Copy</button>
      </article>
    `;
    const promptTurn = document.querySelector('.user-query-bubble-with-background')!;
    promptTurn.remove();
    document.body.insertAdjacentHTML('beforeend', '<textarea></textarea>');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    document.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.prepend(promptTurn);
    dispatchPageObserverMessage('request-start');
    dispatchPageObserverMessage('request-complete');

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            userPrompt: '请总结这个页面',
          }),
        }),
      );
    });
  });
});
