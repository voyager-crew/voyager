/**
 * The light/dark switch in the Prompt Manager header.
 *
 * Until the user picks a theme, the panel follows the host page's theme as it
 * changes. The switch saves a fixed light or dark; the popup's theme popover
 * can set it back to `'auto'`. The theme lives on the panel as
 * `data-gv-theme`, which every surface opened from the panel copies.
 */
import browser from 'webextension-polyfill';

import { createMoonIcon, createSunIcon } from '@/core/icons/promptManagerIcons';
import { StorageKeys } from '@/core/types/common';
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';
import type { TranslationKey } from '@/utils/translations';

import { subscribeScheme } from '../platformTheme/scheme';
import { readSyncedChoice, writeSyncedChoice } from './promptPrefs';

const isPromptScheme = (value: unknown): value is PromptScheme =>
  value === 'light' || value === 'dark';

/** Applies the theme to `panel` from the start; `destroy` stops following the page. */
export function createThemeToggle({
  panel,
  t,
  pageScheme,
}: {
  panel: HTMLElement;
  t: (key: TranslationKey) => string;
  /** Reads the host page's scheme, used while no fixed theme is saved. */
  pageScheme: () => PromptScheme;
}): { element: HTMLButtonElement; destroy: () => void } {
  const themeToggle = document.createElement('button');
  themeToggle.className = 'gv-pm-theme-toggle';
  themeToggle.setAttribute('type', 'button');
  let fixedTheme: PromptScheme | null = null;
  let currentTheme = pageScheme();

  function applyTheme(theme: PromptScheme) {
    currentTheme = theme;
    panel.setAttribute('data-gv-theme', theme);
    themeToggle.classList.toggle('gv-pm-theme-dark', theme === 'dark');
    themeToggle.replaceChildren(theme === 'dark' ? createMoonIcon(9) : createSunIcon(9));
    themeToggle.title = theme === 'dark' ? t('pm_theme_light') : t('pm_theme_dark');
    themeToggle.setAttribute('aria-label', themeToggle.title);
  }

  function applySaved(saved: unknown) {
    fixedTheme = isPromptScheme(saved) ? saved : null;
    applyTheme(fixedTheme ?? pageScheme());
  }

  applyTheme(currentTheme);

  const stopFollowingPage = subscribeScheme((scheme) => {
    if (fixedTheme === null) applyTheme(scheme);
  });

  const onStorageChanged = (changes: Record<string, browser.Storage.StorageChange>) => {
    if (StorageKeys.PROMPT_THEME in changes) applySaved(changes[StorageKeys.PROMPT_THEME].newValue);
  };
  browser.storage.onChanged.addListener(onStorageChanged);

  void readSyncedChoice(StorageKeys.PROMPT_THEME, isPromptScheme).then((saved) => {
    if (saved) applySaved(saved);
  });

  const transitionTimers = new Set<ReturnType<typeof setTimeout>>();
  function cancelTransitions(): void {
    // A pending transition must not touch a panel destroyed during an extension reload.
    for (const timer of transitionTimers) clearTimeout(timer);
    transitionTimers.clear();
  }

  themeToggle.addEventListener('click', async () => {
    fixedTheme = currentTheme === 'dark' ? 'light' : 'dark';
    // Enable smooth color transition on all panel children
    panel.classList.add('gv-pm-transitioning');
    applyTheme(fixedTheme);
    const timer = setTimeout(() => {
      transitionTimers.delete(timer);
      panel.classList.remove('gv-pm-transitioning');
    }, 450);
    transitionTimers.add(timer);
    await writeSyncedChoice(StorageKeys.PROMPT_THEME, fixedTheme);
  });

  return {
    element: themeToggle,
    destroy: () => {
      cancelTransitions();
      stopFollowingPage();
      // After an extension reload `browser.storage` is gone; a throw here would
      // skip the rest of the Prompt Manager's teardown and strand its trigger.
      browser.storage?.onChanged?.removeListener(onStorageChanged);
    },
  };
}
