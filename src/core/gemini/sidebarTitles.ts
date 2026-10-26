import titles from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-titles.json';

import {
  type GeminiSelectorView,
  getBundledGeminiSelectorView,
  resolveGeminiSelectorOperation,
} from './selectors';

/**
 * Title locators stay packaged: a title is saved, synced, exported and printed, so an online
 * match would have to equal the packaged one (text such as "More options" sits in the same row).
 * Each owner keeps its own ordered list.
 */
const ACTIVE_TITLE_SELECTORS = {
  active: Object.freeze([...titles['title.active']]),
  activeExport: Object.freeze([...titles['title.activeExport']]),
  activeResearch: Object.freeze([...titles['title.activeResearch']]),
} as const;

export const GEMINI_PACKAGED_TITLE_SELECTORS = Object.freeze({
  export: titles['title.export'].join(', '),
});

/** One ordered title read; URL/metadata fallbacks remain with the caller. */
export function readGeminiActiveSidebarTitle(
  owner: keyof typeof ACTIVE_TITLE_SELECTORS,
  accepts: (title: string) => boolean,
  doc: Document = document,
): string | null {
  for (const selector of ACTIVE_TITLE_SELECTORS[owner]) {
    const title = doc.querySelector(selector)?.textContent?.trim() ?? '';
    if (title && accepts(title)) return title;
  }
  return null;
}

/**
 * ID-bound row titles are exported and printed: an online row link or label must yield the same
 * title the packaged read finds, or the owner rereads every strategy from the bundle.
 */
export function readCorroboratedGeminiTitle(
  read: (view: GeminiSelectorView) => string | null,
): string | null {
  const packaged = read(getBundledGeminiSelectorView());
  return resolveGeminiSelectorOperation(
    (view) => {
      const title = read(view);
      return view.remoteKeys.size > 0 && title !== packaged ? null : title;
    },
    (title) => title !== null,
  ).value;
}
