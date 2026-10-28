import React, { act, useLayoutEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import * as translations from '@/utils/translations';

import type { SettingsSearchItem } from '../../utils/settingsSearch';
import { usePopupSections } from '../usePopupSections';
import { useSettingsSearchMatches } from '../useSettingsSearchMatches';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const en = await translations.loadTranslations('en');
const translate = (key: translations.TranslationKey) => en[key];
const writeSyncStorage = async () => {};
const ITEMS = [
  { id: 'notification', keys: ['responseCompleteNotification'] },
  { id: 'folder', keys: ['folderOptions'] },
] as const satisfies readonly SettingsSearchItem<string>[];

let root: Root;
let container: HTMLDivElement;
let commits: string[];
let sections: ReturnType<typeof usePopupSections> | undefined;

function PopupSearch() {
  const current = usePopupSections({
    nativePopupPlatform: 'gemini',
    isPluginSite: false,
    t: translate,
    writeSyncStorage,
  });
  useLayoutEffect(() => {
    sections = current;
    commits.push(container.textContent ?? '');
  });
  return (
    <>
      {current.shouldShowSetting('folder', 'enableFolderFeature') && (
        <button data-setting="folder">{en.enableFolderFeature}</button>
      )}
      {current.hasSettingsSearch && !current.hasVisibleSearchResults && (
        <p role="status">{en.popupSettingsSearchNoResults}</p>
      )}
    </>
  );
}

function Search({ query }: { query: string }) {
  const { matches, loading } = useSettingsSearchMatches(ITEMS, query);
  useLayoutEffect(() => {
    commits.push(container.textContent ?? '');
  });
  return (
    <>
      {ITEMS.filter(({ id }) => matches.has(id)).map(({ id, keys }) => (
        <button key={id} data-setting={id}>
          {translate(keys[0])}
        </button>
      ))}
      {query.trim() && !loading && matches.size === 0 && (
        <p role="status">{en.popupSettingsSearchNoResults}</p>
      )}
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  commits = [];
  sections = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function updateQuery(query: string): Promise<void> {
  await act(async () => {
    if (!sections) throw new Error('The popup search did not mount');
    sections.updateSettingsSearchQuery(query);
  });
}

it('keeps a saved query in an unloaded language pending until it can match', async () => {
  let japaneseReady = false;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const getLoaded = translations.getLoadedTranslations;
  vi.spyOn(translations, 'getLoadedTranslations').mockImplementation((language) =>
    language === 'ja' && !japaneseReady ? undefined : getLoaded(language),
  );
  const loadAll = translations.loadAllTranslations;
  const ready = pending.then(async () => {
    await loadAll();
    japaneseReady = true;
  });
  vi.spyOn(translations, 'loadAllTranslations').mockReturnValue(ready);
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: 'フォルダオプション',
  });

  await act(async () => root.render(<PopupSearch />));
  expect(sections?.settingsSearchQuery).toBe('フォルダオプション');
  expect(container.querySelector('[data-setting="folder"]')).toBeNull();
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);

  await act(async () => {
    finish();
    await ready;
  });

  expect(container.querySelector('[data-setting="folder"]')).not.toBeNull();
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);
});

it('shows no results for an unknown query only after language loading finishes', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loadAll = translations.loadAllTranslations;
  const ready = pending.then(loadAll);
  vi.spyOn(translations, 'loadAllTranslations').mockReturnValue(ready);
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: 'zzzzzzunknownsettingzzzzzz',
  });

  await act(async () => root.render(<PopupSearch />));
  expect(container.querySelector('[data-setting="folder"]')).toBeNull();
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);

  await act(async () => {
    finish();
    await ready;
  });

  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    en.popupSettingsSearchNoResults,
  );
});

it('keeps matching settings mounted through every commit while typing', async () => {
  await act(async () => root.render(<PopupSearch />));
  const folder = container.querySelector('[data-setting="folder"]');
  expect(folder).not.toBeNull();

  for (const query of ['fol', 'fold', 'folde', 'folder']) {
    await updateQuery(query);
    expect(container.querySelector('[data-setting="folder"]')).toBe(folder);
  }
  await act(async () => translations.loadAllTranslations());

  expect(commits.length).toBeGreaterThan(1);
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);
});

it('reopens a saved matching query without committing a no-results message', async () => {
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: 'folder',
  });
  await act(async () => root.render(<PopupSearch />));
  await act(async () => translations.loadAllTranslations());
  expect(sections?.settingsSearchQuery).toBe('folder');
  expect(container.querySelector('[data-setting="folder"]')).not.toBeNull();
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);
});

it('removes the no-results message in the first commit of a matching query', async () => {
  await act(async () => root.render(<Search query="zzzzzzunknownsettingzzzzzz" />));
  await act(async () => translations.loadAllTranslations());
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    en.popupSettingsSearchNoResults,
  );
  commits = [];

  await act(async () => root.render(<Search query="folder" />));

  expect(container.querySelector('[data-setting="folder"]')).not.toBeNull();
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);
});

it('retains the previous matches until the latest query finishes loading', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loadAll = translations.loadAllTranslations;
  vi.spyOn(translations, 'loadAllTranslations').mockImplementation(async () => {
    await pending;
    await loadAll();
  });

  await act(async () => root.render(<Search query="notif" />));
  expect(container.querySelector('[data-setting="notification"]')).not.toBeNull();
  await act(async () => root.render(<Search query="folder" />));
  expect(container.querySelector('[data-setting="notification"]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();

  await act(async () => {
    finish();
    await pending;
    await loadAll();
  });
  expect(container.querySelector('[data-setting="notification"]')).toBeNull();
  expect(container.querySelector('[data-setting="folder"]')).not.toBeNull();
});

it('falls back to matching loaded languages when another translation chunk fails', async () => {
  vi.spyOn(translations, 'loadAllTranslations').mockRejectedValue(new Error('Chunk unavailable'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  await act(async () => root.render(<Search query="notification" />));
  expect(container.querySelector('[data-setting="notification"]')).not.toBeNull();
  await act(async () => root.render(<Search query="folder" />));
  expect(container.querySelector('[data-setting="notification"]')).toBeNull();
  expect(container.querySelector('[data-setting="folder"]')).not.toBeNull();
  expect(commits.every((text) => !text.includes(en.popupSettingsSearchNoResults))).toBe(true);

  await act(async () => root.render(<Search query="zzzzzzunknownsettingzzzzzz" />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    en.popupSettingsSearchNoResults,
  );
});
