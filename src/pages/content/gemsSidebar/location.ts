import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { acceptsGeminiSidebarElement } from '@/core/gemini/sidebar/proof';
import {
  geminiSidebarSelector,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

import { findGemsSectionNav } from './section';
import { gemsPackagedSelectors, gemsSelector, isNativeGemsNavEntry } from './selectorQueries';

export interface GemsSidebarLocation {
  overflow: HTMLElement;
  entry: HTMLElement | null;
  nav: HTMLElement | null;
}

function readLocation(view: GeminiSelectorView): GemsSidebarLocation | null {
  const overflow = document.querySelector(geminiSidebarSelector('sidebar.overflow', view));
  if (!(overflow instanceof HTMLElement)) return null;
  const entry = Array.from(overflow.querySelectorAll(gemsSelector('gems.navEntry', view))).find(
    (element) => element instanceof HTMLElement && element.getBoundingClientRect().height > 0,
  );
  return {
    overflow,
    entry: entry instanceof HTMLElement ? entry : null,
    nav: entry ? null : findGemsSectionNav(overflow),
  };
}

/** Select the sidebar root and Gems entry together before inserting anything. */
export function findGemsSidebarLocation(): GemsSidebarLocation | null {
  const active = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  return resolveGeminiSidebarOperation(
    (view) => {
      const location = readLocation(view);
      if (
        view.remoteKeys.has('sidebar.overflow') &&
        !acceptsGeminiSidebarElement(
          'sidebar.overflow',
          location?.overflow ?? null,
          readLocation(bundle)?.overflow ?? null,
        )
      )
        return null;
      if (view !== active || !active.remoteKeys.has('gems.navEntry')) return location;
      const original = readLocation(bundle);
      if (!location?.entry || (original?.entry && original.entry !== location.entry)) return null;
      // A broad online nav locator must not move Gems into Settings or the More popover.
      if (
        !original?.entry &&
        (!isNativeGemsNavEntry(location.entry) ||
          !location.entry.closest(gemsPackagedSelectors.navHost))
      )
        return null;
      if (!original?.entry) {
        const nativeEntries = Array.from(
          location.overflow.querySelectorAll(gemsPackagedSelectors.nativeLink),
        ).filter(
          (entry) => isNativeGemsNavEntry(entry) && entry.getBoundingClientRect().height > 0,
        );
        if (nativeEntries.length !== 1 || !location.entry.contains(nativeEntries[0])) return null;
      }
      return location;
    },
    (location) => location !== null && (location.entry !== null || location.nav !== null),
  ).value;
}
