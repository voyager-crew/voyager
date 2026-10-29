/**
 * The tab-scoped context the panel shows: page URL, site, account slot,
 * scheme and direction. The background forwards it to the panel page, which
 * never trusts window messages for it.
 */
import { extractRouteUserIdFromUrl } from '@/core/services/AccountIsolationService';
import { detectRTL } from '@/core/utils/rtl';
import type { PanelContext } from '@/features/panel/protocol';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import { getCachedLanguage, onCachedLanguageChange } from '@/utils/i18n';

import { getScheme, subscribeScheme } from '../platformTheme/scheme';
import { watchRouteChanges } from '../utils/routeWatcher';

export function readPanelContext(): PanelContext {
  const pageUrl = location.href;
  const site = SiteRegistry.createDefault().resolveByUrl(pageUrl);
  return {
    pageUrl,
    siteId: site?.id ?? null,
    // `/app` without `/u/N` is the first account.
    accountSlot: site?.accountSlots ? (extractRouteUserIdFromUrl(pageUrl) ?? '0') : null,
    scheme: getScheme(),
    direction: detectRTL(getCachedLanguage()) ? 'rtl' : 'ltr',
  };
}

const sameContext = (a: PanelContext, b: PanelContext): boolean =>
  a.pageUrl === b.pageUrl &&
  a.siteId === b.siteId &&
  a.accountSlot === b.accountSlot &&
  a.scheme === b.scheme &&
  a.direction === b.direction;

/**
 * Calls `onChange` with the new context whenever one of its parts changes:
 * SPA navigation, the scheme, Voyager's language or the page's own direction,
 * starting with any change since `initial` was read. Returns the cleanup.
 */
export function watchPanelContext(
  initial: PanelContext,
  onChange: (context: PanelContext) => void,
): () => void {
  let last = initial;
  const check = (): void => {
    const next = readPanelContext();
    if (sameContext(next, last)) return;
    last = next;
    onChange(next);
  };
  const stopRoute = watchRouteChanges(check);
  const stopScheme = subscribeScheme(check);
  const stopLanguage = onCachedLanguageChange(check);
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['dir', 'lang', 'data-gv-scheme'],
  });
  if (document.body)
    observer.observe(document.body, { attributes: true, attributeFilter: ['dir'] });
  // What changed while nothing watched (the token on its way, a close playing) goes out now.
  check();
  return () => {
    stopRoute();
    stopScheme();
    stopLanguage();
    observer.disconnect();
  };
}
