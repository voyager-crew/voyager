// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/test" }
import { type Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeGeminiSelectors } from '@/core/gemini/selectors';
import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import { legacyEnableWrite } from '@/features/plugins/storage/legacySettingBindings';
import { toastDriver } from '@/tests/toastDriver';

import { createGeminiBuiltinStartup } from '../geminiBuiltinStartup';
import { registerBuiltinNativeHandlers } from '../pluginNativeRegistration';
import { activateGeminiResponseNotification } from '../responseNotification/pluginHandler';
import { type LifecycleHarness, installLifecycleHarness } from './lifecycleHarness';

const ID = OFFICIAL_PLUGIN_IDS.geminiResponseNotification;
const ENABLED_KEY = StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED;
const PAGE_OBSERVER_SOURCE = 'gemini-voyager-response-complete-observer';
let harness: LifecycleHarness;
let cleanup: CleanupManager;
let host: PluginHost | null;
let stopSelectors: (() => void) | undefined;

async function flush(): Promise<void> {
  for (let round = 0; round < 60; round++) await Promise.resolve();
}

async function start(): Promise<void> {
  const admission = createOfficialAdmission();
  const startup = createGeminiBuiltinStartup(admission, cleanup);
  await startup.startResponseNotification();
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    doc: document,
    admission,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await flush();
}

function flip(enabled: unknown): void {
  harness.storage.sync.set(ENABLED_KEY, enabled);
  const changes = { [ENABLED_KEY]: { newValue: enabled } };
  harness.emitStorageChange(changes, 'sync');
}

async function setEnabled(enabled: boolean): Promise<void> {
  const write = legacyEnableWrite(ID, enabled);
  await chrome.storage.sync.set(write);
  harness.emitStorageChange(
    Object.fromEntries(Object.entries(write).map(([key, newValue]) => [key, { newValue }])),
    'sync',
  );
  await flush();
}

function mountConversation(email = 'alice@example.com'): HTMLElement {
  document.title = 'Voyager 测试 - Gemini';
  document.body.innerHTML = `<button id="account" aria-label="Google Account: ${email}"></button>
    <main class="conversation-container"></main><rich-textarea contenteditable="true"></rich-textarea>`;
  Object.defineProperties(document.documentElement, {
    scrollHeight: { configurable: true, value: 2200 },
    clientHeight: { configurable: true, value: 500 },
    scrollTop: { configurable: true, value: 0 },
  });
  return document.querySelector<HTMLElement>('main')!;
}

function prompt(thread: HTMLElement, text = 'Voyager 测试 prompt'): void {
  document.querySelector('rich-textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
  const turn = document.createElement('user-query');
  turn.textContent = text;
  thread.append(turn);
}

function reply(thread: HTMLElement): HTMLElement {
  const turn = document.createElement('model-response');
  turn.innerHTML =
    '<article data-author="assistant"><p>Voyager 测试 answer</p><button aria-label="Copy response">Copy</button></article>';
  thread.append(turn);
  const answer = turn.querySelector<HTMLElement>('article')!;
  vi.spyOn(answer, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, window.innerHeight + 100, 500, 100),
  );
  return answer;
}

function networkReply(thread: HTMLElement, requestId: number): HTMLElement {
  prompt(thread);
  observerMessage('request-start', requestId);
  const answer = reply(thread);
  observerMessage('request-complete', requestId);
  return answer;
}

function pageState(visibility: 'hidden' | 'visible', focused: boolean): void {
  vi.mocked(document.hasFocus).mockReturnValue(focused);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
  window.dispatchEvent(new Event('focus'));
}

function navigate(path: string): void {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function observerMessage(type: 'request-start' | 'request-complete', requestId: number): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: {
        source: PAGE_OBSERVER_SOURCE,
        type,
        payload: { requestId, shouldNotify: true, outcome: 'success', pageUrl: location.href },
      },
    }),
  );
}

function completedRequest(requestId: number): void {
  observerMessage('request-start', requestId);
  observerMessage('request-complete', requestId);
}

function notifications(): unknown[] {
  return vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.filter(
      ([message]) => (message as { type?: string })?.type === 'gv.responseComplete.notify',
    );
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/u/0/app/test');
  document.body.innerHTML = '';
  harness = installLifecycleHarness();
  cleanup = new CleanupManager();
  host = null;
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValue({ ok: true });
  // The existing popup opt-in switch remains authoritative over old plugins backups.
  harness.storage.local.set(StorageKeys.PLUGINS_STATE, { [ID]: { enabled: true, installedAt: 1 } });
});

afterEach(async () => {
  host?.stop();
  cleanup.executeCleanups();
  stopSelectors?.();
  stopSelectors = undefined;
  await flush();
  harness.restore();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('response notifications through the registered official plugin', () => {
  it('uses the legacy switch and survives two fresh pages without changing stored plugin state', async () => {
    const storedPlugins = await chrome.storage.local.get(StorageKeys.PLUGINS_STATE);
    for (const page of [1, 2]) {
      const thread = mountConversation();
      await setEnabled(true);
      expect(await chrome.storage.sync.get(ENABLED_KEY)).toEqual({ [ENABLED_KEY]: true });
      await start();
      networkReply(thread, page);
      observerMessage('request-complete', page);
      expect(notifications()).toHaveLength(page);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'gv.responseComplete.notify',
        payload: {
          conversationUrl: 'https://gemini.google.com/u/0/app/test',
          conversationTitle: 'Voyager 测试',
          userPrompt: 'Voyager 测试 prompt',
        },
      });
      host!.stop();
      cleanup.executeCleanups();
      await flush();
      expect(harness.ledger.openListeners()).toEqual([]);
      expect(harness.ledger.openObservers()).toEqual([]);
      expect(harness.ledger.openStorageListeners()).toBe(0);
      expect(harness.ledger.openRuntimeListeners()).toBe(0);
      expect(toastDriver.all()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      completedRequest(50 + page);
      expect(notifications()).toHaveLength(page);
      cleanup = new CleanupManager();
    }
    await setEnabled(false);
    expect(await chrome.storage.sync.get(ENABLED_KEY)).toEqual({ [ENABLED_KEY]: false });
    expect(await chrome.storage.local.get(StorageKeys.PLUGINS_STATE)).toEqual(storedPlugins);
  });

  it('shows a real foreground toast for an off-screen page-detected reply and removes it on disable', async () => {
    const thread = mountConversation();
    await setEnabled(true);
    pageState('visible', true);
    await start();
    prompt(thread);
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop response');
    Object.defineProperty(stop, 'offsetWidth', { value: 100 });
    document.body.append(stop);
    await vi.advanceTimersByTimeAsync(1100);
    const answer = reply(thread);
    const scroll = vi.fn();
    answer.scrollIntoView = scroll;
    stop.remove();
    await vi.advanceTimersByTimeAsync(2200);
    expect(notifications()).toHaveLength(0);
    expect(toastDriver.messages()).toEqual(['responseCompleteForegroundToast']);
    toastDriver.press(toastDriver.all()[0], 'responseCompleteForegroundToast');
    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
    networkReply(thread, 2);
    await vi.advanceTimersByTimeAsync(2200);
    expect(toastDriver.all()).toHaveLength(1);
    await setEnabled(false);
    expect(toastDriver.all()).toEqual([]);
  });

  it.each([
    ['visible', false],
    ['hidden', true],
  ] as const)('notifies when visibility is %s and focus is %s', async (visibility, focused) => {
    const thread = mountConversation();
    await setEnabled(true);
    pageState(visibility, focused);
    await start();
    networkReply(thread, 1);
    await flush();
    expect(notifications()).toHaveLength(1);
    expect(toastDriver.all()).toEqual([]);
  });

  it('cancels a pending permission answer on disable and re-enable; a rejected new delivery falls back once', async () => {
    const thread = mountConversation();
    await setEnabled(true);
    await start();
    let finish!: (answer: { ok: boolean }) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    networkReply(thread, 1);
    await setEnabled(false);
    await setEnabled(true);
    finish({ ok: false });
    await flush();
    pageState('visible', true);
    expect(toastDriver.all()).toEqual([]);
    pageState('hidden', false);
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(
      new Error('Permission unavailable'),
    );
    networkReply(thread, 2);
    await flush();
    pageState('visible', false);
    expect(toastDriver.all()).toEqual([]);
    pageState('visible', true);
    expect(toastDriver.all()).toHaveLength(1);
    window.dispatchEvent(new Event('focus'));
    expect(toastDriver.all()).toHaveLength(1);
    host!.stop();
    await flush();
    expect(toastDriver.all()).toEqual([]);
  });

  it('drops work across conversation/account switches and notifies again after returning', async () => {
    let thread = mountConversation();
    await setEnabled(true);
    await start();
    prompt(thread);
    observerMessage('request-start', 1);
    navigate('/u/0/app/other');
    thread = mountConversation();
    reply(thread);
    observerMessage('request-complete', 1);
    expect(notifications()).toHaveLength(0);
    observerMessage('request-start', 2);
    navigate('/u/1/app/test');
    mountConversation('bob@example.com');
    observerMessage('request-complete', 2);
    expect(notifications()).toHaveLength(0);
    navigate('/u/0/app/test');
    thread = mountConversation();
    networkReply(thread, 3);
    expect(notifications()).toHaveLength(1);

    let finish!: (answer: { ok: boolean }) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    networkReply(thread, 4);
    navigate('/u/0/app/other');
    finish({ ok: false });
    await flush();
    pageState('visible', true);
    expect(toastDriver.all()).toEqual([]);
    pageState('hidden', false);
    navigate('/u/0/app/test');
    networkReply(thread, 5);
    expect(notifications()).toHaveLength(3);
  });

  it.each(['failed', 'rejected'] as const)(
    'uses bundled detection when online data is %s',
    async (mode) => {
      const thread = mountConversation();
      const selectors = initializeGeminiSelectors({
        host: location.host,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => {
          if (mode === 'failed') throw new Error('Catalog unavailable');
          return {
            id: 'gemini',
            catalogRevision: 1,
            locators: { 'turn.assistantWithHosts': ['['] },
          };
        },
      });
      stopSelectors = selectors.stop;
      await selectors.ready;
      await setEnabled(true);
      await start();
      prompt(thread);
      const stop = document.createElement('button');
      stop.setAttribute('aria-label', 'Stop response');
      Object.defineProperty(stop, 'offsetWidth', { value: 100 });
      document.body.append(stop);
      await vi.advanceTimersByTimeAsync(1100);
      reply(thread);
      stop.remove();
      await vi.advanceTimersByTimeAsync(2200);
      expect(notifications()).toHaveLength(1);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ userPrompt: 'Voyager 测试 prompt' }),
        }),
      );
    },
  );

  it('only true enables notifications and the live setting wins', async () => {
    await start();
    for (const [index, value] of [undefined, false, 'true', 1].entries()) {
      flip(value);
      await flush();
      completedRequest(index + 1);
    }
    expect(notifications()).toHaveLength(0);
    flip(true);
    await flush();
    const status = host!.getStatuses().find((entry) => entry.id === ID)?.kind;
    expect(status).toBe('mounted');
    completedRequest(10);
    expect(notifications()).toHaveLength(1);
    flip(false);
    await flush();
    completedRequest(11);
    expect(notifications()).toHaveLength(1);
    flip(true);
    await flush();
    completedRequest(12);
    expect(notifications()).toHaveLength(2);
    host!.stop();
    cleanup.executeCleanups();
    completedRequest(13);
    expect(notifications()).toHaveLength(2);
  });

  it('off drops a pending completion and reopening ignores its late terminal event', async () => {
    harness.storage.sync.set(ENABLED_KEY, true);
    await start();
    observerMessage('request-start', 1);
    flip(false);
    await flush();
    observerMessage('request-complete', 1);
    expect(notifications()).toHaveLength(0);
    flip(true);
    await flush();
    observerMessage('request-complete', 1);
    expect(notifications()).toHaveLength(0);
    completedRequest(2);
    observerMessage('request-complete', 2);
    expect(notifications()).toHaveLength(1);
  });

  it('scope abort stops a run before a slow ledger disposer and its successor notifies alone', async () => {
    await start();
    harness.storage.sync.set(ENABLED_KEY, true);
    const old = new PluginScope();
    activateGeminiResponseNotification(old);
    await flush();
    observerMessage('request-start', 1);
    let finish!: () => void;
    old.effect(() => () => new Promise<void>((resolve) => (finish = resolve)));
    const stopping = old.dispose();
    const newer = new PluginScope();
    try {
      observerMessage('request-complete', 1);
      expect(notifications()).toHaveLength(0);
      activateGeminiResponseNotification(newer);
      await flush();
    } finally {
      finish();
      await stopping;
    }
    try {
      observerMessage('request-complete', 1);
      completedRequest(2);
      expect(notifications()).toHaveLength(1);
    } finally {
      await newer.dispose();
    }
    completedRequest(3);
    expect(notifications()).toHaveLength(1);
  });
});
