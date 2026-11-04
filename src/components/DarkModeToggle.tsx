import React from 'react';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';
import { getNextThemeMode, useDarkMode } from '../hooks/useDarkMode';
import { Button } from './ui/button';

export const DarkModeToggle: React.FC = () => {
  const { themeMode, toggleDarkMode } = useDarkMode();
  const { t } = useLanguage();

  const nextMode = getNextThemeMode(themeMode);
  const label = t(
    nextMode === 'auto'
      ? 'pm_theme_auto'
      : nextMode === 'dark'
        ? 'pm_theme_dark'
        : 'pm_theme_light',
  );
  const Icon = themeMode === 'auto' ? Monitor : themeMode === 'dark' ? Moon : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => toggleDarkMode(e)}
      title={label}
      aria-label={label}
      className="h-9 w-9"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
};
