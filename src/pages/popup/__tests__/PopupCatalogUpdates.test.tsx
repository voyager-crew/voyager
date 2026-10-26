import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { PLUGIN_CATALOG_REFRESH_MESSAGE } from '@/features/plugins/runtime/messages';
import { TRANSLATIONS } from '@/utils/translations';

import Popup from '../Popup';

const extensionApi = vi.hoisted(() => ({
  storage: {
    sync: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), getBytesInUse: vi.fn() },
    local: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), getBytesInUse: vi.fn() },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: { get: vi.fn(), query: vi.fn(), sendMessage: vi.fn(), create: vi.fn() },
  runtime: {
    id: 'test-extension-id',
    getManifest: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  permissions: { contains: vi.fn(), request: vi.fn() },
  notifications: { create: vi.fn() },
  i18n: { getUILanguage: vi.fn(() => 'en'), getMessage: vi.fn((key: string) => key) },
}));

vi.mock('webextension-polyfill', () => ({ default: extensionApi }));

describe('native popup catalog updates', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.stubGlobal('chrome', extensionApi);
    for (const area of ['sync', 'local'] as const) {
      extensionApi.storage[area].get.mockImplementation((keys: unknown, callback?: unknown) => {
        const data = keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {};
        if (typeof callback === 'function') callback(data);
        return Promise.resolve(data);
      });
      extensionApi.storage[area].set.mockResolvedValue(undefined);
      extensionApi.storage[area].getBytesInUse.mockResolvedValue(0);
    }
    extensionApi.runtime.getManifest.mockReturnValue({ version: '2.2.1' });
    extensionApi.runtime.sendMessage.mockResolvedValue(undefined);
    extensionApi.tabs.sendMessage.mockResolvedValue(undefined);
    extensionApi.permissions.contains.mockResolvedValue(false);
    extensionApi.permissions.request.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ['https://gemini.google.com/u/1/app', true],
    ['https://business.gemini.google/', false],
    ['https://aistudio.google.com/prompts/new_chat', false],
  ] as const)(
    'shares catalog updates only on the supported native host %s',
    async (url, online) => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 7, url }]);
      await act(async () => {
        root.render(
          <LanguageProvider>
            <Popup />
          </LanguageProvider>,
        );
      });

      expect(container.querySelector('#changelog-notify-badge')).not.toBeNull();
      const controls = container.querySelectorAll<HTMLInputElement>(
        `input[aria-label="${TRANSLATIONS.en.pluginsOnlineUpdates}"]`,
      );
      expect(controls).toHaveLength(online ? 1 : 0);
      if (!online) return;
      const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent === TRANSLATIONS.en.pluginsRefresh,
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith({
        type: PLUGIN_CATALOG_REFRESH_MESSAGE,
        payload: { host: 'gemini.google.com', force: true },
      });
      await act(async () => controls[0].click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledWith({
        [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
      });
      expect(button!.disabled).toBe(true);
    },
  );
});
