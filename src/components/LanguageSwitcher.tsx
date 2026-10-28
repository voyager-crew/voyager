import React from 'react';

import { Globe } from 'lucide-react';

import { logger } from '@/core/services/LoggerService';

import { useLanguage } from '../contexts/LanguageContext';
import { APP_LANGUAGE_LABELS, getNextLanguage } from '../utils/language';
import { Button } from './ui/button';

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const nextLanguage = getNextLanguage(language);
  const label = t('languageSwitchTo').replace(
    '{language}',
    () => APP_LANGUAGE_LABELS[nextLanguage],
  );

  const toggleLanguage = () => {
    void setLanguage(nextLanguage).catch((error: unknown) => {
      logger.warn('Failed to switch interface language', {
        language: nextLanguage,
        error: String(error),
      });
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      title={label}
      aria-label={label}
      className="h-9 w-9"
    >
      <Globe className="h-4 w-4" />
    </Button>
  );
};
