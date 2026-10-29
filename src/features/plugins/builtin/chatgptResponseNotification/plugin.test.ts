// @vitest-environment-options { "url": "https://chatgpt.com/c/voyager-test" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { StorageKeys } from '@/core/types/common';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import { setPluginEnabled } from '@/features/plugins/storage/pluginState';
import {
  type LifecycleHarness,
  installLifecycleHarness,
} from '@/pages/content/__tests__/lifecycleHarness';
import { registerBuiltinNativeHandlers } from '@/pages/content/pluginNativeRegistration';
import { toastDriver } from '@/tests/toastDriver';

import { CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID as ID } from './manifest';

interface Page {
  readonly thread: HTMLElement;
  readonly form: HTMLElement;
  readonly composer: HTMLElement;
}

let harness: LifecycleHarness;
let host: PluginHost | null;
let stopSelectors: (() => void) | undefined;
let turns: number;

async function flush(): Promise<void> {
  for (let round = 0; round < 60; round++) await Promise.resolve();
}

function rendered<T extends HTMLElement>(element: T): T {
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 100 });
  return element;
}

function mountPage(): Page {
  document.title = 'Voyager 测试 - ChatGPT';
  document.body.innerHTML =
    '<main></main><form><div data-composer-markdown contenteditable="true"></div><button type="submit"></button></form>';
  Object.defineProperties(document.documentElement, {
    scrollHeight: { configurable: true, value: 2200 },
    clientHeight: { configurable: true, value: 500 },
    scrollTop: { configurable: true, value: 0 },
  });
  return {
    thread: document.querySelector<HTMLElement>('main')!,
    form: document.querySelector<HTMLElement>('form')!,
    composer: rendered(document.querySelector<HTMLElement>('[data-composer-markdown]')!),
  };
}

function pageState(visibility: 'hidden' | 'visible', focused: boolean): void {
  vi.mocked(document.hasFocus).mockReturnValue(focused);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
  window.dispatchEvent(new Event('focus'));
}

async function flip(enabled: boolean): Promise<void> {
  await setPluginEnabled(ID, enabled);
  const stored = await chrome.storage.local.get(StorageKeys.PLUGINS_STATE);
  harness.emitStorageChange(
    {
      [StorageKeys.PLUGINS_STATE]: { newValue: stored[StorageKeys.PLUGINS_STATE] },
    },
    'local',
  );
  await flush();
}

async function start(): Promise<void> {
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    doc: document,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await flush();
  await vi.advanceTimersByTimeAsync(1100);
}

function begin(page: Page): { turn: HTMLElement; stop: HTMLElement } {
  page.composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const turn = document.createElement('div');
  turn.setAttribute('data-turn-key', `turn-${++turns}`);
  const prompt = rendered(document.createElement('div'));
  prompt.setAttribute('data-user-message-bubble', 'true');
  prompt.textContent = 'Voyager 测试 prompt';
  turn.append(prompt);
  page.thread.append(turn);
  const stop = rendered(document.createElement('button'));
  stop.type = 'button';
  stop.setAttribute('aria-label', '停止');
  stop.innerHTML = '<svg><path d=""></path></svg>';
  page.form.append(stop);
  return { turn, stop };
}

function finish({ turn, stop }: ReturnType<typeof begin>): HTMLElement {
  const reply = rendered(document.createElement('div'));
  reply.setAttribute('data-chatgpt-selection-message-id', `reply-${turns}`);
  reply.textContent = 'Voyager 测试 answer';
  vi.spyOn(reply, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, window.innerHeight + 100, 500, 100),
  );
  const actions = document.createElement('button');
  actions.setAttribute('aria-label', 'コピーする');
  turn.append(reply, actions);
  stop.remove();
  return reply;
}

async function generate(page: Page): Promise<HTMLElement> {
  const generation = begin(page);
  await vi.advanceTimersByTimeAsync(1000);
  const reply = finish(generation);
  await vi.advanceTimersByTimeAsync(2100);
  return reply;
}

function notifications(): unknown[] {
  return runtimeMessageMock().mock.calls.filter(
    ([message]) =>
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'gv.responseComplete.notify',
  );
}

function runtimeMessageMock() {
  const sendMessage: (message: unknown) => Promise<unknown> = chrome.runtime.sendMessage;
  return vi.mocked(sendMessage);
}

function navigate(path: string): void {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/c/voyager-test');
  harness = installLifecycleHarness();
  host = null;
  turns = 0;
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  runtimeMessageMock().mockResolvedValue({ ok: true });
  // Gemini's existing switch must not enable the ChatGPT plugin.
  harness.storage.sync.set(StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED, true);
});

afterEach(async () => {
  host?.stop();
  stopSelectors?.();
  stopSelectors = undefined;
  await flush();
  harness.restore();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('ChatGPT notifications through the registered PluginHost', () => {
  it('uses its plugin setting independently of Gemini, round-trips the stored choice and dedupes', async () => {
    const page = mountPage();
    await start();
    await generate(page);
    expect(notifications()).toHaveLength(0);
    await flip(true);
    const stored = await chrome.storage.local.get(StorageKeys.PLUGINS_STATE);
    expect(stored).toMatchObject({ [StorageKeys.PLUGINS_STATE]: { [ID]: { enabled: true } } });
    await generate(page);
    await vi.advanceTimersByTimeAsync(3000);
    expect(notifications()).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'gv.responseComplete.notify',
      payload: {
        conversationUrl: 'https://chatgpt.com/c/voyager-test',
        conversationTitle: 'Voyager 测试',
        userPrompt: 'Voyager 测试 prompt',
      },
    });
    await flip(false);
    expect(await chrome.storage.local.get(StorageKeys.PLUGINS_STATE)).toMatchObject({
      [StorageKeys.PLUGINS_STATE]: { [ID]: { enabled: false } },
    });
    await generate(page);
    expect(notifications()).toHaveLength(1);
    expect(
      await chrome.storage.sync.get(StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED),
    ).toEqual({
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: true,
    });
    await flip(true);
    await generate(page);
    expect(notifications()).toHaveLength(2);
  });

  it('leaves two fresh pages with no notifications, observers, timers or toast after teardown', async () => {
    await flip(true);
    for (const count of [1, 2]) {
      const page = mountPage();
      await start();
      await generate(page);
      expect(notifications()).toHaveLength(count);
      host!.stop();
      await flush();
      expect(harness.ledger.openListeners()).toEqual([]);
      expect(harness.ledger.openObservers()).toEqual([]);
      expect(harness.ledger.openStorageListeners()).toBe(0);
      expect(harness.ledger.openRuntimeListeners()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(toastDriver.all()).toEqual([]);
      await generate(page);
      expect(notifications()).toHaveLength(count);
    }
  });

  it('shows the real foreground toast, scrolls to the finished reply and removes the next toast on disable', async () => {
    const page = mountPage();
    await flip(true);
    pageState('visible', true);
    await start();
    const reply = await generate(page);
    expect(notifications()).toHaveLength(0);
    expect(toastDriver.messages()).toEqual(['responseCompleteForegroundToast']);
    const scroll = vi.fn();
    reply.scrollIntoView = scroll;
    toastDriver.press(toastDriver.all()[0], 'responseCompleteForegroundToast');
    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
    await generate(page);
    expect(toastDriver.all()).toHaveLength(1);
    await flip(false);
    expect(toastDriver.all()).toEqual([]);
  });

  it('retires pending permission work on unmount, then a rejected delivery falls back only after focus returns', async () => {
    const page = mountPage();
    await flip(true);
    await start();
    let finishPermission!: (answer: { ok: boolean }) => void;
    runtimeMessageMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPermission = resolve;
        }),
    );
    await generate(page);
    await flip(false);
    await flip(true);
    finishPermission({ ok: false });
    await flush();
    pageState('visible', true);
    expect(toastDriver.all()).toEqual([]);
    pageState('hidden', false);
    runtimeMessageMock().mockRejectedValueOnce(new Error('Permission unavailable'));
    await generate(page);
    pageState('visible', false);
    expect(toastDriver.all()).toEqual([]);
    pageState('visible', true);
    expect(toastDriver.all()).toHaveLength(1);
    host!.stop();
    await flush();
    expect(toastDriver.all()).toEqual([]);
  });

  it('drops a pending generation and a late permission answer after navigation, then works on return', async () => {
    let page = mountPage();
    await flip(true);
    await start();
    const pending = begin(page);
    await vi.advanceTimersByTimeAsync(1000);
    navigate('/c/other');
    finish(pending);
    await vi.advanceTimersByTimeAsync(2200);
    expect(notifications()).toHaveLength(0);
    let answer!: (response: { ok: boolean }) => void;
    runtimeMessageMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await generate(page);
    navigate('/');
    page = mountPage();
    answer({ ok: false });
    await flush();
    pageState('visible', true);
    expect(toastDriver.all()).toEqual([]);
    navigate('/c/voyager-test');
    pageState('hidden', false);
    await generate(page);
    expect(notifications()).toHaveLength(2);
  });

  it.each(['failed', 'rejected'] as const)(
    'uses bundled DOM detection when online data is %s',
    async (mode) => {
      const page = mountPage();
      const selectors = initializeSiteSelectors('chatgpt', {
        host: location.host,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => {
          if (mode === 'failed') throw new Error('Catalog unavailable');
          return { id: 'chatgpt', catalogRevision: 1, selectors: { assistantTurn: '[' } };
        },
      });
      stopSelectors = selectors.stop;
      await selectors.ready;
      await flip(true);
      await start();
      await generate(page);
      expect(notifications()).toHaveLength(1);
    },
  );
});
