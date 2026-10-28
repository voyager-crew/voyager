import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import {
  getCachedLanguage,
  getCurrentLanguage,
  onCachedLanguageChange,
  setCachedLanguage,
} from '@/utils/i18n';
import { type AppLanguage, normalizeLanguage } from '@/utils/language';
import { createLanguageLoader } from '@/utils/languageLoad';
import { type TranslationKey, getLoadedTranslations } from '@/utils/translations';

interface LanguageContextType {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{
  children: ReactNode;
  initialLanguage?: AppLanguage;
}> = ({ children, initialLanguage }) => {
  const [language, setLanguageState] = useState<AppLanguage>(
    initialLanguage ?? getCachedLanguage() ?? 'en',
  );
  const [languageLoader] = useState(createLanguageLoader);
  const applyLanguage = useCallback((lang: AppLanguage) => {
    // The provider's loader has already populated this table, so this applies synchronously.
    void setCachedLanguage(lang);
    setLanguageState(lang);
  }, []);

  useEffect(() => {
    const unsubscribe = onCachedLanguageChange(setLanguageState);
    const current = getCachedLanguage();
    if (current) setLanguageState(current);
    // Extension entry points pass a prepared language before mounting React.
    if (!initialLanguage) {
      void languageLoader.load(getCurrentLanguage, applyLanguage).catch((error: unknown) => {
        logger.error('Failed to load language preference', { error: String(error) });
        void languageLoader.load('en', applyLanguage);
      });
    }
    const handleStorageChange = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      const next = changes[StorageKeys.LANGUAGE]?.newValue;
      if ((areaName !== 'sync' && areaName !== 'local') || typeof next !== 'string') return;
      const lang = normalizeLanguage(next);
      void languageLoader.load(lang, applyLanguage).catch((error: unknown) => {
        logger.warn('Failed to load changed language', { error: String(error) });
      });
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      unsubscribe();
      languageLoader.stop();
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [languageLoader, applyLanguage, initialLanguage]);

  const setLanguage = async (lang: AppLanguage): Promise<void> => {
    if (!(await languageLoader.load(lang, applyLanguage))) return;
    try {
      await browser.storage.sync.set({ [StorageKeys.LANGUAGE]: lang });
    } catch (error) {
      try {
        await browser.storage.local.set({ [StorageKeys.LANGUAGE]: lang });
      } catch (localError) {
        logger.error('Failed to save language preference', {
          error: String(error),
          localError: String(localError),
        });
      }
    }
  };

  const t = (key: TranslationKey): string => {
    return getLoadedTranslations(language)?.[key] ?? getLoadedTranslations('en')?.[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
