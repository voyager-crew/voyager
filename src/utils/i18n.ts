import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import { type AppLanguage, localeFromLanguage, normalizeLanguage } from './language';
import { TRANSLATIONS, type TranslationKey, isTranslationKey } from './translations';

type StorageAreaName = 'sync' | 'local';

const readStorageValue = async (area: StorageAreaName): Promise<unknown> => {
  try {
    const storageArea = browser.storage?.[area];
    if (storageArea?.get) {
      const result = await storageArea.get(StorageKeys.LANGUAGE);
      if (result && typeof result === 'object') {
        return (result as Record<string, unknown>)[StorageKeys.LANGUAGE];
      }
    }
  } catch {
    // Fall through to chrome.* fallback below.
  }

  try {
    const chromeStorage = chrome?.storage?.[area];
    if (!chromeStorage?.get) return null;
    return await new Promise<unknown>((resolve) => {
      chromeStorage.get(StorageKeys.LANGUAGE, (result) => {
        if (result && typeof result === 'object') {
          resolve((result as Record<string, unknown>)[StorageKeys.LANGUAGE]);
        } else {
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
};

const getStoredLanguage = async (): Promise<string | null> => {
  const syncValue = await readStorageValue('sync');
  if (typeof syncValue === 'string') return syncValue;
  const localValue = await readStorageValue('local');
  if (typeof localValue === 'string') return localValue;
  return null;
};

/**
 * Get the current language preference
 * 1. First check user's saved preference in storage
 * 2. Fall back to browser UI language
 * 3. Default to English
 */
export async function getCurrentLanguage(): Promise<AppLanguage> {
  const stored = await getStoredLanguage();
  if (typeof stored === 'string') {
    return normalizeLanguage(stored);
  }

  // Fall back to browser UI language
  try {
    const browserLang = browser.i18n.getUILanguage();
    return normalizeLanguage(browserLang);
  } catch {
    return 'en';
  }
}

/**
 * Get translation for a key using the current language preference
 * This function works in both React and non-React contexts (e.g., content scripts)
 */
export async function getTranslation(key: TranslationKey): Promise<string> {
  const language = await getCurrentLanguage();
  return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
}

/**
 * Get translation synchronously using cached language
 * This is less accurate but faster for scenarios where async is not possible
 */
let cachedLanguage: AppLanguage | null = null;
let languageListenerInstalled = false;

export function getTranslationSync(key: TranslationKey): string {
  const language = cachedLanguage || 'en';
  return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
}

/** The language synchronous translations use, as a BCP-47 tag for Intl formatting. */
export function getCachedLocale(): string {
  return localeFromLanguage(cachedLanguage || 'en');
}

export function getTranslationSyncUnsafe(key: string): string {
  if (!isTranslationKey(key)) return key;
  return getTranslationSync(key);
}

/**
 * Initialize the i18n system and cache the current language
 * Should be called early in the application lifecycle
 */
export async function initI18n(): Promise<void> {
  applyCachedLanguage(await getCurrentLanguage());

  // Listen for language changes. Several features call initI18n on their own
  // start, so register once per page instead of once per caller.
  if (languageListenerInstalled) return;
  languageListenerInstalled = true;
  browser.storage.onChanged.addListener((changes, areaName) => {
    const next = changes[StorageKeys.LANGUAGE]?.newValue;
    if ((areaName === 'sync' || areaName === 'local') && typeof next === 'string') {
      applyCachedLanguage(normalizeLanguage(next));
    }
  });
}

/**
 * Immediately update the cached language value.
 * This should be called after setting the language in storage to ensure
 * synchronous translation calls use the new language immediately,
 * avoiding race conditions with the async storage.onChanged listener.
 */
export function setCachedLanguage(lang: AppLanguage): void {
  applyCachedLanguage(lang);
}

const languageSubscribers = new Set<() => void>();

function applyCachedLanguage(lang: AppLanguage): void {
  if (cachedLanguage === lang) return;
  cachedLanguage = lang;
  for (const subscriber of languageSubscribers) subscriber();
}

/**
 * Runs `callback` after the language synchronous translations use changes, so
 * already-rendered labels can follow it. Returns the unsubscribe.
 */
export function onCachedLanguageChange(callback: () => void): () => void {
  languageSubscribers.add(callback);
  return () => languageSubscribers.delete(callback);
}

/**
 * Create a translator function that uses cached language
 * This is useful for classes that need a simple t() function
 */
export function createTranslator(): (key: string) => string {
  return (key: string) => getTranslationSyncUnsafe(key);
}
