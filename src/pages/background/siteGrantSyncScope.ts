/**
 * A supported site the person grants access to joins cloud sync, even one
 * turned off there before. The background sees every grant, including one
 * that completes after the popup or panel that asked has closed.
 */
import browser from 'webextension-polyfill';

import { markSiteIncluded } from '@/core/services/CloudSyncScope';
import { logger } from '@/core/services/LoggerService';
import { CATALOG_SITES } from '@/pages/popup/utils/siteAccessSites';

/**
 * The supported sites this grant gave page access to, and that the browser
 * still holds. A frame a site embeds, an API permission or another website is
 * not access to a supported site.
 */
async function grantedSites(added: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const site of CATALOG_SITES) {
    const origins = site.origins.filter((origin) => added.includes(origin));
    if (origins.length === 0) continue;
    try {
      if (await browser.permissions.contains({ origins })) ids.push(site.id);
    } catch {
      // Unknown: what syncs stays as it is.
    }
  }
  return ids;
}

/** Puts each supported site this grant opened back in what syncs. */
export async function includeGrantedSites(added: readonly string[] | undefined): Promise<void> {
  if (!added?.length) return;
  for (const siteId of await grantedSites(added)) {
    try {
      await markSiteIncluded(siteId);
    } catch (error) {
      logger.warn('Could not include the site in sync', { site: siteId, error: String(error) });
    }
  }
}
