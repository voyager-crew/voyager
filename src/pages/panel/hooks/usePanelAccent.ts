import { useLayoutEffect } from 'react';

import {
  readableForeground,
  resolveBrandColor,
  watchBrandSources,
} from '@/pages/content/platformTheme';

/** Read by `panel.css`: switches and the current menu choice take this color. */
const ACCENT_VAR = '--site-accent';
/** A knob or mark that sits on the accent. */
const ACCENT_INK_VAR = '--site-accent-ink';

/**
 * Paints the panel in the accent of the page it opened on, as the page's own
 * Voyager UI is painted (`platformTheme`): the per-site color the person
 * picked, else an enabled plugin's, else the site's brand. Viewing another
 * site's settings keeps the page's accent. No accent (Gemini, AI Studio)
 * leaves the sage in `panel.css`.
 */
export function usePanelAccent(pageUrl: string): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const paint = (color: string | null) => {
      if (color) {
        root.style.setProperty(ACCENT_VAR, color);
        root.style.setProperty(ACCENT_INK_VAR, readableForeground(color));
      } else {
        root.style.removeProperty(ACCENT_VAR);
        root.style.removeProperty(ACCENT_INK_VAR);
      }
    };
    // The site's built-in brand at once; storage and the catalog refine it.
    paint(resolveBrandColor(pageUrl));
    const stop = watchBrandSources(pageUrl, ({ manifests, customColors, adapter }) =>
      paint(resolveBrandColor(pageUrl, manifests, customColors, adapter)),
    );
    return () => {
      stop();
      paint(null);
    };
  }, [pageUrl]);
}
