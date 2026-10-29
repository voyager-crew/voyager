import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../Popup';

export const en = await loadTranslations('en');

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
  permissions: {
    contains: vi.fn(),
    request: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(),
    onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  notifications: { create: vi.fn() },
  i18n: { getUILanguage: vi.fn(() => 'en'), getMessage: vi.fn((key: string) => key) },
}));

// Keep Popup and its settings components/hooks real; replace only browser APIs.
vi.mock('webextension-polyfill', () => ({ default: extensionApi }));

export { extensionApi };

export const MERMAID_SWITCH = `[data-official-plugin="${OFFICIAL_PLUGIN_IDS.geminiMermaid}"] input`;
export const pluginRow = (id: string) => `[data-official-plugin="${id}"]`;

function readStorage(keys: unknown, stored: Record<string, unknown>): Record<string, unknown> {
  if (typeof keys === 'string') return { [keys]: stored[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, stored[key]]));
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        Object.hasOwn(stored, key) ? stored[key] : fallback,
      ]),
    );
  }
  return { ...stored };
}

export let container: HTMLDivElement;
let root: Root;
export let local: Record<string, unknown>;
export let sync: Record<string, unknown>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('chrome', extensionApi);
  local = {
    [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'badge',
    [StorageKeys.CHANGELOG_DISMISSED_VERSION]: '1.8.2',
  };
  sync = { [StorageKeys.MERMAID_ENABLED]: false };
  for (const [area, stored] of [
    ['local', local],
    ['sync', sync],
  ] as const) {
    extensionApi.storage[area].get.mockImplementation((keys: unknown, callback?: unknown) => {
      const result = readStorage(keys, stored);
      if (typeof callback === 'function') callback(result);
      return Promise.resolve(result);
    });
    extensionApi.storage[area].set.mockImplementation(
      (updates: Record<string, unknown>, callback?: unknown) => {
        Object.assign(stored, updates);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
    );
    extensionApi.storage[area].getBytesInUse.mockResolvedValue(0);
  }
  extensionApi.runtime.getManifest.mockReturnValue({
    version: '1.8.3',
    update_url: 'https://clients2.google.com/service/update2/crx',
  });
  extensionApi.runtime.sendMessage.mockResolvedValue(undefined);
  extensionApi.tabs.query.mockResolvedValue([{ id: 7, url: 'https://gemini.google.com/app' }]);
  extensionApi.tabs.sendMessage.mockResolvedValue(undefined);
  extensionApi.permissions.contains.mockResolvedValue(false);
  extensionApi.permissions.request.mockResolvedValue(true);
  extensionApi.permissions.remove.mockResolvedValue(true);
  extensionApi.permissions.getAll.mockResolvedValue({ origins: [], permissions: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

export async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <LanguageProvider>
        <Popup />
      </LanguageProvider>,
    );
  });
}

/** Unmount the popup so the next `mount` reads the tab and storage afresh. */
export async function unmount(): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(container);
}

// A plugin site's rail options open under its plugin row, as Gemini's timeline row's do.
export async function openRailOptions(name: string): Promise<void> {
  const label = en.pluginRowOptionsFor.replace('{name}', name);
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => button.click());
}
