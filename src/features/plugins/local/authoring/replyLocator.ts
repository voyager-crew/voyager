/**
 * The selector an author is handed for one AI reply on a site: the scripted
 * page lists it and the page outline counts it. It is the site's
 * `assistantTurn` anchor unless the site's packaged page data marks replies in
 * more page shapes. ChatGPT's `assistantTurn` is absent from scheduled-task
 * conversations, while `replyMessage` wraps each reply on those and on
 * ordinary ones. `assistantTurn` keeps its meaning for its declarative
 * consumers; only authors get the wider marker.
 */
import { chatgptPageData } from '../../builtin/chatgptPageData';
import type { SiteAdapter } from '../../types';

const PAGE_DATA_REPLIES: Readonly<Record<string, string>> = {
  chatgpt: chatgptPageData.replyMessage,
};

/** One element per AI reply on `site`, or undefined when the site names none. */
export function replyLocator(site: SiteAdapter): string | undefined {
  return Object.hasOwn(PAGE_DATA_REPLIES, site.id)
    ? PAGE_DATA_REPLIES[site.id]
    : site.selectors.assistantTurn;
}
