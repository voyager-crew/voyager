import {
  geminiSidebarSelector,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

import { GEMS_NAV_ENTRY_SELECTOR } from './anchorGuard';
import { findGemsSectionNav } from './section';

export interface GemsSidebarLocation {
  overflow: HTMLElement;
  entry: HTMLElement | null;
  nav: HTMLElement | null;
}

/** P2a relocates the sidebar root; Gems catalog/entry identity remains packaged (P8). */
export function findGemsSidebarLocation(): GemsSidebarLocation | null {
  return resolveGeminiSidebarOperation(
    (view) => {
      const overflow = document.querySelector(geminiSidebarSelector('sidebar.overflow', view));
      if (!(overflow instanceof HTMLElement)) return null;
      const entry = Array.from(overflow.querySelectorAll(GEMS_NAV_ENTRY_SELECTOR)).find(
        (element) => element instanceof HTMLElement && element.getBoundingClientRect().height > 0,
      );
      return {
        overflow,
        entry: entry instanceof HTMLElement ? entry : null,
        nav: entry ? null : findGemsSectionNav(overflow),
      };
    },
    (location) => location !== null && (location.entry !== null || location.nav !== null),
  ).value;
}
