import {
  type GeminiSelectorView,
  getBundledGeminiSelectorView,
  resolveGeminiSelectorOperation,
} from './selectors';
import { geminiTitleSelectors } from './sidebar/titleProof';

/** One ordered title read; URL/metadata fallbacks remain with the caller. */
export function readGeminiActiveSidebarTitle(
  owner: 'active' | 'activeExport' | 'activeResearch',
  accepts: (title: string) => boolean,
  doc: Document = document,
): string | null {
  const key = {
    active: 'title.active',
    activeExport: 'title.activeExport',
    activeResearch: 'title.activeResearch',
  } as const;
  for (const selector of geminiTitleSelectors(key[owner], doc)) {
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
