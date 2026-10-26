// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/conv-1" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatgptAdapter } from '../../sites/adapters/chatgpt';
import { createChatGptResponseNotificationRun } from './run';

const toast = vi.hoisted(() => ({ showIfNeeded: vi.fn(), stop: vi.fn() }));

vi.mock('@/pages/content/responseNotification/foregroundCompletionToast', () => ({
  createForegroundCompletionToast: () => toast,
}));

let stopRun: (() => void) | null = null;
let turnCount = 0;

function setPageState(visibility: 'visible' | 'hidden', focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
}

/** jsdom has no layout: mark a node as one ChatGPT has rendered. */
function rendered<T extends HTMLElement>(element: T): T {
  Object.defineProperty(element, 'offsetWidth', { value: 100, configurable: true });
  return element;
}

/** The measured shape: a composer form, then `[data-turn-key]` items under the thread. */
function mountPage({ hiddenConversation = false } = {}): {
  thread: HTMLElement;
  form: HTMLElement;
} {
  document.body.innerHTML = '';
  document.title = 'Reply OK';
  if (hiddenConversation) {
    // An earlier conversation of the tab, kept under `display: none` with its own composer.
    const stale = document.createElement('div');
    stale.style.display = 'none';
    stale.innerHTML = `
      <div data-turn-key="old"><div data-user-message-bubble="true">old prompt</div>
        <div data-chatgpt-selection-message-id="old-reply"><p>old answer</p></div></div>
      <div data-turn-key="old-pending"><div data-user-message-bubble="true">unanswered</div></div>
      <form><div data-composer-markdown contenteditable="true"></div></form>`;
    document.body.append(stale);
  }
  const thread = document.createElement('main');
  const form = document.createElement('form');
  const composer = rendered(document.createElement('div'));
  composer.setAttribute('data-composer-markdown', '');
  composer.setAttribute('contenteditable', 'true');
  const send = rendered(document.createElement('button'));
  send.type = 'submit';
  send.addEventListener('click', (event) => event.preventDefault());
  form.append(composer, send);
  document.body.append(thread, form);
  return { thread, form };
}

type Page = { thread: HTMLElement; form: HTMLElement };

/** The prompt's bubble renders as soon as it is sent, in its own `[data-turn-key]` item. */
/** The user sends from the composer: the send button, or Enter in the composer. */
function sendPrompt(page: Page, prompt: string, via: 'click' | 'enter' = 'click'): HTMLElement {
  if (via === 'click') page.form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  else
    page.form
      .querySelector('[data-composer-markdown]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return renderPrompt(page.thread, prompt);
}

function renderPrompt(thread: HTMLElement, prompt: string): HTMLElement {
  turnCount += 1;
  const turn = document.createElement('div');
  turn.setAttribute('data-turn-key', `turn-${turnCount}`);
  const bubble = rendered(document.createElement('div'));
  bubble.setAttribute('data-user-message-bubble', 'true');
  bubble.textContent = prompt;
  turn.append(bubble);
  thread.append(turn);
  return turn;
}

/** The reply lands after the bubble, then its action row (sprite icons, localized labels). */
function landReply(turn: HTMLElement, replyText: string, actions = true): void {
  const reply = rendered(document.createElement('div'));
  reply.setAttribute('data-chatgpt-selection-message-id', `reply-${turnCount}`);
  reply.innerHTML = `<p>${replyText}</p>`;
  turn.append(reply);
  if (actions) showActions(turn);
}

function showActions(turn: HTMLElement): void {
  const copy = document.createElement('button');
  copy.setAttribute('aria-label', 'コピーする');
  copy.innerHTML = '<svg><use href="#copy"></use></svg>';
  turn.append(copy);
}

function addTurn(thread: HTMLElement, prompt: string, replyText: string): void {
  landReply(renderPrompt(thread, prompt), replyText);
}

/** The stop control: a plain button with an inline icon and a localized label. */
function showStop(form: HTMLElement, label = '停止'): HTMLButtonElement {
  const stop = rendered(document.createElement('button'));
  stop.type = 'button';
  stop.setAttribute('aria-label', label);
  stop.innerHTML = '<svg><path d=""></path></svg>';
  form.append(stop);
  return stop;
}

function notifyCalls(): Array<{ payload: Record<string, string> }> {
  return (chrome.runtime.sendMessage as unknown as Mock).mock.calls
    .map(([message]) => message as { type?: string; payload: Record<string, string> })
    .filter((message) => message?.type === 'gv.responseComplete.notify');
}

async function settle(ms = 3000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** One generation as measured in a hidden tab: bubble and stop at once, the reply at the end. */
async function generate(page: Page, prompt: string, replyText: string, stopLabel = '停止') {
  const turn = sendPrompt(page, prompt);
  const stop = showStop(page.form, stopLabel);
  await settle(1000);
  landReply(turn, replyText);
  stop.remove();
  await settle();
}

describe('ChatGPT response completion notification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    turnCount = 0;
    window.history.replaceState(null, '', '/c/conv-1');
    (chrome.runtime.sendMessage as unknown as Mock).mockReset();
    (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValue({ ok: true });
    toast.showIfNeeded.mockReset();
    setPageState('hidden', false);
  });

  afterEach(() => {
    stopRun?.();
    stopRun = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('notifies when a reply finishes in a hidden tab', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    await generate(page, 'reply with just OK', 'OK');

    expect(notifyCalls()).toHaveLength(1);
    expect(notifyCalls()[0].payload).toMatchObject({
      conversationTitle: 'Reply OK',
      userPrompt: 'reply with just OK',
      conversationUrl: 'https://chatgpt.com/c/conv-1',
    });
  });

  it('sees a generation under a stop label it does not know', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    await generate(page, 'OK とだけ返して', 'OK', '중지');

    expect(notifyCalls()).toHaveLength(1);
  });

  it('waits for the action row when no known stop label marked the end', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    // The tab was left mid-stream: text so far is on the page, the rest is held back.
    const turn = sendPrompt(page, '長い記事を書いて');
    showStop(page.form, '停止する');
    await settle(1000);
    landReply(turn, 'The first paragraph', false);
    await settle(5000);
    expect(notifyCalls()).toHaveLength(0);

    showActions(turn);
    await settle();
    expect(notifyCalls()).toHaveLength(1);
  });

  it('waits for the action row in a visible window that has lost focus', async () => {
    setPageState('visible', false);
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'reply with just OK');
    const stop = showStop(page.form);
    await settle(1000);
    landReply(turn, 'OK', false);
    stop.remove();
    await settle(5000);
    expect(notifyCalls()).toHaveLength(0);

    showActions(turn);
    await settle();
    expect(notifyCalls()).toHaveLength(1);
  });

  it('stays quiet when the user stops a reply under a stop label it does not know', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, '긴 글을 써 줘');
    const stop = showStop(page.form, '중지');
    await settle(1000);
    // Streaming in view: the reply is on the page before the user presses stop.
    landReply(turn, '첫 문단', false);
    await settle(1000);
    stop.click();
    showActions(turn);
    await settle(1000);
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('sees a prompt sent with Enter under a stop label it does not know', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'Réponds juste OK', 'enter');
    const stop = showStop(page.form, 'Arrêter');
    await settle(1000);
    landReply(turn, 'OK');
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it('does not take a conversation that renders a prompt before its reply on opening', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    // No send from this page: ChatGPT is only drawing history.
    const turn = renderPrompt(page.thread, 'earlier prompt');
    await settle(1000);
    landReply(turn, 'earlier answer');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('cached remote reply identity cannot replace the installed notification protocol', async () => {
    const page = mountPage();
    const adapter = {
      ...chatgptAdapter,
      selectors: { ...chatgptAdapter.selectors, assistantTurn: '[data-redesigned-reply]' },
    };
    stopRun = createChatGptResponseNotificationRun({ adapter });
    await settle(1500);

    const turn = sendPrompt(page, 'reply with just OK');
    const stop = showStop(page.form);
    await settle(1000);
    const reply = rendered(document.createElement('div'));
    reply.setAttribute('data-chatgpt-selection-message-id', 'verified-reply');
    reply.textContent = 'OK';
    turn.append(reply);
    showActions(turn);
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it('notifies for a reply that finishes before the next check runs', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'reply with just OK');
    const stop = showStop(page.form);
    // One mutation callback, no timer: a hidden tab's checks wait at least a second.
    await Promise.resolve();
    landReply(turn, 'OK');
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it('never notifies for history that was already on the page', async () => {
    const page = mountPage();
    addTurn(page.thread, 'earlier prompt', 'earlier answer');
    stopRun = createChatGptResponseNotificationRun();
    await settle(5000);

    expect(notifyCalls()).toHaveLength(0);
  });

  it('does not announce the previous reply again when a generation adds none', async () => {
    const page = mountPage();
    addTurn(page.thread, 'earlier prompt', 'earlier answer');
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const stop = showStop(page.form);
    await settle(1000);
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('notifies for each of two identical replies', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    await generate(page, 'reply with just OK', 'OK');
    await generate(page, 'reply with just OK', 'OK');

    expect(notifyCalls()).toHaveLength(2);
  });

  it('ignores the stop control of an earlier conversation hidden in the tab', async () => {
    const page = mountPage({ hiddenConversation: true });
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const staleForm = document.querySelector('div[style] form') as HTMLElement;
    const staleStop = document.createElement('button');
    staleStop.setAttribute('aria-label', '停止');
    staleForm.append(staleStop);
    await settle(1000);
    addTurn(page.thread, 'unrelated', 'not a new generation');
    staleStop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('stays quiet when the user stops the reply', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'write a long essay');
    const stop = showStop(page.form);
    await settle(1000);
    landReply(turn, 'A partial');
    stop.click();
    // ChatGPT keeps the control a moment after the click.
    await settle(1000);
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('still notifies when the user opens the work-mode project picker during a reply', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const project = rendered(document.createElement('button'));
    project.type = 'button';
    project.innerHTML = '<svg><path d=""></path></svg>选择项目';
    page.form.append(project);
    const turn = sendPrompt(page, 'reply with just OK');
    const stop = showStop(page.form);
    await settle(1000);
    project.click();
    landReply(turn, 'OK');
    stop.remove();
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it('a prompt sent right after stop is not silenced', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'write a long essay');
    const stop = showStop(page.form);
    await settle(1000);
    landReply(turn, 'A partial');
    stop.click();
    await settle(1000);
    stop.remove();
    // Sent before the next check sees the stop control gone.
    await settle(100);
    await generate(page, 'reply with just OK', 'OK');

    expect(notifyCalls()).toHaveLength(1);
    expect(notifyCalls()[0].payload.userPrompt).toBe('reply with just OK');
  });

  it('an Enter that sends nothing after stop does not announce the stopped reply', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'write a long essay');
    const stop = showStop(page.form);
    await settle(1000);
    landReply(turn, 'A partial');
    stop.click();
    await settle(1000);
    stop.remove();
    await settle(100);
    page.form
      .querySelector('[data-composer-markdown]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('a deferred fallback toast does not fire once the next generation has started', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);
    let answer!: (response: { ok: boolean }) => void;
    (chrome.runtime.sendMessage as unknown as Mock).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await generate(page, 'first question', 'First answer');
    expect(notifyCalls()).toHaveLength(1);

    // Back before the background answered, so no focus event follows the failed answer.
    setPageState('visible', true);
    answer({ ok: false });
    await settle(10);
    const turn = sendPrompt(page, 'second question');
    const stop = showStop(page.form);
    await settle(1000);
    // Away and back while the second reply is still being written.
    window.dispatchEvent(new Event('focus'));
    expect(toast.showIfNeeded).not.toHaveBeenCalled();

    landReply(turn, 'Second answer');
    stop.remove();
    await settle();
    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
    expect(toast.showIfNeeded).toHaveBeenCalledWith(
      turn.querySelector('[data-chatgpt-selection-message-id]'),
    );
  });

  it('keeps a new chat’s generation while ChatGPT assigns its address', async () => {
    window.history.replaceState(null, '', '/');
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const turn = sendPrompt(page, 'reply with just OK');
    const stop = showStop(page.form);
    await settle(1000);
    window.history.replaceState(null, '', '/c/local-chatgpt%3A1234');
    await settle(1000);
    // The server's id can arrive with the reply itself, after the stop control has gone.
    landReply(turn, 'OK');
    stop.remove();
    window.history.replaceState(null, '', '/c/real-id');
    await settle();

    expect(notifyCalls()).toHaveLength(1);
  });

  it('drops a generation when the page moves to another conversation', async () => {
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    const stop = showStop(page.form);
    await settle(1000);
    stop.remove();
    window.history.replaceState(null, '', '/c/conv-2');
    addTurn(page.thread, 'old question in conv-2', 'old answer in conv-2');
    await settle();

    expect(notifyCalls()).toHaveLength(0);
  });

  it('shows no system notification while the user is looking at the tab', async () => {
    setPageState('visible', true);
    const page = mountPage();
    stopRun = createChatGptResponseNotificationRun();
    await settle(1500);

    await generate(page, 'reply with just OK', 'OK');

    expect(notifyCalls()).toHaveLength(0);
    expect(toast.showIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('stops watching once aborted', async () => {
    const page = mountPage();
    const controller = new AbortController();
    createChatGptResponseNotificationRun({ signal: controller.signal });
    await settle(1500);
    controller.abort();

    await generate(page, 'reply with just OK', 'OK');

    expect(notifyCalls()).toHaveLength(0);
  });
});
