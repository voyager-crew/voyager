import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';

import { type AppLanguage, localeFromLanguage, normalizeLanguage } from './language';
import { createLanguageLoader } from './languageLoad';
import { getCurrentLanguage } from './languagePreference';
import {
  type TranslationKey,
  getLoadedTranslations,
  isTranslationKey,
  loadTranslations,
} from './translations';

export { getCurrentLanguage } from './languagePreference';

/**
 * Get translation for a key using the current language preference
 * This function works in both React and non-React contexts (e.g., content scripts)
 */
export async function getTranslation(key: TranslationKey): Promise<string> {
  const language = await getCurrentLanguage();
  const translations = await loadTranslations(language);
  return translations[key] ?? getLoadedTranslations('en')?.[key] ?? key;
}

/**
 * Get translation synchronously using cached language
 * This is less accurate but faster for scenarios where async is not possible
 */
let cachedLanguage: AppLanguage | null = null;
let languageListenerInstalled = false;
let initialization: Promise<void> | undefined;
const languageLoader = createLanguageLoader();

export function getTranslationSync(key: TranslationKey): string {
  const language = cachedLanguage || 'en';
  return getLoadedTranslations(language)?.[key] ?? getLoadedTranslations('en')?.[key] ?? key;
}

export function getCachedLanguage(): AppLanguage | null {
  return cachedLanguage;
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
  if (initialization) return initialization;
  // Listen for language changes. Several features call initI18n on their own
  // start, so register once per page instead of once per caller.
  if (!languageListenerInstalled) {
    languageListenerInstalled = true;
    browser.storage.onChanged.addListener((changes, areaName) => {
      const next = changes[StorageKeys.LANGUAGE]?.newValue;
      if ((areaName === 'sync' || areaName === 'local') && typeof next === 'string') {
        const language = normalizeLanguage(next);
        // Even the current language cancels a different selection still loading.
        void setCachedLanguage(language).catch((error: unknown) => {
          logger.warn('Failed to load changed language', { error: String(error) });
        });
      }
    });
  }
  // Reserve the request before reading storage: a later selection must also
  // supersede an old preference read that has not returned yet.
  // Callers await this before starting their feature, so a failed language
  // chunk leaves the page in English instead of stopping that feature.
  initialization = languageLoader.load(getCurrentLanguage, applyCachedLanguage).then(
    () => {
      initialization = undefined;
    },
    (error: unknown) => {
      initialization = undefined;
      logger.warn('Failed to load the interface language', { error: String(error) });
    },
  );
  return initialization;
}

/**
 * Load before notifying synchronous consumers. Already-loaded languages apply
 * immediately; awaiting this also handles the first selection of a language.
 * Returns false when a newer selection supersedes this request.
 */
export function setCachedLanguage(lang: AppLanguage): Promise<boolean> {
  return languageLoader.load(lang, applyCachedLanguage);
}

const languageSubscribers = new Set<(language: AppLanguage) => void>();

function applyCachedLanguage(lang: AppLanguage): void {
  if (cachedLanguage === lang) return;
  cachedLanguage = lang;
  for (const subscriber of languageSubscribers) subscriber(lang);
}

/**
 * Runs `callback` after the language synchronous translations use changes, so
 * already-rendered labels can follow it. Returns the unsubscribe.
 */
export function onCachedLanguageChange(callback: (language: AppLanguage) => void): () => void {
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
