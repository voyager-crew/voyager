import { getPageSelectorSiteId, locatorSiteForHost } from '@/core/selectors';
import aistudio from '@/features/plugins/catalog/sites/aistudio/selector-data/timeline-packaged.json';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/selector-data/timeline-packaged.json';
import claude from '@/features/plugins/catalog/sites/claude/selector-data/timeline-packaged.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/selector-data/timeline-packaged.json';
import gemini from '@/features/plugins/catalog/sites/gemini/selector-data/timeline-packaged.json';
import kimi from '@/features/plugins/catalog/sites/kimi/selector-data/timeline-packaged.json';

import generic from './generic-text.json';

const PROFILES: Readonly<Record<string, typeof gemini>> = {
  gemini,
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
};

export function timelineSiteData(doc?: Document, url?: string): typeof gemini {
  let siteId: string | null = getPageSelectorSiteId(doc);
  if (url) {
    try {
      siteId = locatorSiteForHost(new URL(url).hostname);
    } catch {
      /* Keep the current page. */
    }
  }
  return siteId && Object.hasOwn(PROFILES, siteId) ? PROFILES[siteId] : generic;
}
