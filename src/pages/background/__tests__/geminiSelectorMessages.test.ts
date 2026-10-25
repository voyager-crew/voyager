import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  HOST,
  cacheEntry,
  deferred,
  jsonResponse,
  memoryStorage,
} from '@/features/geminiSelectorFixes/__tests__/testKit';
import { geminiSelectorCacheKey } from '@/features/geminiSelectorFixes/cache';
import {
  GEMINI_SELECTOR_REFRESH_MESSAGE,
  GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
  GEMINI_SELECTOR_STATUS_MESSAGE,
} from '@/features/geminiSelectorFixes/messages';
import { GeminiSelectorRefresher } from '@/features/geminiSelectorFixes/refresh';

import {
  handleGeminiSelectorMessage,
  startGeminiSelectorBackgroundService,
} from '../geminiSelectorMessages';

function setup(enabled = true) {
  const boundary = memoryStorage({ [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: enabled });
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse());
  const owner = new GeminiSelectorRefresher({
    storage: boundary.storage,
    fetchImpl,
    bundledRevision: 10,
  });
  const resolveTab = vi.fn(async () => ({ url: `https://${HOST}/u/2/app/chat` }));
  return { ...boundary, fetchImpl, owner, resolveTab };
}

function content(url = `https://${HOST}/u/2/app/chat`): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id, url, frameId: 0 };
}

function popup(): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id, url: chrome.runtime.getURL('src/pages/popup/index.html') };
}

describe('Gemini selector message authorization', () => {
  it('allows the actual Gemini content page to request an automatic check', async () => {
    const state = setup();
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, force: false },
        content(),
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ result: 'updated' });
    expect(state.fetchImpl).toHaveBeenCalledOnce();
    expect(state.resolveTab).not.toHaveBeenCalled();
  });

  it.each([
    { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, enabled: true },
    { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, force: true },
    { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, force: false, tabId: 7 },
    { type: GEMINI_SELECTOR_STATUS_MESSAGE, host: HOST },
  ])(
    'refuses content-side consent, manual bypass, and spoofed tab identity: $type',
    async (request) => {
      const state = setup(false);
      expect(
        await handleGeminiSelectorMessage(request, content(), state.owner, state.resolveTab),
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(false);
      expect(state.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    content('https://aistudio.google.com/prompts/1'),
    content('https://gemini.google.com.evil.test/app'),
    { ...content(), id: 'another-extension' },
    { ...content(), frameId: 1 },
  ])('refuses another host, extension, or frame', async (sender) => {
    const state = setup();
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(state.fetchImpl).not.toHaveBeenCalled();
  });

  it('allows popup automatic and manual checks only after resolving the source tab', async () => {
    const state = setup(false);
    const sender = popup();
    await handleGeminiSelectorMessage(
      { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, tabId: 7, enabled: true },
      sender,
      state.owner,
      state.resolveTab,
    );
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(true);
    expect(state.fetchImpl).not.toHaveBeenCalled();
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, tabId: 7, force: false },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ result: 'updated' });
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, tabId: 7, force: true },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ result: 'upToDate' });
    expect(state.resolveTab).toHaveBeenCalledWith(7);
    expect(state.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('admits the existing options fallback with its original sourceTabId', async () => {
    const state = setup(false);
    const url = chrome.runtime.getURL('src/pages/options/index.html?sourceTabId=7');
    const sender = {
      id: chrome.runtime.id,
      url,
      tab: { id: 90, url },
    } as chrome.runtime.MessageSender;
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, tabId: 7, enabled: true },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ ok: true, enabled: true });
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(true);
  });

  it('refuses a stale source tab after it navigates away and never substitutes the active tab', async () => {
    const state = setup(false);
    state.resolveTab.mockResolvedValue({ url: 'https://claude.ai/new' });
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, tabId: 7, enabled: true },
        popup(),
        state.owner,
        state.resolveTab,
      ),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(false);
    expect(state.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not grant settings authority to a web page framing the extension options URL', async () => {
    const state = setup(false);
    const sender = {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL('src/pages/options/index.html?sourceTabId=7'),
      tab: { id: 7, url: `https://${HOST}/app` },
    } as chrome.runtime.MessageSender;
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, tabId: 7, enabled: true },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(false);
  });

  it('lets the user turn Gemini fixes off from any tab', async () => {
    const state = setup(true);
    state.values[geminiSelectorCacheKey(HOST)] = cacheEntry();
    state.resolveTab.mockResolvedValue({ url: 'https://claude.ai/new' });
    const sender = popup();
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_STATUS_MESSAGE, host: HOST },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ ok: true, enabled: true });
    expect(
      await handleGeminiSelectorMessage(
        { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, enabled: false },
        sender,
        state.owner,
        state.resolveTab,
      ),
    ).toMatchObject({ ok: true, enabled: false });
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(false);
    expect(state.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
    // Turning back on and checking still need the Gemini tab the popup was opened from.
    for (const request of [
      { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, enabled: true },
      { type: GEMINI_SELECTOR_SET_ENABLED_MESSAGE, host: HOST, enabled: true, tabId: 7 },
      { type: GEMINI_SELECTOR_REFRESH_MESSAGE, host: HOST, force: true, tabId: 7 },
    ]) {
      expect(
        await handleGeminiSelectorMessage(request, sender, state.owner, state.resolveTab),
      ).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(state.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]).toBe(false);
    expect(state.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Gemini selector background service', () => {
  type StorageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => void;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('removes downloaded fixes left behind when a worker died between saving OFF and deleting', async () => {
    const state = setup(false);
    state.values[geminiSelectorCacheKey(HOST)] = cacheEntry();
    const stop = startGeminiSelectorBackgroundService(state.owner);
    await flush();
    expect(state.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
    stop();
  });

  it('keeps downloaded fixes at worker start while the user still has them on', async () => {
    const state = setup(true);
    state.values[geminiSelectorCacheKey(HOST)] = cacheEntry();
    const stop = startGeminiSelectorBackgroundService(state.owner);
    await flush();
    expect(state.values[geminiSelectorCacheKey(HOST)]).toEqual(cacheEntry());
    stop();
  });

  it('does not cancel the check a quick OFF then ON started when the OFF event arrives late', async () => {
    const state = setup(true);
    const addListener = vi.mocked(chrome.storage.onChanged.addListener);
    addListener.mockClear();
    const stop = startGeminiSelectorBackgroundService(state.owner);
    const onStorage = addListener.mock.calls[0][0] as StorageListener;
    const response = deferred<Response>();
    state.fetchImpl.mockImplementation(() => response.promise);
    await state.owner.setEnabled(HOST, false);
    await state.owner.setEnabled(HOST, true);
    const check = state.owner.refresh(HOST, { force: true });
    await flush();
    onStorage(
      { [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: { oldValue: true, newValue: false } },
      'local',
    );
    await flush();
    expect(state.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false);
    response.resolve(jsonResponse());
    expect(await check).toMatchObject({ enabled: true, result: 'updated', cachedRevision: 11 });
    stop();
  });
});
