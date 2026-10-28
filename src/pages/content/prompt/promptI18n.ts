/**
 * The Prompt Manager's view of the shared i18n system: synchronous lookups,
 * plus reading and saving the language picked in the panel.
 */
import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { getCurrentLanguage, getTranslationSync, setCachedLanguage } from '@/utils/i18n';
import {
  APP_LANGUAGES,
  APP_LANGUAGE_LABELS,
  type AppLanguage,
  isAppLanguage,
} from '@/utils/language';
import type { TranslationKey } from '@/utils/translations';

export interface PromptI18n {
  t: (key: TranslationKey) => string;
  /** Saves the language to sync storage, falling back to local storage. */
  set: (lang: AppLanguage) => Promise<void>;
  get: () => Promise<AppLanguage>;
}

export function createPromptI18n(): PromptI18n {
  return {
    t: (key: TranslationKey): string => getTranslationSync(key),
    set: async (lang: AppLanguage) => {
      if (!browser.runtime?.id) return;
      try {
        // A superseded or failed selection must never become a saved preference.
        if (!(await setCachedLanguage(lang))) return;
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          logger.warn('Failed to load prompt manager language', {
            language: lang,
            error: String(error),
          });
        }
        return;
      }

      try {
        await browser.storage.sync.set({ [StorageKeys.LANGUAGE]: lang });
      } catch (syncError) {
        try {
          await browser.storage.local.set({ [StorageKeys.LANGUAGE]: lang });
        } catch (localError) {
          if (
            isExtensionContextInvalidatedError(syncError) ||
            isExtensionContextInvalidatedError(localError)
          ) {
            return;
          }
          logger.warn('Failed to save prompt manager language', {
            language: lang,
            syncError: String(syncError),
            localError: String(localError),
          });
        }
      }
    },
    get: async (): Promise<AppLanguage> => await getCurrentLanguage(),
  };
}

/** The panel's language picker; `onChange` runs after a picked language is saved. */
export function createLanguageSelect(i18n: PromptI18n, onChange: () => void): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'gv-pm-lang';
  for (const lang of APP_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = APP_LANGUAGE_LABELS[lang];
    select.appendChild(opt);
  }
  // Set initial language value asynchronously
  i18n
    .get()
    .then((lang) => {
      select.value = lang;
    })
    .catch(() => {
      select.value = 'en';
    });

  select.addEventListener('change', async () => {
    const next = select.value;
    if (!isAppLanguage(next)) return;
    await i18n.set(next);
    onChange();
  });
  return select;
}
