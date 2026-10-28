import { StorageKeys } from '@/core/types/common';
import { type AppLanguage, normalizeLanguage } from '@/utils/language';
import { createLanguageLoader } from '@/utils/languageLoad';
import { type TranslationKey, getLoadedTranslations, loadTranslations } from '@/utils/translations';

export type ExportDictionaries = Partial<Record<AppLanguage, Record<string, string>>> & {
  en: Record<string, string>;
};
export type ExportTranslate = (key: TranslationKey) => string;

const loadedDictionaries: ExportDictionaries = { en: getLoadedTranslations('en') ?? {} };

/** Load only the selected language; failed chunks retain the English fallback and can retry. */
export async function loadExportDictionaries(language: AppLanguage): Promise<ExportDictionaries> {
  if (loadedDictionaries[language]) return loadedDictionaries;
  try {
    loadedDictionaries[language] = await loadTranslations(language);
  } catch {}
  return loadedDictionaries;
}

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

interface StorageChangeEvents {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
}

/**
 * The extension APIs. Firefox defines `chrome`/`browser` on the content-script
 * global, which only inherits from the page `window`, so `window.chrome` is
 * undefined there.
 */
function extensionGlobal() {
  return globalThis as typeof globalThis & {
    chrome?: {
      storage?: {
        sync?: { get: (key: string, cb: (r: unknown) => void) => void };
        onChanged?: StorageChangeEvents;
      };
    };
    browser?: {
      storage?: {
        sync?: { get: (key: string) => Promise<unknown> };
        onChanged?: StorageChangeEvents;
      };
    };
  };
}

/**
 * Read the user's language from sync storage (Chrome or Firefox API), falling
 * back to the browser language. Gives up on storage after 1 s so a hung
 * Firefox call cannot block the export UI. Never rejects.
 */
export async function readExportLanguage(): Promise<AppLanguage> {
  try {
    // Add timeout to prevent hanging in Firefox
    const stored = await Promise.race([
      new Promise<unknown>((resolve) => {
        try {
          const ext = extensionGlobal();
          if (ext.chrome?.storage?.sync?.get) {
            ext.chrome.storage.sync.get(StorageKeys.LANGUAGE, resolve);
          } else if (ext.browser?.storage?.sync?.get) {
            ext.browser.storage.sync
              .get(StorageKeys.LANGUAGE)
              .then(resolve)
              .catch(() => resolve({}));
          } else {
            resolve({});
          }
        } catch {
          resolve({});
        }
      }),
      new Promise<unknown>((resolve) => setTimeout(() => resolve({}), 1000)),
    ]);
    const rec = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
    const v =
      typeof rec[StorageKeys.LANGUAGE] === 'string'
        ? (rec[StorageKeys.LANGUAGE] as string)
        : undefined;
    return normalizeLanguage(v || navigator.language || 'en');
  } catch {
    return 'en';
  }
}

/** The language a `storage.onChanged` batch switches to, or null when it does not change it. */
export function languageFromStorageChanges(
  changes: Record<string, chrome.storage.StorageChange>,
): AppLanguage | null {
  const nextRaw = changes[StorageKeys.LANGUAGE]?.newValue;
  return typeof nextRaw === 'string' ? normalizeLanguage(nextRaw) : null;
}

/**
 * Call `onChange` with the language the user switches to in sync storage.
 * Returns the stop.
 */
export function watchExportLanguage(onChange: (lang: AppLanguage) => void): () => void {
  const languageLoader = createLanguageLoader();
  const listener: StorageChangeListener = (changes, area) => {
    if (area !== 'sync') return;
    const next = languageFromStorageChanges(changes);
    if (!next) return;
    void languageLoader
      .load(next, (language) => {
        const messages = getLoadedTranslations(language);
        if (messages) loadedDictionaries[language] = messages;
        onChange(language);
      })
      .catch(() => {});
  };
  const ext = extensionGlobal();
  const events = (ext.chrome?.storage ?? ext.browser?.storage)?.onChanged;
  try {
    events?.addListener(listener);
  } catch {}
  return () => {
    languageLoader.stop();
    try {
      events?.removeListener(listener);
    } catch {}
  };
}

/** Translator falling back to English, then to the key itself. */
export function createExportTranslator(
  dict: ExportDictionaries,
  lang: AppLanguage,
): ExportTranslate {
  return (key: TranslationKey) => dict[lang]?.[key] ?? dict.en?.[key] ?? key;
}

/** Like {@link createExportTranslator}, but with an explicit text when both locales lack the key. */
export function translateExportOr(
  dict: ExportDictionaries,
  lang: AppLanguage,
  key: TranslationKey,
  fallback: string,
): string {
  return dict[lang]?.[key] ?? dict.en?.[key] ?? fallback;
}
