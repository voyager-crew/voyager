import { isRTLLanguage } from '@/core/utils/rtl';

/**
 * The theme and direction a confirm opened from the popup takes: the popup sets
 * both on its own root (`html.dark`, `dir`), not where the shared layer reads them.
 */
export function popupConfirmTheme(language: string): {
  scheme: 'light' | 'dark';
  dir: 'ltr' | 'rtl';
} {
  return {
    scheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    dir: isRTLLanguage(language) ? 'rtl' : 'ltr',
  };
}
