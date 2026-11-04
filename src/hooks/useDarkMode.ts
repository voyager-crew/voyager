import React, { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function getInitialThemeMode(): ThemeMode {
  const savedMode = localStorage.getItem('themeMode');
  if (savedMode === 'auto' || savedMode === 'light' || savedMode === 'dark') {
    return savedMode;
  }
  // Legacy installs only stored the resolved boolean; keep their choice.
  const legacyDarkMode = localStorage.getItem('darkMode');
  if (legacyDarkMode === 'true') return 'dark';
  if (legacyDarkMode === 'false') return 'light';
  return 'auto';
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return prefersDark();
}

/** Cycles in visual order: light → auto → dark. */
export function getNextThemeMode(currentMode: ThemeMode): ThemeMode {
  if (currentMode === 'light') return 'auto';
  if (currentMode === 'auto') return 'dark';
  return 'light';
}

export function useDarkMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(getInitialThemeMode()));

  useEffect(() => {
    const activeDark = resolveIsDark(themeMode);
    setIsDark(activeDark);
    document.documentElement.classList.toggle('dark', activeDark);
    localStorage.setItem('themeMode', themeMode);
    localStorage.setItem('darkMode', String(activeDark));
  }, [themeMode]);

  // In auto mode the page follows the OS as it changes.
  useEffect(() => {
    if (themeMode !== 'auto' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
      document.documentElement.classList.toggle('dark', e.matches);
      localStorage.setItem('darkMode', String(e.matches));
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const toggleDarkMode = useCallback(
    (event?: React.MouseEvent) => {
      const nextMode = getNextThemeMode(themeMode);
      const nextIsDark = resolveIsDark(nextMode);

      const applyTheme = () => {
        setThemeMode(nextMode);
        setIsDark(nextIsDark);
        document.documentElement.classList.toggle('dark', nextIsDark);
        localStorage.setItem('themeMode', nextMode);
        localStorage.setItem('darkMode', String(nextIsDark));
      };

      // Skip animation if no event, no View Transition API, or user prefers reduced motion
      const startViewTransition = (
        document as { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
      ).startViewTransition;
      if (
        !event ||
        !startViewTransition ||
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      ) {
        applyTheme();
        return;
      }

      const x = event.clientX;
      const y = event.clientY;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = startViewTransition.call(document, applyTheme);

      transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 500,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      });
    },
    [themeMode],
  );

  return { themeMode, isDark, toggleDarkMode };
}
