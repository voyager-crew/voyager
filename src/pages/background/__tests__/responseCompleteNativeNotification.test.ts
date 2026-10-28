import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { NATIVE_OPEN_CONVERSATION_MESSAGE } from '@/core/utils/nativeOpenConversation';
import { SAFARI_NATIVE_APP_ID } from '@/core/utils/safariNativeClipboard';

import { createResponseNotifications } from '../responseNotifications';

const api = vi.hoisted(() => ({
  connectNative: vi.fn(),
  sendNativeMessage: vi.fn(async () => ({ success: true })),
  queryTabs: vi.fn(),
  updateTab: vi.fn(async () => ({ windowId: 8 })),
  createTab: vi.fn(async () => ({})),
  updateWindow: vi.fn(async () => ({})),
}));
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { connectNative: api.connectNative, sendNativeMessage: api.sendNativeMessage },
    tabs: { query: api.queryTabs, update: api.updateTab, create: api.createTab },
    windows: { update: api.updateWindow },
  },
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'safari',
  supportsExtensionNotifications: () => false,
}));
vi.mock('../allTranslations', () => ({
  getTranslation: async () => 'Gemini response complete',
}));

function nativePort() {
  const messages: Array<(message: unknown) => void> = [];
  const disconnects: Array<() => void> = [];
  return {
    onMessage: { addListener: (listener: (message: unknown) => void) => messages.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnects.push(listener) },
    message: (value: unknown) => messages.forEach((listener) => listener(value)),
    disconnect: () => disconnects.forEach((listener) => listener()),
  };
}

describe('Safari response notification handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('delivers the exact scoped conversation URL and normalized text to the native app', async () => {
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async () => ({
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: true,
    }));
    const url = 'https://gemini.google.com/u/2/app/abc123?from=notification#answer';
    const notifications = createResponseNotifications();

    await expect(
      notifications.handle(
        {
          type: 'gv.responseComplete.notify',
          payload: {
            conversationUrl: url,
            conversationTitle: 'You said: Scoped chat',
            userPrompt: 'Your prompt:  Explain  this',
          },
        },
        { tab: { id: 42 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ ok: true });

    expect(api.sendNativeMessage).toHaveBeenCalledWith(SAFARI_NATIVE_APP_ID, {
      action: 'deliverNotification',
      id: `gv-response-complete-42-${Date.now()}`,
      title: 'Scoped chat',
      body: 'Gemini response complete: Explain this',
      url,
    });
  });

  it('handles native clicks after setup and reconnects after disconnect without losing the handler', async () => {
    const first = nativePort();
    const second = nativePort();
    api.connectNative.mockReturnValueOnce(first).mockReturnValueOnce(second);
    api.queryTabs.mockResolvedValueOnce([
      { id: 42, url: 'https://gemini.google.com/u/2/app/abc123?old=query' },
    ]);
    const notifications = createResponseNotifications();
    notifications.connectNativeOpenConversationPort();
    expect(api.connectNative).toHaveBeenCalledWith(SAFARI_NATIVE_APP_ID);

    first.message({
      type: NATIVE_OPEN_CONVERSATION_MESSAGE,
      url: 'https://gemini.google.com/u/2/app/abc123?from=notification',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.updateTab).toHaveBeenCalledWith(42, { active: true });
    expect(api.updateWindow).toHaveBeenCalledWith(8, { focused: true });
    expect(api.createTab).not.toHaveBeenCalled();

    first.disconnect();
    await vi.advanceTimersByTimeAsync(999);
    expect(api.connectNative).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.connectNative).toHaveBeenCalledTimes(2);

    api.queryTabs.mockResolvedValueOnce([]);
    const nextUrl = 'https://gemini.google.com/u/3/app/new456?from=notification#answer';
    second.message({ name: NATIVE_OPEN_CONVERSATION_MESSAGE, userInfo: { url: nextUrl } });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.createTab).toHaveBeenCalledWith({ url: nextUrl });
  });
});
