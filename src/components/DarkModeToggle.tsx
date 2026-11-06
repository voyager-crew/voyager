import React from 'react';

import { Moon, Sun } from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';
import { useDarkMode } from '../hooks/useDarkMode';
import { Button } from './ui/button';

export const DarkModeToggle: React.FC = () => {
  const { isDark, toggleDarkMode } = useDarkMode();
  const { t } = useLanguage();
  const label = t(isDark ? 'pm_theme_light' : 'pm_theme_dark');

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => toggleDarkMode(e)}
      title={label}
      aria-label={label}
      className="h-9 w-9"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};
