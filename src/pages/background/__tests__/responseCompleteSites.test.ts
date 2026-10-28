import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID } from '@/features/plugins/builtin/chatgptResponseNotification/manifest';

import { createResponseNotifications } from '../responseNotifications';

const api = vi.hoisted(() => ({ createNotification: vi.fn(async () => 'id') }));
vi.mock('webextension-polyfill', () => ({
  default: { notifications: { create: api.createNotification } },
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  supportsExtensionNotifications: () => true,
}));
vi.mock('@/core/utils/notificationsPermission', () => ({
  hasNotificationsPermission: async () => true,
}));
const icon = vi.hoisted(() => ({ draw: vi.fn(async (): Promise<string | null> => null) }));
vi.mock('../notificationSiteIcon', () => ({ siteNotificationIcon: icon.draw }));
vi.mock('../allTranslations', () => ({
  getTranslation: async () => '{site} 思考完成',
}));

function storeSettings({
  geminiSwitch,
  chatgptPlugin,
}: {
  geminiSwitch: boolean;
  chatgptPlugin?: boolean;
}): void {
  vi.mocked(chrome.storage.sync.get).mockImplementation((async () => ({
    [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: geminiSwitch,
  })) as unknown as typeof chrome.storage.sync.get);
  vi.mocked(chrome.storage.local.get).mockImplementation((async () => ({
    [StorageKeys.PLUGINS_STATE]:
      chatgptPlugin === undefined
        ? {}
        : { [CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID]: { enabled: chatgptPlugin } },
  })) as unknown as typeof chrome.storage.local.get);
}

function notifyFrom(url: string) {
  return createResponseNotifications().handle(
    {
      type: 'gv.responseComplete.notify',
      payload: { conversationUrl: url, conversationTitle: 'Reply OK', userPrompt: 'say OK' },
    },
    { url, tab: { id: 7, url } as chrome.tabs.Tab },
  );
}

describe('completion notifications per site', () => {
  beforeEach(() => {
    api.createNotification.mockClear();
  });

  afterEach(() => {
    (chrome.storage.sync.get as unknown as Mock).mockReset();
    (chrome.storage.local.get as unknown as Mock).mockReset();
  });

  it('names ChatGPT in a notification from a ChatGPT tab whose plugin is on', async () => {
    storeSettings({ geminiSwitch: false, chatgptPlugin: true });

    await expect(notifyFrom('https://chatgpt.com/c/abc')).resolves.toEqual({ ok: true });

    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'Reply OK', message: 'ChatGPT 思考完成: say OK' }),
    );
  });

  it('shows only the prompt beside the site logo', async () => {
    storeSettings({ geminiSwitch: false, chatgptPlugin: true });
    icon.draw.mockResolvedValueOnce('data:image/png;base64,TE9HTw==');

    await notifyFrom('https://chatgpt.com/c/abc');

    expect(icon.draw).toHaveBeenCalledWith('chatgpt');
    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ iconUrl: 'data:image/png;base64,TE9HTw==', message: 'say OK' }),
    );
  });

  it('titles an untitled conversation with its site', async () => {
    storeSettings({ geminiSwitch: false, chatgptPlugin: true });
    const url = 'https://chatgpt.com/';

    await createResponseNotifications().handle(
      {
        type: 'gv.responseComplete.notify',
        payload: { conversationUrl: url, conversationTitle: '', userPrompt: 'say OK' },
      },
      { url, tab: { id: 8, url } as chrome.tabs.Tab },
    );

    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'ChatGPT' }),
    );
  });

  it('keeps the Voyager icon where the site mark cannot be drawn', async () => {
    storeSettings({ geminiSwitch: false, chatgptPlugin: true });

    await notifyFrom('https://chatgpt.com/c/abc');

    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ iconUrl: 'chrome-extension://test-extension-id/icon-128.png' }),
    );
  });

  it('shows nothing for ChatGPT while its plugin is off, whatever the Gemini switch says', async () => {
    storeSettings({ geminiSwitch: true, chatgptPlugin: false });

    await expect(notifyFrom('https://chatgpt.com/c/abc')).resolves.toEqual({ ok: false });
    expect(api.createNotification).not.toHaveBeenCalled();
  });

  it('keeps naming Gemini and following its own switch on Gemini', async () => {
    storeSettings({ geminiSwitch: true, chatgptPlugin: false });

    await expect(notifyFrom('https://gemini.google.com/app/abc')).resolves.toEqual({ ok: true });
    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: 'Gemini 思考完成: say OK' }),
    );
  });
});
