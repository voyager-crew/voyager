import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { getTranslation } from '../allTranslations';
import { createResponseNotifications } from '../responseNotifications';

const api = vi.hoisted(() => ({
  createNotification: vi.fn(async () => 'id'),
  syncGet: vi.fn(async () => ({ language: 'ja' })),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    notifications: { create: api.createNotification },
    storage: { sync: { get: api.syncGet } },
    i18n: { getUILanguage: () => 'en-US' },
  },
}));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  supportsExtensionNotifications: () => true,
}));
vi.mock('@/core/utils/notificationsPermission', () => ({
  hasNotificationsPermission: async () => true,
}));
vi.mock('../notificationSiteIcon', () => ({ siteNotificationIcon: async () => null }));
// A worker translation must never reach the content page's dynamic locale loader.
vi.mock('@/utils/translations', () => {
  throw new Error('A service worker cannot load the content-page translations');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: true,
  }));
});

afterEach(() => {
  vi.mocked(chrome.storage.sync.get).mockReset();
});

describe('completion notifications with background translations', () => {
  it('uses the saved Japanese preference through the real notification entry point', async () => {
    const url = 'https://gemini.google.com/app/japanese-notification';

    await expect(
      createResponseNotifications().handle(
        { type: 'gv.responseComplete.notify', payload: { conversationUrl: url } },
        { url, tab: { id: 7, url } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ ok: true });

    expect(api.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'Gemini', message: 'Gemini の回答が完了しました' }),
    );
  });

  it('serves the selected language of primitive messages through static imports', async () => {
    await expect(getTranslation('quoteReplyAction')).resolves.toBe('引用');
  });
});
