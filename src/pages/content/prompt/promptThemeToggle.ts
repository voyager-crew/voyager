/**
 * The light/auto/dark switch in the Prompt Manager header.
 *
 * `auto` follows the host page's theme as it changes. Picking light or dark
 * fixes the panel until the switch (or the popup's theme popover) returns it to
 * auto. The theme lives on the panel as `data-gv-theme`, which every surface
 * opened from the panel copies.
 */
import browser from 'webextension-polyfill';

import { createMonitorIcon, createMoonIcon, createSunIcon } from '@/core/icons/promptManagerIcons';
import { StorageKeys } from '@/core/types/common';
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';
import type { TranslationKey } from '@/utils/translations';

import { subscribeScheme } from '../platformTheme/scheme';
import { readSyncedChoice, writeSyncedChoice } from './promptPrefs';

export type PromptThemeMode = 'auto' | 'light' | 'dark';

const isPromptThemeMode = (value: unknown): value is PromptThemeMode =>
  value === 'auto' || value === 'light' || value === 'dark';

/** Cycles in visual order: light → auto → dark. */
export function getNextPromptTheme(currentMode: PromptThemeMode): PromptThemeMode {
  if (currentMode === 'light') return 'auto';
  if (currentMode === 'auto') return 'dark';
  return 'light';
}

/** Applies the theme to `panel` from the start; `destroy` stops following the page. */
export function createThemeToggle({
  panel,
  t,
  pageScheme,
}: {
  panel: HTMLElement;
  t: (key: TranslationKey) => string;
  /** Reads the host page's scheme, used in auto mode. */
  pageScheme: () => PromptScheme;
}): { element: HTMLButtonElement; destroy: () => void } {
  const themeToggle = document.createElement('button');
  themeToggle.className = 'gv-pm-theme-toggle';
  themeToggle.setAttribute('type', 'button');
  let currentMode: PromptThemeMode = 'auto';

  /** `data-gv-scheme` is the scheme platformTheme resolves for every page. */
  function currentPageScheme(): PromptScheme {
    const stamped = document.documentElement?.getAttribute('data-gv-scheme');
    if (stamped === 'light' || stamped === 'dark') return stamped;
    return pageScheme();
  }

  function applyTheme(mode: PromptThemeMode, theme: PromptScheme) {
    currentMode = mode;
    panel.setAttribute('data-gv-theme', theme);
    themeToggle.classList.toggle('gv-pm-theme-dark', mode === 'dark');
    themeToggle.classList.toggle('gv-pm-theme-auto', mode === 'auto');
    themeToggle.replaceChildren(
      mode === 'auto'
        ? createMonitorIcon(9)
        : mode === 'dark'
          ? createMoonIcon(9)
          : createSunIcon(9),
    );

    const nextMode = getNextPromptTheme(mode);
    themeToggle.title = t(
      nextMode === 'auto'
        ? 'pm_theme_auto'
        : nextMode === 'dark'
          ? 'pm_theme_dark'
          : 'pm_theme_light',
    );
    themeToggle.setAttribute('aria-label', themeToggle.title);
  }

  function applySaved(saved: unknown) {
    const mode: PromptThemeMode =
      saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
    applyTheme(mode, mode === 'auto' ? currentPageScheme() : mode);
  }

  applyTheme('auto', currentPageScheme());

  const stopFollowingPage = subscribeScheme((scheme) => {
    if (currentMode === 'auto') applyTheme('auto', scheme);
  });

  const onStorageChanged = (changes: Record<string, browser.Storage.StorageChange>) => {
    if (StorageKeys.PROMPT_THEME in changes) applySaved(changes[StorageKeys.PROMPT_THEME].newValue);
  };
  browser.storage.onChanged.addListener(onStorageChanged);

  void readSyncedChoice(StorageKeys.PROMPT_THEME, isPromptThemeMode).then((saved) => {
    if (saved) applySaved(saved);
  });

  const transitionTimers = new Set<ReturnType<typeof setTimeout>>();
  function cancelTransitions(): void {
    // A pending transition must not touch a panel destroyed during an extension reload.
    for (const timer of transitionTimers) clearTimeout(timer);
    transitionTimers.clear();
  }

  themeToggle.addEventListener('click', async () => {
    const nextMode = getNextPromptTheme(currentMode);
    const nextTheme: PromptScheme = nextMode === 'auto' ? currentPageScheme() : nextMode;
    // Enable smooth color transition on all panel children
    panel.classList.add('gv-pm-transitioning');
    applyTheme(nextMode, nextTheme);
    const timer = setTimeout(() => {
      transitionTimers.delete(timer);
      panel.classList.remove('gv-pm-transitioning');
    }, 450);
    transitionTimers.add(timer);
    await writeSyncedChoice(StorageKeys.PROMPT_THEME, nextMode);
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
