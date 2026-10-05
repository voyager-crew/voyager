import React, { act } from 'react';
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

// Keep Popup and its settings components/hooks real; replace only browser APIs.
vi.mock('webextension-polyfill', () => ({ default: extensionApi }));

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

describe('Popup settings integration', () => {
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };

  it('hydrates the badge inside General Options and toggles only local preferences', async () => {
    await mount();
    const generalHeading = Array.from(container.querySelectorAll('h3')).find(
      (heading) => heading.textContent === TRANSLATIONS.en.generalOptions,
    );
    expect(generalHeading).toBeDefined();
    const generalCard = generalHeading!.parentElement!;
    const badge = generalCard.querySelector<HTMLInputElement>('#changelog-notify-badge');
    expect(badge).not.toBeNull();
    expect(container.querySelectorAll('#changelog-notify-badge')).toHaveLength(1);
    expect(badge!.checked).toBe(true);
    expect(badge!.disabled).toBe(false);
    expect(generalCard.textContent).toContain(TRANSLATIONS.en.changelog_badge_mode_hint);

    extensionApi.storage.local.set.mockClear();
    extensionApi.storage.sync.set.mockClear();
    await act(async () => badge!.click());
    expect(badge!.checked).toBe(false);
    expect(extensionApi.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'popup',
    });
    expect(local[StorageKeys.CHANGELOG_DISMISSED_VERSION]).toBe('1.8.2');

    await act(async () => badge!.click());
    expect(badge!.checked).toBe(true);
    expect(extensionApi.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'badge',
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: '',
    });
    expect(extensionApi.storage.local.set).toHaveBeenCalledTimes(2);
    expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
    expect(
      extensionApi.storage.local.get.mock.calls.filter(
        ([key]) => key === StorageKeys.CHANGELOG_NOTIFY_MODE,
      ),
    ).toHaveLength(1);
  });

  it('hydrates General from one bulk read and keeps that read stable after a setting changes', async () => {
    await mount();
    const generalReads = () =>
      extensionApi.storage.sync.get.mock.calls.filter(
        ([keys]) =>
          keys && typeof keys === 'object' && Object.hasOwn(keys, StorageKeys.MERMAID_ENABLED),
      );
    expect(generalReads()).toHaveLength(1);
    expect(generalReads()[0][0]).toMatchObject({
      [StorageKeys.MERMAID_ENABLED]: true,
      [StorageKeys.HIGHLIGHT_ENABLED]: false,
      [StorageKeys.WAVEDROM_ENABLED]: true,
      [StorageKeys.ECHARTS_ENABLED]: true,
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
    });
    const mermaid = container.querySelector<HTMLInputElement>('#mermaid-enabled')!;
    expect(mermaid.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('#highlights-enabled')!.checked).toBe(false);
    expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();

    await act(async () => mermaid.click());
    expect(mermaid.checked).toBe(true);
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.MERMAID_ENABLED]: true,
    });
    expect(generalReads()).toHaveLength(1);
  });
  it('limits AI Studio to supported controls and writes isolation only for that platform', async () => {
    extensionApi.tabs.query.mockResolvedValue([
      { id: 8, url: 'https://aistudio.google.com/prompts/new_chat' },
    ]);
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = false;
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO] = true;
    await mount();
    expect(container.querySelector('#aistudio-enabled')).not.toBeNull();
    expect(container.querySelector('#aistudio-enter-send')).not.toBeNull();
    expect(container.querySelector('#folder-enabled')).not.toBeNull();
    expect(container.querySelector('#hide-container')).toBeNull();
    expect(container.querySelector('#input-vim-mode')).toBeNull();
    expect(container.querySelector('#mermaid-enabled')).toBeNull();
    expect(container.querySelector('#changelog-notify-badge')).not.toBeNull();
    const isolation = container.querySelector<HTMLInputElement>('#account-isolation-enabled')!;
    expect(isolation.checked).toBe(true);
    await act(async () => isolation.click());
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: false,
    });
    expect(sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]).toBe(false);
  });

  it('shows shared prompts on plugin sites and unlocks effects after enabling site coverage', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: 'https://claude.ai/new' }]);
    await mount();
    const enablePrompts = container.querySelector<HTMLInputElement>(
      '#prompt-manager-site-enabled',
    )!;
    expect(enablePrompts.checked).toBe(false);
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('#folder-enabled')).toBeNull();
    expect(container.querySelector('#mermaid-enabled')).toBeNull();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    await act(async () => enablePrompts.click());
    expect(enablePrompts.checked).toBe(true);
    expect(sync[StorageKeys.PROMPT_CUSTOM_WEBSITES]).toEqual(['claude.ai']);
    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://*.claude.ai/*', 'http://*.claude.ai/*'],
    });
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(4);
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
  });

  it('reaches local plugins from a Gemini tab without any catalog request', async () => {
    local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      'local.me.gemini-tweak': {
        manifest: {
          id: 'local.me.gemini-tweak',
          name: 'My Gemini tweak',
          version: '1.0.0',
          description: 'd',
          author: 'me',
          category: 'layout',
          license: 'MIT',
          engine: '>=1.0.0',
          tier: 'declarative',
          matches: ['https://gemini.google.com/*'],
          contributes: { styles: [{ css: '.gv-x{color:red}' }] },
        },
        importedAt: 1,
        updatedAt: 1,
      },
    };
    await mount();
    // The page targets a local plugin, so the entry opens with its toggle and the import card.
    expect(container.textContent).toContain('My Gemini tweak');
    expect(container.textContent).toContain(TRANSLATIONS.en.localPluginsTitle);
    expect(container.querySelector('#folder-enabled')).not.toBeNull();
    const messageTypes = extensionApi.runtime.sendMessage.mock.calls.map(
      ([message]) => (message as { type?: string } | undefined)?.type ?? '',
    );
    expect(messageTypes).not.toContain(PLUGIN_CATALOG_REFRESH_MESSAGE);
  });

  it('keeps the native local plugins entry off plugin sites, which have their own plugin page', async () => {
    await mount();
    expect(container.textContent).toContain(TRANSLATIONS.en.localPluginsNativeHint);
    await act(async () => root.unmount());
    root = createRoot(container);
    extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: 'https://claude.ai/new' }]);
    await mount();
    expect(container.textContent).not.toContain(TRANSLATIONS.en.localPluginsNativeHint);
    expect(container.textContent).toContain(TRANSLATIONS.en.localPluginsTitle);
  });

  it('reaches starred history from a timeline plugin site, even after a remembered native search', async () => {
    const shown = (element: Element | null | undefined) =>
      !!element && !element.closest('[hidden]');
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      );
    const starredHistoryEntry = () => button(TRANSLATIONS.en.viewStarredHistory);
    const remount = async (url: string) => {
      await act(async () => root.unmount());
      root = createRoot(container);
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url }]);
      await mount();
    };
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    expect(shown(starredHistoryEntry())).toBe(true);
    // The ChatGPT timeline plugin declares no container setting, so the card does not offer one.
    expect(shown(container.querySelector('#hide-container'))).toBe(false);
    await act(async () => starredHistoryEntry()!.click());
    expect(container.textContent).not.toContain(TRANSLATIONS.en.timelineOptions);

    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'Mermaid';
    await remount('https://chatgpt.com/c/abc');
    expect(shown(starredHistoryEntry())).toBe(true);

    await remount('https://example.com/');
    expect(starredHistoryEntry()).toBeUndefined();
  });

  describe('the timeline card on a ChatGPT tab', () => {
    const PLUGIN_ID = 'voyager.chatgpt-timeline';
    const shownButton = (label: string) =>
      [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label && !candidate.closest('[hidden]'),
      );
    const chatGptTimelineSettings = () =>
      (
        local[StorageKeys.PLUGINS_STATE] as Record<string, { settings?: Record<string, unknown> }>
      )?.[PLUGIN_ID]?.settings;

    beforeEach(() => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    });

    it('changing the timeline style changes the ChatGPT rail, not Gemini’s', async () => {
      await mount();

      await act(async () => shownButton(TRANSLATIONS.en.timelineStyleCompact)!.click());

      expect(chatGptTimelineSettings()).toEqual(
        expect.objectContaining({ timelineStyle: 'compact' }),
      );
      expect(sync).not.toHaveProperty(StorageKeys.TIMELINE_STYLE);
    });

    it('turning on node levels puts the ChatGPT rail back on dots', async () => {
      local[StorageKeys.PLUGINS_STATE] = {
        [PLUGIN_ID]: { enabled: true, installedAt: 1, settings: { timelineStyle: 'compact' } },
      };
      await mount();
      const levels = container.querySelector<HTMLInputElement>('#marker-level-enabled')!;
      expect(levels.closest('[hidden]')).toBeNull();
      expect(levels.checked).toBe(false);

      await act(async () => levels.click());

      expect(levels.checked).toBe(true);
      expect(chatGptTimelineSettings()).toEqual({ timelineStyle: 'dots', markerLevel: true });
      expect(sync).not.toHaveProperty('geminiTimelineMarkerLevel');
    });

    it('the timeline card edits the timeline that is actually running on the page', async () => {
      const IMPORTED_ID = 'local.me.chatgpt-rail';
      local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
        [IMPORTED_ID]: {
          importedAt: 1,
          updatedAt: 1,
          manifest: {
            id: IMPORTED_ID,
            name: 'My ChatGPT rail',
            version: '1.0.0',
            description: 'A timeline for ChatGPT',
            author: 'Me',
            category: 'productivity',
            license: 'MIT',
            engine: '>=1.6.0',
            tier: 'declarative',
            matches: ['https://chatgpt.com/*'],
            contributes: {
              settings: {
                timelineStyle: {
                  type: 'select',
                  label: 'Timeline style',
                  default: 'dots',
                  options: [
                    { value: 'dots', label: 'Nodes' },
                    { value: 'compact', label: 'Compact' },
                  ],
                },
              },
              domOps: [{ op: 'native', target: 'body', handler: 'turnNavigator', params: {} }],
            },
          },
        },
      };
      local[StorageKeys.PLUGINS_STATE] = {
        [PLUGIN_ID]: { enabled: false, installedAt: 1 },
        [IMPORTED_ID]: { enabled: true, installedAt: 1 },
      };
      await mount();

      await act(async () => shownButton(TRANSLATIONS.en.timelineStyleCompact)!.click());

      const state = local[StorageKeys.PLUGINS_STATE] as Record<
        string,
        { settings?: Record<string, unknown> }
      >;
      expect(state[IMPORTED_ID]?.settings).toEqual(
        expect.objectContaining({ timelineStyle: 'compact' }),
      );
      expect(state[PLUGIN_ID]?.settings).toBeUndefined();
    });

    it('resetting the position moves the ChatGPT rail home and leaves Gemini’s where it is', async () => {
      const placed = { version: 2, topPercent: 30, leftPercent: 80 };
      sync['gvTimeline:chatgpt:Position'] = placed;
      sync[StorageKeys.TIMELINE_POSITION] = placed;
      await mount();

      await act(async () => shownButton(TRANSLATIONS.en.resetTimelinePosition)!.click());

      expect(sync['gvTimeline:chatgpt:Position']).toBeNull();
      expect(sync[StorageKeys.TIMELINE_POSITION]).toEqual(placed);
    });
  });

  it('a timeline plugin site lets the user switch off the shortcuts its rail responds to', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    const toggle = container.querySelector<HTMLInputElement>('#shortcuts-enabled');
    expect(toggle && !toggle.closest('[hidden]')).toBeTruthy();

    await act(async () => toggle!.click());

    expect(sync[StorageKeys.TIMELINE_SHORTCUTS]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('shows ChatGPT Cloud Sync while keeping Gemini folders and isolation off the tab', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    local[StorageKeys.FOLDER_DATA] = { folders: [], folderContents: {} };
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = true;
    await mount();
    expect(container.querySelector('#prompt-manager-site-enabled')).not.toBeNull();
    expect(container.textContent).toContain(TRANSLATIONS.en.cloudSync);
    // Flex order, then DOM order, decides what the user sees first.
    const promptCard = container
      .querySelector('#prompt-manager-site-enabled')!
      .closest('[style*="order"]')!;
    const blocks = Array.from(promptCard.parentElement!.children) as HTMLElement[];
    const shownBefore = (a: HTMLElement, b: HTMLElement) =>
      Number(a.style.order || 0) < Number(b.style.order || 0) ||
      (a.style.order === b.style.order && blocks.indexOf(a) < blocks.indexOf(b));
    const syncBlock = blocks.find(
      (block) => block !== promptCard && block.textContent?.includes(TRANSLATIONS.en.cloudSync),
    )!;
    const pluginList = blocks.find((block) => block.style.order === '-1')!;
    expect(shownBefore(syncBlock, promptCard as HTMLElement)).toBe(true);
    expect(shownBefore(syncBlock, pluginList)).toBe(true);
    expect(container.querySelector('#account-isolation-enabled')).toBeNull();
    expect(container.querySelector('#folder-enabled')).toBeNull();
    const requestedLocalKeys = extensionApi.storage.local.get.mock.calls.flatMap(([keys]) =>
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {}),
    );
    expect(requestedLocalKeys).not.toContain(StorageKeys.FOLDER_DATA);
    const messageTypes = extensionApi.runtime.sendMessage.mock.calls.map(
      ([message]) => (message as { type?: string } | undefined)?.type,
    );
    expect(messageTypes).not.toContain('gv.sync.upload');
    expect(messageTypes).not.toContain('gv.sync.download');
    expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
  });

  it('retains dependent input settings when search hides and then restores their card', async () => {
    await mount();
    await act(async () =>
      container.querySelector<HTMLInputElement>('#input-collapse-enabled')!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLInputElement>('#input-collapse-when-not-empty')!.click(),
    );
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        TRANSLATIONS.en.enableMermaidRendering,
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('#input-collapse-enabled')).toBeNull();
    expect(container.querySelector('#mermaid-enabled')).not.toBeNull();
    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === TRANSLATIONS.en.popupSettingsSearchClear,
    )!;
    await act(async () => clear.click());
    expect(container.querySelector<HTMLInputElement>('#input-collapse-enabled')!.checked).toBe(
      true,
    );
    expect(
      container.querySelector<HTMLInputElement>('#input-collapse-when-not-empty')!.checked,
    ).toBe(true);
    const bulkReads = extensionApi.storage.sync.get.mock.calls.filter(
      ([keys]) =>
        keys && typeof keys === 'object' && Object.hasOwn(keys, StorageKeys.MERMAID_ENABLED),
    );
    expect(bulkReads).toHaveLength(1);
  });

  it('keeps ChatGPT Cloud Sync visible when a remembered native search has no clear control', async () => {
    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'Mermaid';
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe(
      'Mermaid',
    );
    expect(container.querySelector('#mermaid-enabled')).not.toBeNull();
    expect(container.textContent).not.toContain(TRANSLATIONS.en.cloudSync);

    await act(async () => root.unmount());
    root = createRoot(container);
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(
      container.querySelector(`button[aria-label="${TRANSLATIONS.en.popupSettingsSearchClear}"]`),
    ).toBeNull();
    expect(container.querySelector('#prompt-manager-site-enabled')).not.toBeNull();
    expect(container.textContent).toContain(TRANSLATIONS.en.cloudSync);
    expect(container.querySelector('#mermaid-enabled')).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    extensionApi.tabs.query.mockResolvedValue([{ id: 7, url: 'https://gemini.google.com/app' }]);
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe(
      'Mermaid',
    );
    expect(container.textContent).not.toContain(TRANSLATIONS.en.cloudSync);
    const clear = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${TRANSLATIONS.en.popupSettingsSearchClear}"]`,
    )!;
    await act(async () => clear.click());
    expect(container.textContent).toContain(TRANSLATIONS.en.cloudSync);
    expect(local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]).toBe('');
  });
});
