import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import {
  handlePromptLibraryApplyMessage,
  isPromptLibraryApplyMessage,
} from '@/features/prompt/library/promptLibraryMessages';
import { createPromptLibraryOwner } from '@/features/prompt/library/promptLibraryOwner';
import {
  installLifecycleHarness,
  type LifecycleHarness,
} from '@/pages/content/__tests__/lifecycleHarness';
import { createMemoryStorage, type MemoryStorage } from '@/tests/memoryStorage';
import { installNativeEditingMock } from '@/tests/nativeEditing';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';
import { initI18n } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../../catalog/sites';
import { PluginHost, type PluginHostOptions } from '../../../runtime/PluginHost';
import { loadSitePage, sitePage } from '../../../sources/__tests__/pluginPairFixtures';

export const COVERAGE = StorageKeys.PROMPT_CUSTOM_WEBSITES;
export const ITEMS = StorageKeys.PROMPT_ITEMS;
export const PLUGINS = StorageKeys.PLUGINS_STATE;
export const PROMPTS = [
  {
    id: 'review',
    name: 'Review',
    text: 'Review this change.\nKeep every detail.',
    tags: ['work'],
    createdAt: 7,
    updatedAt: 8,
    pinnedAt: 9,
  },
  { id: 'explain', name: 'Explain', text: 'Explain {{topic}}.', tags: [], createdAt: 6 },
] satisfies PromptItem[];
export const INITIAL_PLUGINS = {
  'voyager.chatgpt-folders': { enabled: false, installedAt: 1 },
  'untouched.plugin': { enabled: true, installedAt: 23, settings: { size: 4 } },
};

export let storage: MemoryStorage;
export let lifecycle: LifecycleHarness;
export const writeClipboard = vi.fn(async (_text: string) => {});
const hosts: PluginHost[] = [];

/** Browser APIs are the only fakes; sources, settings, primitive and panel run for real. */
export function setupAcceptance(): void {
  let restoreEditing: () => void;
  let clipboard: PropertyDescriptor | undefined;

  beforeAll(async () => {
    // Shared language infrastructure has a page lifetime, outside the plugin's ownership.
    const bootstrap = installLifecycleHarness();
    try {
      await initI18n();
    } finally {
      bootstrap.restore();
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
    document.head.replaceChildren();
    document.body.replaceChildren();
    localStorage.clear();
    lifecycle = installLifecycleHarness();
    storage = createMemoryStorage();
    // StorageService retains the area objects created at module load.
    Object.assign(chrome.storage.sync, storage.api.sync);
    Object.assign(chrome.storage.local, storage.api.local);
    Object.assign(chrome.storage.onChanged, storage.api.onChanged);
    storage.values.sync.set(StorageKeys.LANGUAGE, 'en');
    storage.values.sync.set(StorageKeys.PROMPT_INSERT_ON_CLICK, true);
    storage.values.local.set(ITEMS, structuredClone(PROMPTS));
    storage.values.local.set(PLUGINS, structuredClone(INITIAL_PLUGINS));
    storage.values.local.set(StorageKeys.PROMPT_TRIGGER_POSITION, { right: 70, bottom: 90 });
    const owner = createPromptLibraryOwner({ area: chrome.storage.local });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      message: unknown,
      callback?: (response: unknown) => void,
    ) => {
      const result = isPromptLibraryApplyMessage(message)
        ? handlePromptLibraryApplyMessage(message, owner)
        : Promise.resolve({ ok: true, records: [] });
      void result.then((response) => callback?.(response));
      return result;
    }) as typeof chrome.runtime.sendMessage);
    restoreEditing = installNativeEditingMock();
    clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeClipboard.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeClipboard },
    });
    for (const level of ['debug', 'log', 'info', 'warn', 'error'] as const)
      vi.spyOn(console, level).mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const host of hosts.splice(0)) host.stop();
    await vi.advanceTimersByTimeAsync(500);
    restoreEditing();
    vi.restoreAllMocks();
    lifecycle.restore();
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetPageUrl();
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-gv-scheme');
  });
}

export function fixture(site: 'chatgpt' | 'claude', url = sitePage(site).url): void {
  setPageUrl(url);
  loadSitePage(sitePage(site), requireBundledSiteAdapter(site));
}

export function createHost(options: PluginHostOptions = {}): PluginHost {
  const host = new PluginHost({
    url: location.href,
    doc: document,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
    ...options,
  });
  hosts.push(host);
  return host;
}

export const triggers = () => document.querySelectorAll('#gv-pm-trigger');
export const panels = () => document.querySelectorAll('#gv-pm-panel');

export async function openPanel(): Promise<HTMLElement> {
  await vi.waitFor(() => expect(document.querySelectorAll('.gv-pm-item')).toHaveLength(2));
  const trigger = document.querySelector<HTMLButtonElement>('#gv-pm-trigger');
  if (!trigger) throw new Error('Prompt Manager did not mount');
  const panel = document.querySelector<HTMLElement>('#gv-pm-panel');
  if (!panel) throw new Error('Prompt panel did not mount');
  if (panel.classList.contains('gv-hidden')) trigger.click();
  expect(panel.classList.contains('gv-hidden')).toBe(false);
  return panel;
}

export function pressPrompt(name = 'Review'): void {
  const row = [...document.querySelectorAll<HTMLElement>('.gv-pm-item-text')].find((item) =>
    item.textContent?.includes(name),
  );
  if (!row) throw new Error(`Prompt ${name} is not listed`);
  row.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
}

export function composer(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!element) throw new Error('Fixture has no composer');
  return element;
}

export async function stopHost(host: PluginHost): Promise<void> {
  host.stop();
  await vi.advanceTimersByTimeAsync(500);
  expect(triggers()).toHaveLength(0);
  expect(panels()).toHaveLength(0);
}

export function hasKey(keys: unknown, key: string): boolean {
  return (
    keys === key ||
    (Array.isArray(keys) ? keys.includes(key) : !!keys && typeof keys === 'object' && key in keys)
  );
}

/** Hold an external storage read after its snapshot was taken, like a slow browser reply. */
export function holdRead(area: 'sync' | 'local', key: string) {
  const original = chrome.storage[area].get.bind(chrome.storage[area]);
  let arrive: () => void = () => {};
  let release: () => void = () => {};
  const seen = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = true;
  vi.spyOn(chrome.storage[area], 'get').mockImplementation((async (
    keys: string | string[] | Record<string, unknown> | null,
    callback?: (values: Record<string, unknown>) => void,
  ) => {
    const result = await original<Record<string, unknown>>(keys);
    if (pending && hasKey(keys, key)) {
      pending = false;
      arrive();
      await wait;
    }
    callback?.(result);
    return result;
  }) as typeof chrome.storage.sync.get);
  return { seen, release };
}
