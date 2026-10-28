import { act } from 'react';

import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_STATUS_MESSAGE,
} from '@/features/plugins/runtime/messages';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import {
  container,
  en,
  extensionApi,
  local,
  MERMAID_SWITCH,
  mount,
  openRailOptions,
  pluginRow,
  sync,
  unmount,
} from './popupHarness';

describe('Popup settings integration', () => {
  it('hydrates the badge inside General Options and toggles only local preferences', async () => {
    await mount();
    const generalHeading = Array.from(container.querySelectorAll('h3')).find(
      (heading) => heading.textContent === en.generalOptions,
    );
    expect(generalHeading).toBeDefined();
    const generalCard = generalHeading!.parentElement!;
    const badge = generalCard.querySelector<HTMLInputElement>('#changelog-notify-badge');
    expect(badge).not.toBeNull();
    expect(container.querySelectorAll('#changelog-notify-badge')).toHaveLength(1);
    expect(badge!.checked).toBe(true);
    expect(badge!.disabled).toBe(false);
    expect(generalCard.textContent).toContain(en.changelog_badge_mode_hint);

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
          keys &&
          typeof keys === 'object' &&
          Object.hasOwn(keys, StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED),
      );
    expect(generalReads()).toHaveLength(1);
    expect(generalReads()[0][0]).toMatchObject({
      [StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED]: true,
      [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true,
    });
    // Highlights and completion notifications are Plugins rows, read from the live snapshot.
    expect(generalReads()[0][0]).not.toHaveProperty(StorageKeys.HIGHLIGHT_ENABLED);
    expect(generalReads()[0][0]).not.toHaveProperty(
      StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED,
    );
    const toolbar = container.querySelector<HTMLInputElement>('#persistent-export-toolbar')!;
    expect(toolbar.checked).toBe(true);
    expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();

    await act(async () => toolbar.click());
    expect(toolbar.checked).toBe(false);
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED]: false,
    });
    expect(generalReads()).toHaveLength(1);
  });

  it('turning the Gemini rail off keeps message timestamps on and writes only the rail switch', async () => {
    sync[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS] = true;
    await mount();
    const toggle = (id: string) =>
      container.querySelector<HTMLInputElement>(`${pluginRow(id)} input[aria-describedby]`)!;
    const rail = toggle(OFFICIAL_PLUGIN_IDS.geminiTimeline);
    const times = toggle(OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps);
    expect(rail.checked).toBe(true);
    extensionApi.storage.sync.set.mockClear();
    await act(async () => rail.click());
    expect(rail.checked).toBe(false);
    expect(times.checked).toBe(true);
    expect(times.disabled).toBe(false);
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.GV_TIMELINE_ENABLED]: false,
    });
  });
  it('limits AI Studio to supported controls and writes isolation only for that platform', async () => {
    extensionApi.tabs.query.mockResolvedValue([
      { id: 8, url: 'https://aistudio.google.com/prompts/new_chat' },
    ]);
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI] = false;
    sync[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO] = true;
    await mount();
    expect(container.querySelector('#aistudio-enabled')).not.toBeNull();
    expect(
      container.querySelector(pluginRow(OFFICIAL_PLUGIN_IDS.aistudioEnterSend)),
    ).not.toBeNull();
    expect(container.querySelector('#folder-enabled')).not.toBeNull();
    expect(container.querySelector('#hide-container')).toBeNull();
    expect(container.querySelector(pluginRow(OFFICIAL_PLUGIN_IDS.geminiVimInput))).toBeNull();
    expect(container.querySelector(MERMAID_SWITCH)).toBeNull();
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
    expect(container.querySelector(MERMAID_SWITCH)).toBeNull();
    const effectsSwitch = () =>
      container.querySelector<HTMLInputElement>(
        `${pluginRow(OFFICIAL_PLUGIN_IDS.visualEffects)} input[aria-describedby]`,
      );
    // No content script runs here yet, so the effect has nothing to run in.
    expect(effectsSwitch()).toBeNull();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    await act(async () => enablePrompts.click());
    expect(enablePrompts.checked).toBe(true);
    expect(sync[StorageKeys.PROMPT_CUSTOM_WEBSITES]).toEqual(['claude.ai']);
    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://*.claude.ai/*', 'http://*.claude.ai/*'],
    });
    expect(effectsSwitch()!.checked).toBe(false);
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    await act(async () => effectsSwitch()!.click());
    expect(sync[StorageKeys.GV_VISUAL_EFFECT]).toBe('snow');
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(3);
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
    expect(container.textContent).toContain(en.localPluginsTitle);
    expect(container.querySelector('#folder-enabled')).not.toBeNull();
    const messageTypes = extensionApi.runtime.sendMessage.mock.calls.map(
      ([message]) => (message as { type?: string } | undefined)?.type ?? '',
    );
    expect(messageTypes).not.toContain(PLUGIN_CATALOG_REFRESH_MESSAGE);
  });

  it('says under formula copy and Vim which local plugin keeps them paused, without listing the official plugins', async () => {
    local[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      'local.me.formula': {
        manifest: {
          id: 'local.me.formula',
          name: 'My formula copy',
          version: '1.0.0',
          description: 'd',
          author: 'me',
          category: 'other',
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
    extensionApi.tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) =>
      (message as { type?: string }).type === PLUGIN_STATUS_MESSAGE
        ? {
            ok: true,
            statuses: [
              {
                id: OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
                version: '1.0.0',
                kind: 'blocked',
                blockedReason: 'conflict',
                blockedBy: 'local.me.formula',
              },
              {
                id: OFFICIAL_PLUGIN_IDS.geminiVimInput,
                version: '1.0.0',
                kind: 'blocked',
                blockedReason: 'releasing',
                blockedBy: OFFICIAL_PLUGIN_IDS.geminiVimInput,
              },
            ],
          }
        : undefined,
    );
    sync[StorageKeys.INPUT_VIM_MODE] = true;
    await mount();

    const formulaRow = container.querySelector(pluginRow(OFFICIAL_PLUGIN_IDS.geminiFormulaCopy))!;
    expect(formulaRow.textContent).toContain(
      en.officialFeaturePausedByLocal.replace('{name}', 'My formula copy'),
    );
    const vimRow = container.querySelector(pluginRow(OFFICIAL_PLUGIN_IDS.geminiVimInput))!;
    expect(vimRow.textContent).toContain(en.pluginBlockedReleasing);
    expect(vimRow.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
    // The official plugins are rows of the Plugins card, not listed as plugins.
    expect(container.querySelector('input[aria-label="My formula copy"]')).not.toBeNull();
    for (const name of [
      'Gemini · Formula Copy',
      'Gemini · Vim Input',
      'Gemini · Hide Input Halo',
    ]) {
      expect(container.querySelector(`input[aria-label="${name}"]`), name).toBeNull();
    }
  });

  it('keeps the native local plugins entry off plugin sites, which have their own plugin page', async () => {
    await mount();
    expect(container.textContent).toContain(en.localPluginsNativeHint);
    await unmount();
    extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: 'https://claude.ai/new' }]);
    await mount();
    expect(container.textContent).not.toContain(en.localPluginsNativeHint);
    expect(container.textContent).toContain(en.localPluginsTitle);
  });

  it('reaches starred history from a timeline plugin site, even after a remembered native search', async () => {
    const shown = (element: Element | null | undefined) =>
      !!element && !element.closest('[hidden]');
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      );
    const starredHistoryEntry = () => button(en.viewStarredHistory);
    const remount = async (url: string) => {
      await unmount();
      extensionApi.tabs.query.mockResolvedValue([{ id: 10, url }]);
      await mount();
    };
    local[StorageKeys.PLUGINS_STATE] = {
      'voyager.chatgpt-timeline': { enabled: true, installedAt: 1 },
    };
    extensionApi.tabs.query.mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/abc' }]);
    await mount();
    // Under the rail's own row, behind Options.
    expect(starredHistoryEntry()).toBeUndefined();
    await openRailOptions('ChatGPT · Timeline');
    expect(shown(starredHistoryEntry())).toBe(true);
    // The ChatGPT timeline plugin declares no container setting, so its options leave it out.
    expect(shown(container.querySelector('#hide-container'))).toBe(false);
    await act(async () => starredHistoryEntry()!.click());
    expect(container.textContent).not.toContain(en.pluginsTitle);

    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'Mermaid';
    await remount('https://chatgpt.com/c/abc');
    await openRailOptions('ChatGPT · Timeline');
    expect(shown(starredHistoryEntry())).toBe(true);

    await remount('https://example.com/');
    expect(starredHistoryEntry()).toBeUndefined();
  });

  it('retains dependent input settings when search hides and then restores their row', async () => {
    await mount();
    const collapseRow = () =>
      container.querySelector(pluginRow(OFFICIAL_PLUGIN_IDS.geminiInputCollapse));
    const collapseSwitch = () =>
      collapseRow()?.querySelector<HTMLInputElement>('input[aria-describedby]') ?? null;
    const whenNotEmpty = () =>
      collapseRow()?.querySelector<HTMLInputElement>(
        `input[aria-label="${en.allowCollapseWhenNotEmpty}"]`,
      ) ?? null;
    await act(async () => collapseSwitch()!.click());
    await act(async () => whenNotEmpty()!.click());
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        en.enableMermaidRendering,
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(collapseRow()).toBeNull();
    expect(container.querySelector(MERMAID_SWITCH)).not.toBeNull();
    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === en.popupSettingsSearchClear,
    )!;
    await act(async () => clear.click());
    expect(collapseSwitch()!.checked).toBe(true);
    expect(whenNotEmpty()!.checked).toBe(true);
    const bulkReads = extensionApi.storage.sync.get.mock.calls.filter(
      ([keys]) =>
        keys &&
        typeof keys === 'object' &&
        Object.hasOwn(keys, StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED),
    );
    expect(bulkReads).toHaveLength(1);
  });
});
