import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { loadAllTranslations, loadTranslations, type TranslationKey } from '@/utils/translations';

import { PopupSection } from '../../components/PopupSection';
import {
  NATIVE_POPUP_SECTION_IDS,
  OFFICIAL_PLUGIN_TOPIC_IDS,
  isOfficialPluginTopicId,
} from '../../utils/nativeSiteCapabilities';
import { usePopupSections, type PopupSectionsOptions } from '../usePopupSections';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: vi.fn(), set: vi.fn() } } },
}));

type Sections = ReturnType<typeof usePopupSections>;
const translate = (key: TranslationKey) => en[key];

function Harness({
  capture,
  ...options
}: PopupSectionsOptions & { capture: (sections: Sections) => void }) {
  const sections = usePopupSections(options);
  useEffect(() => capture(sections), [capture, sections]);
  return NATIVE_POPUP_SECTION_IDS.map((id) => (
    <PopupSection
      key={id}
      {...sections.getSectionProps(id, { allowPluginSite: id === 'keyboardShortcuts' })}
    >
      <span data-section={id}>{id}</span>
    </PopupSection>
  ));
}

describe('usePopupSections', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let sections: Sections;
  const writeSyncStorage = vi.fn(async (_payload: Record<string, unknown>) => undefined);
  const capture = (value: Sections) => {
    sections = value;
  };

  async function render(options: Partial<PopupSectionsOptions> = {}) {
    await act(async () => {
      root?.render(
        <Harness
          nativePopupPlatform="gemini"
          isPluginSite={false}
          t={translate}
          writeSyncStorage={writeSyncStorage}
          {...options}
          capture={capture}
        />,
      );
    });
  }

  function section(id: string) {
    return container.querySelector(`[data-section="${id}"]`)?.parentElement;
  }

  async function search(query: string) {
    await act(async () => sections.updateSettingsSearchQuery(query));
    await act(async () => loadAllTranslations());
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
  });

  it('hydrates known slots without writing and keeps one stable bulk-read callback', async () => {
    await render();
    const hydrate = sections.hydrateFromStorage;
    await act(async () =>
      hydrate({
        // Cards that became Plugins rows stay in old saved orders; they hold no slot now.
        [StorageKeys.GV_POPUP_SECTION_ORDER]: [
          'folder',
          'contextSync',
          'formulaCopy',
          'gemsSidebar',
          'nanobanana',
          'timeline',
          'visualEffect',
          'retired',
          17,
          'cloudSync',
        ],
      }),
    );

    const cloudSyncOrder = Number(section('cloudSync')?.style.order);
    expect(section('folder')?.style.order).toBe('0');
    expect(cloudSyncOrder).toBeGreaterThan(0);
    // Local plugins keeps its default slot right after Cloud Sync.
    expect(Number(section('localPlugins')?.style.order)).toBe(cloudSyncOrder + 2);
    expect(section('contextSync')).toBeUndefined();
    expect(section('nanobanana')).toBeUndefined();
    // A topic card takes no slot until it has a row on this tab.
    expect(section('pluginsLayout')).toBeUndefined();
    expect(writeSyncStorage).not.toHaveBeenCalled();

    await render({ nativePopupPlatform: 'aistudio' });
    expect(sections.hydrateFromStorage).toBe(hydrate);
    expect(Number(section('localPlugins')?.style.order)).toBe(cloudSyncOrder + 2);
    expect(browser.storage.local.get).toHaveBeenCalledTimes(1);
  });

  it('moves between visible sections while preserving hidden platform and plugin slots', async () => {
    await render({ nativePopupPlatform: 'aistudio' });
    const initial = NATIVE_POPUP_SECTION_IDS.filter((id) => id !== 'cloudSync' && id !== 'folder');
    const saved = ['folder', ...initial.slice(0, 10), 'cloudSync', ...initial.slice(10)];
    await act(async () =>
      sections.hydrateFromStorage({ [StorageKeys.GV_POPUP_SECTION_ORDER]: saved }),
    );
    // The topic cards have no rows here and the tree indent is hidden on AI Studio;
    // folderSpacing is the visible slot above Cloud Sync.
    expect(saved.slice(8, 13)).toEqual([
      'pluginsInput',
      'pluginsConversations',
      'folderSpacing',
      'cloudSync',
      'folderTreeIndent',
    ]);
    const moveUp = section('cloudSync')?.querySelector<HTMLButtonElement>(
      `button[aria-label="${translate('moveSectionUp')}"]`,
    );
    expect(moveUp).toBeTruthy();
    await act(async () => moveUp?.click());

    const expected = [...saved];
    [expected[10], expected[11]] = [expected[11], expected[10]];
    expect(writeSyncStorage).toHaveBeenLastCalledWith({
      [StorageKeys.GV_POPUP_SECTION_ORDER]: expected,
    });
    expect(section('cloudSync')?.style.order).toBe('20');
    expect(section('folderSpacing')?.style.order).toBe('22');
    expect(section('folderTreeIndent')).toBeUndefined();
    expect(section('pluginsLayout')).toBeUndefined();
    expect(sections.getSectionProps('folderTreeIndent').order).toBe(24);
    expect(sections.getSectionProps('pluginsLayout').order).toBe(4);
  });

  it('puts a section added since the order was saved in its default slot, not at the bottom', async () => {
    await render({ officialPluginTopics: new Set(OFFICIAL_PLUGIN_TOPIC_IDS) });
    // An order saved before the plugin list existed, reversed, still holding the retired
    // 'plugins' slot.
    const saved = [
      ...NATIVE_POPUP_SECTION_IDS.filter((id) => !isOfficialPluginTopicId(id)),
      'plugins',
    ].reverse();
    await act(async () =>
      sections.hydrateFromStorage({ [StorageKeys.GV_POPUP_SECTION_ORDER]: saved }),
    );

    const after = (id: string) => Number(section(id)?.style.order);
    expect(after('pluginsLayout')).toBe(after('localPlugins') + 2);
    expect(after('pluginsConversations')).toBe(after('localPlugins') + 16);
    expect(after('general')).toBe(0);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('puts the topic cards where a saved order kept the single Plugins card', async () => {
    await render({ officialPluginTopics: new Set(OFFICIAL_PLUGIN_TOPIC_IDS) });
    // Someone moved Plugins below their folder options before it was split.
    await act(async () =>
      sections.hydrateFromStorage({
        [StorageKeys.GV_POPUP_SECTION_ORDER]: [
          'cloudSync',
          'folder',
          'officialPlugins',
          'localPlugins',
          'general',
        ],
      }),
    );
    const order = sections.displayedSections;
    const first = order.indexOf('pluginsLayout');
    expect(order.indexOf('folder')).toBeLessThan(first);
    expect(order.slice(first, first + 9)).toEqual([...OFFICIAL_PLUGIN_TOPIC_IDS, 'localPlugins']);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('filters rows, expands matching section titles and restores reordering after clearing', async () => {
    await render();
    await search(translate('enableFolderFloatingModeHint'));
    expect(sections.hasSettingsSearch).toBe(true);
    expect(sections.hasVisibleSearchResults).toBe(true);
    expect(section('folder')).toBeTruthy();
    expect(sections.shouldShowSetting('folder', 'enableFolderFloatingMode')).toBe(true);
    expect(sections.shouldShowSetting('folder', 'enableFolderFeature')).toBe(false);
    expect(container.querySelector('button')).toBeNull();

    await search(translate('folderOptions'));
    expect(sections.shouldShowSetting('folder', 'enableFolderFeature')).toBe(true);
    expect(sections.shouldShowSetting('folder', 'enableFolderFloatingMode')).toBe(true);

    await search('zzzzzzunknownsettingzzzzzz');
    expect(sections.hasVisibleSearchResults).toBe(false);
    expect(container.querySelector('[data-section]')).toBeNull();

    await search('');
    expect(sections.hasSettingsSearch).toBe(false);
    expect(container.querySelector('button')).toBeTruthy();
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: '',
    });
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('keeps unsupported AI Studio settings hidden even when a section title matches', async () => {
    await render({ nativePopupPlatform: 'aistudio' });
    await search(translate('folderOptions'));
    expect(section('folder')).toBeTruthy();
    expect(sections.shouldShowSetting('folder', 'enableFolderFeature')).toBe(true);
    expect(sections.shouldShowSetting('folder', 'enableForkFeature')).toBe(false);

    await search(translate('enableMermaidRendering'));
    expect(sections.shouldShowSetting('general', 'enableMermaidRendering')).toBe(false);
    expect(sections.hasVisibleSearchResults).toBe(false);
  });

  it('requires plugin-site allowance without losing layout slots', async () => {
    await render({ isPluginSite: true });
    expect(section('cloudSync')).toBeUndefined();
    expect(sections.getSectionProps('cloudSync').order).toBe(0);
    expect(section('keyboardShortcuts')).toBeTruthy();
    expect(container.querySelectorAll('[data-section]')).toHaveLength(1);
    expect(container.querySelector('button')).toBeNull();
  });

  it('restores an asynchronous local query and ignores a read completed after unmount', async () => {
    let resolveQuery!: (value: Record<string, unknown>) => void;
    vi.mocked(browser.storage.local.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    await render();
    expect(sections.settingsSearchQuery).toBe('');
    await act(async () =>
      resolveQuery({ [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: 'timeline' }),
    );
    expect(sections.settingsSearchQuery).toBe('timeline');

    await act(async () => root?.unmount());
    root = createRoot(container);
    let resolveLateQuery!: (value: Record<string, unknown>) => void;
    vi.mocked(browser.storage.local.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLateQuery = resolve;
      }),
    );
    await render();
    const lastMountedOutput = sections;
    await act(async () => root?.unmount());
    root = null;
    await act(async () =>
      resolveLateQuery({ [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: 'late query' }),
    );
    expect(sections).toBe(lastMountedOutput);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
