// @vitest-environment-options { "url": "https://chatgpt.com/c/example#gv-turn-turn-one" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initI18n } from '@/utils/i18n';

import { startChatGptJump } from './index';
import { startChatGptLegacyJumpHint } from './legacyHint';

const userEvents = vi.hoisted(() => new WeakSet<Event>());
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: (event: Event) => userEvents.has(event) }));
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: { get: vi.fn(async () => ({})) },
      local: { get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn() },
    },
    i18n: { getUILanguage: vi.fn(() => 'en') },
  },
}));

let stop: (() => void) | undefined;
function toasts(): NodeListOf<Element> | undefined {
  return document
    .querySelector('[data-gv-layer="toast"]')
    ?.shadowRoot?.querySelectorAll('.gv-toast');
}
/** jsdom marks every script-dispatched event untrusted; fire it as the user's own input. */
function userInput(event: Event): void {
  userEvents.add(event);
  document.body.dispatchEvent(event);
}
function renderTurn(conversationId: string): void {
  document.body.innerHTML = `<div data-turn-key="t"><div data-chatgpt-selection-conversation-id="${conversationId}" data-chatgpt-selection-message-id="m2">Antwort</div></div>`;
}
/** Reports the URL the tab originally loaded, which jsdom does not record. */
function loadedFrom(url: string): void {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { name: url } as PerformanceNavigationTiming,
  ]);
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
  await Promise.resolve();
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/c/example#gv-turn-turn-one');
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('legacy ChatGPT star failure hint', () => {
  it('a saved ChatGPT link that bounces home in any language hints to switch accounts', async () => {
    stop = startChatGptLegacyJumpHint();
    document.body.innerHTML = '<div>无法加载对话</div>';
    await settle();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<main>Accueil</main>';
    await settle();
    expect(toasts()).toHaveLength(1);
    expect(toasts()?.[0]?.textContent).toContain('Switch');
    history.replaceState(null, '', '/c/example#gv-turn-turn-one');
    await settle();
    history.replaceState(null, '', '/');
    await settle();
    expect(toasts()).toHaveLength(1);
    stop();
    expect(document.querySelector('[data-gv-layer="toast"]')).toBeNull();
  });

  it('a saved ChatGPT link that bounced home before Voyager started still hints to switch accounts', async () => {
    loadedFrom('https://chatgpt.com/c/example#gv-turn-turn-one');
    history.replaceState(null, '', '/');
    stop = startChatGptLegacyJumpHint();
    await settle();
    expect(toasts()).toHaveLength(1);
    stop();
    expect(document.querySelector('[data-gv-layer="toast"]')).toBeNull();
  });

  it('ChatGPT home opened directly or from a plain chat link shows no hint', async () => {
    history.replaceState(null, '', '/');
    for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/c/example']) {
      loadedFrom(url);
      stop = startChatGptLegacyJumpHint();
      await settle();
      expect(toasts()).toBeUndefined();
      stop();
    }
  });

  it('opening a saved chat and then clicking New chat shows no hint', async () => {
    stop = startChatGptLegacyJumpHint();
    await settle();
    userInput(new PointerEvent('pointerdown', { bubbles: true }));
    history.pushState(null, '', '/');
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it('a saved chat that loads its turns shows no hint even if the user goes home later', async () => {
    stop = startChatGptLegacyJumpHint();
    renderTurn('example');
    await settle();
    history.pushState(null, '', '/');
    document.body.innerHTML = '<main>Home</main>';
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it("another conversation's turns do not count as the saved chat loading", async () => {
    stop = startChatGptLegacyJumpHint();
    renderTurn('other');
    await settle();
    history.replaceState(null, '', '/');
    await settle();
    expect(toasts()).toHaveLength(1);
  });

  it('going back from a saved chat shows no hint', async () => {
    stop = startChatGptLegacyJumpHint();
    await settle();
    history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it('moving to another conversation stops watching for a bounce', async () => {
    stop = startChatGptLegacyJumpHint();
    history.pushState(null, '', '/c/other');
    await settle();
    history.pushState(null, '', '/');
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it('a direct conversation without a saved-turn link does not show the hint', async () => {
    history.replaceState(null, '', '/c/example');
    stop = startChatGptLegacyJumpHint();
    history.replaceState(null, '', '/');
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it('an unrelated later home navigation cannot reuse an expired saved jump', async () => {
    stop = startChatGptLegacyJumpHint();
    await vi.advanceTimersByTimeAsync(30000);
    history.replaceState(null, '', '/');
    await settle();
    expect(toasts()).toBeUndefined();
  });

  it('page teardown releases the account listener and redirect observers on ChatGPT', async () => {
    stop = startChatGptJump();
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('[data-gv-layer="toast"]')).toBeNull();
  });
});
