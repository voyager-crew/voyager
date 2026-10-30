import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { startSafariAppLanguageHandoff } from '../safariAppLanguage';

const sendNativeMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    i18n: { getUILanguage: () => 'en-US' },
    runtime: { sendNativeMessage },
  },
}));

let storage: MemoryStorage;

const handedOver = () =>
  sendNativeMessage.mock.calls.map(([, message]) => (message as { language: string }).language);

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', { storage: storage.api });
  sendNativeMessage.mockResolvedValue({ success: true, data: { saved: true } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Safari app language handoff', () => {
  it('gives the Voyager app the chosen language on start and after every change', async () => {
    storage.values.sync.set(StorageKeys.LANGUAGE, 'zh');

    startSafariAppLanguageHandoff();
    await settle();
    storage.external('sync', StorageKeys.LANGUAGE, 'ar');
    await settle();

    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'setAppLanguage',
      language: 'zh',
    });
    expect(handedOver()).toEqual(['zh', 'ar']);
  });

  it('tries again on the next change until the Voyager app has saved the language', async () => {
    storage.values.sync.set(StorageKeys.LANGUAGE, 'ja');
    sendNativeMessage
      .mockRejectedValueOnce(new Error('No native handler'))
      .mockResolvedValueOnce({ success: true, data: { saved: false } });

    startSafariAppLanguageHandoff();
    await settle();
    storage.external('local', StorageKeys.LANGUAGE, 'ja');
    await settle();
    storage.external('sync', StorageKeys.LANGUAGE, 'ja');
    await settle();

    expect(handedOver()).toEqual(['ja', 'ja', 'ja']);
  });
});
