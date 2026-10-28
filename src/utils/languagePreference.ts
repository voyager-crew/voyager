import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import { type AppLanguage, normalizeLanguage } from './language';

type StorageAreaName = 'sync' | 'local';

async function readStorageValue(area: StorageAreaName): Promise<unknown> {
  try {
    const storageArea = browser.storage?.[area];
    if (storageArea?.get) {
      const result: unknown = await storageArea.get(StorageKeys.LANGUAGE);
      if (result && typeof result === 'object') {
        return StorageKeys.LANGUAGE in result ? result[StorageKeys.LANGUAGE] : undefined;
      }
    }
  } catch {
    // Fall through to chrome.* fallback below.
  }

  try {
    const chromeStorage = chrome?.storage?.[area];
    if (!chromeStorage?.get) return null;
    return await new Promise<unknown>((resolve) => {
      chromeStorage.get(StorageKeys.LANGUAGE, (result: unknown) => {
        if (result && typeof result === 'object' && StorageKeys.LANGUAGE in result) {
          resolve(result[StorageKeys.LANGUAGE]);
        } else {
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
}

async function getStoredLanguage(): Promise<string | null> {
  const syncValue = await readStorageValue('sync');
  if (typeof syncValue === 'string') return syncValue;
  const localValue = await readStorageValue('local');
  if (typeof localValue === 'string') return localValue;
  return null;
}

/** Read sync, then local language preferences, falling back to the browser UI language and English. */
export async function getCurrentLanguage(): Promise<AppLanguage> {
  const stored = await getStoredLanguage();
  if (typeof stored === 'string') return normalizeLanguage(stored);

  try {
    return normalizeLanguage(browser.i18n.getUILanguage());
  } catch {
    return 'en';
  }
}
