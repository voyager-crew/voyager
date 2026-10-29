// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

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
  identity: { prompt?: string; conversationId?: string; pageUrl?: string } = {},
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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function userTurn(prompt: string): string {
  return `<user-query><span class="user-query-container">
    <user-query-content class="user-query-container"><div class="user-query-container">
      <span class="user-query-bubble-with-background">${prompt}</span>
      <h5 class="cdk-visually-hidden screen-reader-user-query-label">You said ${prompt}</h5>
    </div></user-query-content></span></user-query>`;
}

/** Replaces the optimistic turn with fresh addressed nodes, as Gemini does. */
function showChat(prompt: string, answer = 'Final answer', completed = true): void {
  document.body.innerHTML = `${userTurn(prompt)}<model-response><article data-author="assistant">
    <p>${answer}</p>${completed ? '<button aria-label="Copy response">Copy</button>' : ''}
  </article></model-response>`;
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
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('first-send notification identity', () => {
  it('notifies a confirmed first send before its assistant response renders', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Hello' });
    navigate('/app/chat-a');
    document.body.innerHTML = userTurn('Hello');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });

    expect(notifyCalls()).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ userPrompt: 'Hello' }) }),
    );
  });

  it.each(['/app/new-chat-id', '/u/0/app/new-chat-id'])(
    'still notifies when the first send turns /app into %s',
    async (address) => {
      window.history.replaceState({}, '', '/app');
      document.body.innerHTML = '';
      const { createResponseNotificationRun } = await import('../index');

      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start');
      window.history.pushState({}, '', address);
      await settle();
      showChat('Draft the plan');
      dispatchPageObserverMessage('request-complete');
      expect(notifyCalls()).toHaveLength(1);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'gv.responseComplete.notify',
          payload: expect.objectContaining({
            conversationUrl: `https://gemini.google.com${address}`,
            userPrompt: 'Draft the plan',
          }),
        }),
      );
    },
  );

  it('keeps the first-send prompt when it renders after the request starts', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    showChat('Draft the plan');
    await settle();
    navigate('/app/new-chat-id');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'new-chat-id' });

    expect(notifyCalls()).toHaveLength(1);
  });

  it('notifies when user-query and the first address render in the same task', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Draft the plan' });
    showChat('Draft the plan');
    window.history.pushState({}, '', '/app/new-chat-id');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'new-chat-id' });
    expect(notifyCalls()).toHaveLength(1);
  });

  it('holds completion until the addressed first prompt renders', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Draft the plan' });
    navigate('/app/new-chat-id');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'new-chat-id' });
    expect(notifyCalls()).toHaveLength(0);
    showChat('Draft the plan');
    await settle();
    expect(notifyCalls()).toHaveLength(1);
  });

  it.each([
    ['same 139-character prefix', 'x'.repeat(139) + 'source', 'x'.repeat(139) + 'target'],
    ['identical short prompt', 'Hello', 'Hello'],
    ['empty target prompt', 'Hello', ''],
  ])('does not mistake existing B for the first send with %s', async (_name, source, target) => {
    window.history.replaceState({}, '', '/app');
    showChat(source);
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    navigate('/app/chat-b');
    showChat(target, 'B answer');
    dispatchPageObserverMessage(
      'request-complete',
      1,
      true,
      _name === 'identical short prompt' ? { conversationId: 'chat-a' } : {},
    );
    await settle();
    expect(notifyCalls()).toHaveLength(0);
  });

  it('vetoes a conflicting request-body prompt even when the response ID matches', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'x'.repeat(139) + 'source' });
    navigate('/app/chat-a');
    showChat('x'.repeat(139) + 'target');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });
    await settle();
    expect(notifyCalls()).toHaveLength(0);
  });

  it('uses the send-time URL when request-start delivery follows address assignment', async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    navigate('/app/chat-a');
    dispatchPageObserverMessage('request-start', 1, true, {
      prompt: 'Hello',
      pageUrl: 'https://gemini.google.com/app',
    });
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });
    expect(notifyCalls()).toHaveLength(0);
    showChat('Hello');
    await settle();
    expect(notifyCalls()).toHaveLength(1);
  });

  it('waits for fresh turns when the assigned URL still shows an older identical prompt', async () => {
    window.history.replaceState({}, '', '/app');
    showChat('Hello', 'Old B answer');
    document.title = 'Old B title';
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Hello' });
    navigate('/app/chat-a');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });
    expect(notifyCalls()).toHaveLength(0);
    // The fresh matching prompt confirms identity; background completion does not need answer DOM.
    document.querySelector('user-query')!.remove();
    document.body.insertAdjacentHTML('afterbegin', '<user-query>Hello</user-query>');
    await settle();
    expect(notifyCalls()).toHaveLength(1);
    showChat('Hello', 'New A answer');
    await settle();
    expect(notifyCalls()).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ conversationTitle: '', userPrompt: 'Hello' }),
      }),
    );
  });

  it('does not pair a reused user turn with a fresh completed response', async () => {
    window.history.replaceState({}, '', '/app');
    showChat('Hello');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    navigate('/app/chat-a');
    document.querySelector('article')!.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<article data-author="assistant">New answer<button aria-label="Copy">Copy</button></article>',
    );
    dispatchPageObserverMessage('request-complete');
    expect(notifyCalls()).toHaveLength(0);
  });

  it('flushes a completed first send when only its address arrives last', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, '', '/app');
      document.body.innerHTML = '';
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start', 1, true, { prompt: 'Hello' });
      showChat('Hello');
      await vi.advanceTimersByTimeAsync(300);
      dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });
      await vi.advanceTimersByTimeAsync(2000);
      expect(notifyCalls()).toHaveLength(0);
      navigate('/app/chat-a');
      expect(notifyCalls()).toHaveLength(1);
    } finally {
      cleanup?.();
      cleanup = null;
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    'hidden user labels do not swallow first or second notifications (foreground=%s)',
    async (foreground) => {
      vi.useFakeTimers();
      vi.mocked(document.hasFocus).mockReturnValue(foreground);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
        foreground ? 'visible' : 'hidden',
      );
      window.history.replaceState({}, '', '/app');
      document.body.innerHTML = '<textarea></textarea><pending-request></pending-request>';
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      const count = () =>
        foreground ? toast.showIfNeeded.mock.calls.length : notifyCalls().length;
      for (const [index, prompt] of ['hni', 'hihi'].entries()) {
        const requestId = index + 1;
        document.body.insertAdjacentHTML(
          'beforeend',
          '<textarea></textarea><pending-request></pending-request>',
        );
        document.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('pending-request')!.innerHTML = userTurn(prompt);
        await vi.advanceTimersByTimeAsync(13);
        dispatchPageObserverMessage('request-start', requestId, true, {
          prompt,
          pageUrl: location.href,
        });
        await vi.advanceTimersByTimeAsync(2783);
        window.history.pushState({}, '', '/app/fd9f55924eee35eb');
        showChat(prompt, `Answer ${requestId}`, false);
        await vi.advanceTimersByTimeAsync(1195);
        dispatchPageObserverMessage('request-complete', requestId, true, {
          conversationId: 'fd9f55924eee35eb',
        });
        expect(count()).toBe(foreground ? index : requestId);
        await vi.advanceTimersByTimeAsync(100);
        document
          .querySelector('article')!
          .insertAdjacentHTML('beforeend', '<button aria-label="Copy">Copy</button>');
        await vi.advanceTimersByTimeAsync(2000);
        document.body.appendChild(document.createElement('span'));
        await vi.advanceTimersByTimeAsync(500);
        expect(count()).toBe(requestId);
        expect(foreground ? notifyCalls() : toast.showIfNeeded.mock.calls).toHaveLength(0);
        if (foreground)
          expect(toast.showIfNeeded).toHaveBeenLastCalledWith(document.querySelector('article'));
        else
          expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
              payload: expect.objectContaining({ userPrompt: prompt }),
            }),
          );
      }
    },
  );

  it('an unconfirmed first send does not silence the second request in the addressed chat', async () => {
    window.history.replaceState({}, '', '/app');
    showChat('');
    const { createResponseNotificationRun } = await import('../index');
    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start', 1, true, { prompt: 'hni' });
    navigate('/app/chat-a');
    dispatchPageObserverMessage('request-complete', 1, true, { conversationId: 'chat-a' });
    expect(notifyCalls()).toHaveLength(0);
    dispatchPageObserverMessage('request-start', 2, true, {
      prompt: 'hihi',
      pageUrl: location.href,
    });
    showChat('hihi', 'Second answer');
    dispatchPageObserverMessage('request-complete', 2, true, { conversationId: 'chat-a' });
    await settle();
    expect(notifyCalls()).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ userPrompt: 'hihi' }),
      }),
    );
  });

  it('an empty latest turn never borrows an earlier prompt or a hidden label', async () => {
    const { getLatestUserPromptText } = await import('../pageSnapshot');
    showChat('Earlier prompt');
    expect(getLatestUserPromptText()).toBe('Earlier prompt');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<h5 class="cdk-visually-hidden screen-reader-user-query-label">You said hidden</h5>',
    );
    expect(getLatestUserPromptText()).toBe('Earlier prompt');
    document.body.insertAdjacentHTML('beforeend', userTurn(''));
    expect(getLatestUserPromptText()).toBe('');
  });

  it("does not take chat B's prompt as the new chat's before the route poll notices", async () => {
    window.history.replaceState({}, '', '/app');
    document.body.innerHTML = '';
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    showChat('Source question');
    await settle();
    // Gemini's router uses pushState, which fires no popstate.
    window.history.pushState({}, '', '/app/chat-b');
    showChat('Older question in chat B', 'Older answer in chat B');
    await settle();
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('a new chat whose prompt was never readable does not claim the chat it moves to', async () => {
    window.history.replaceState({}, '', '/app');
    const { createResponseNotificationRun } = await import('../index');

    cleanup = await startedRun(createResponseNotificationRun);
    dispatchPageObserverMessage('request-start');
    navigate('/app/chat-b');
    dispatchPageObserverMessage('request-complete');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('notifies a first generation lasting more than 120 seconds without protocol hints', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, '', '/app');
      document.body.innerHTML = '';
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start');
      await vi.advanceTimersByTimeAsync(121_000);
      window.history.pushState({}, '', '/app/chat-a');
      showChat('Long research');
      dispatchPageObserverMessage('request-complete');
      await vi.advanceTimersByTimeAsync(1000);
      expect(notifyCalls()).toHaveLength(1);
    } finally {
      cleanup?.();
      cleanup = null;
      vi.useRealTimers();
    }
  });

  it('releases an unconfirmed completion on the next DOM event and preserves DOM fallback', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, '', '/app');
      document.body.innerHTML = '';
      const { createResponseNotificationRun } = await import('../index');
      cleanup = await startedRun(createResponseNotificationRun);
      dispatchPageObserverMessage('request-start');
      navigate('/app/chat-a');
      dispatchPageObserverMessage('request-complete');
      document.body.innerHTML = '<button aria-label="Stop response">Stop</button>';
      await vi.advanceTimersByTimeAsync(500);
      showChat('Late visible prompt');
      await vi.advanceTimersByTimeAsync(2000);
      document.body.appendChild(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(300);
      expect(notifyCalls()).toHaveLength(1);
    } finally {
      cleanup?.();
      cleanup = null;
      vi.useRealTimers();
    }
  });
});
