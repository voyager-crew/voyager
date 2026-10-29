import { readCloudSyncScope, SyncScopeExcludedError } from '@/core/services/CloudSyncScope';
import type { CloudSyncScope } from '@/core/services/CloudSyncScope';
import { readLocalSyncStars } from '@/core/services/GoogleDriveLocalStars';
/**
 * Background side of catalog timeline sync (`gv.sync.catalogTimeline.*`): each catalog site's
 * outlines and stars, in that site's own Drive files. An extension page (the popup) syncs every
 * catalog site; a content script syncs only the catalog site it runs on, so a ChatGPT page never
 * reads or uploads Claude data. Gemini and AI Studio pages have none here: a Gemini star sync
 * carries the catalog star files itself.
 */
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { NATIVE_SITE_IDS, resolvePluginPlatformId } from '@/features/plugins/sites/registry';
import { catalogStarSites } from '@/features/savedLibrary/starSitePolicy';
import type { StarStore } from '@/features/savedLibrary/starStore';
import {
  CATALOG_TIMELINE_PULL_MESSAGE,
  CATALOG_TIMELINE_PUSH_MESSAGE,
  catalogHierarchySiteOf,
  catalogTimelineFileName,
  collectCatalogTimelineBuckets,
  isCatalogSiteId,
} from '@/features/timeline/catalogHierarchySync';

import {
  getSenderPageUrl,
  isTrustedExtensionPageSender,
  isTrustedSyncMessageSender,
} from './runtimeMessageRouting';

/** Every site the sender may sync (`'all'`), its own catalog site, or null when untrusted. */
function sitesForSender(sender: chrome.runtime.MessageSender): 'all' | Set<string> | null {
  if (isTrustedExtensionPageSender(sender)) return 'all';
  if (!FOLDER_PLATFORM_IDS.some((platform) => isTrustedSyncMessageSender(sender, platform))) {
    return null;
  }
  const site = resolvePluginPlatformId(getSenderPageUrl(sender) ?? '');
  return new Set(site && isCatalogSiteId(site) ? [site] : []);
}

async function readLocalValues(sites?: ReadonlySet<string>): Promise<Record<string, unknown>> {
  if (typeof chrome.storage.local.getKeys === 'function') {
    const keys = (await chrome.storage.local.getKeys()).filter((key) => {
      const site = catalogHierarchySiteOf(key);
      return site !== null && (!sites || sites.has(site));
    });
    return chrome.storage.local.get(keys);
  }
  return chrome.storage.local.get(null);
}

/** Bundled catalog sites plus any site this device already holds outlines or stars for. */
export async function knownCatalogSites(store: StarStore | undefined): Promise<Set<string>> {
  const sites = new Set(
    BUNDLED_SITE_ADAPTERS.map((adapter) => adapter.id).filter(
      (id) => !NATIVE_SITE_IDS.has(id) && isCatalogSiteId(id),
    ),
  );
  for (const key of Object.keys(await readLocalValues())) {
    const site = catalogHierarchySiteOf(key);
    if (site) sites.add(site);
  }
  for (const site of await localStarSites(store, 'all')) sites.add(site);
  return sites;
}

async function failure(drive: GoogleDriveSyncTransfer, fallback: string) {
  const state = await drive.getState();
  return { ok: false, error: state.error ?? fallback, state };
}

export function isCatalogTimelineSyncMessage(type: string): boolean {
  return type === CATALOG_TIMELINE_PUSH_MESSAGE || type === CATALOG_TIMELINE_PULL_MESSAGE;
}

/** The sites among `allowed` with local stars or deletions to sync. */
async function localStarSites(
  store: StarStore | undefined,
  allowed: 'all' | Set<string>,
): Promise<string[]> {
  if (!store) return [];
  const sites = catalogStarSites(await readLocalSyncStars());
  return [...sites].filter((site) => allowed === 'all' || allowed.has(site)).sort();
}

export async function prepareCatalogUpload(
  sender: chrome.runtime.MessageSender,
  starStore: StarStore | undefined,
  scope: CloudSyncScope,
  selection: 'all' | 'site' | 'shared',
  platform: string,
) {
  if (selection === 'shared') return { outlines: {}, starSites: [], includedCatalogSites: [] };
  const senderSites = sitesForSender(sender);
  if (!senderSites) throw new Error('untrusted_sender');
  const candidates =
    selection === 'site'
      ? new Set(NATIVE_SITE_IDS.has(platform) ? [] : [platform])
      : await knownCatalogSites(starStore);
  const included = new Set(
    [...candidates].filter(
      (site) =>
        scope.sites[site] !== false &&
        (selection !== 'site' || site === platform) &&
        (senderSites === 'all' || senderSites.has(site)),
    ),
  );
  if (!included.size) return { outlines: {}, starSites: [], includedCatalogSites: [] };
  const outlines = collectCatalogTimelineBuckets(await readLocalValues(included), included);
  const starSites = await localStarSites(starStore, included);
  return { outlines, starSites, includedCatalogSites: [...included] };
}

export async function handleCatalogTimelineSyncMessage(
  type: string,
  payload:
    | { interactive?: boolean; stars?: boolean; selection?: unknown; platform?: unknown }
    | undefined,
  sender: chrome.runtime.MessageSender,
  starStore: StarStore | undefined,
  drive: GoogleDriveSyncTransfer,
) {
  const senderSites = sitesForSender(sender);
  if (!senderSites) return { ok: false, error: 'untrusted_sender' };
  const scope = await readCloudSyncScope();
  if (
    payload?.selection === 'site' &&
    typeof payload.platform === 'string' &&
    scope.sites[payload.platform] === false
  )
    throw new SyncScopeExcludedError([{ kind: 'site', siteId: payload.platform }]);
  const requested =
    payload?.selection === 'site' && typeof payload.platform === 'string'
      ? new Set(NATIVE_SITE_IDS.has(payload.platform) ? [] : [payload.platform])
      : senderSites === 'all'
        ? await knownCatalogSites(starStore)
        : senderSites;
  if (senderSites !== 'all' && [...requested].some((site) => !senderSites.has(site)))
    return { ok: false, error: 'untrusted_sender' };
  if (payload?.selection === 'site' && typeof payload.platform === 'string') {
    for (const site of requested) if (site !== payload.platform) requested.delete(site);
  }
  const excluded = [...requested].filter((site) => scope.sites[site] === false);
  if ((senderSites !== 'all' || payload?.selection === 'site') && excluded.length > 0)
    throw new SyncScopeExcludedError(excluded.map((siteId) => ({ kind: 'site', siteId })));
  const allowed = new Set([...requested].filter((site) => scope.sites[site] !== false));
  const interactive = payload?.interactive !== false;

  if (type === CATALOG_TIMELINE_PUSH_MESSAGE) {
    if (allowed.size === 0) return { ok: true, sites: [], starSites: [], excluded };
    const bySite = collectCatalogTimelineBuckets(await readLocalValues(allowed), allowed);
    const sites = Object.keys(bySite);
    // A Gemini sync that just ran has synced the star files already.
    const starSites = payload?.stars === false ? [] : await localStarSites(starStore, allowed);
    // Only sites with local data are sent; with none there is no Drive call, so no sign-in prompt.
    if (
      (sites.length > 0 || starSites.length > 0) &&
      !(await drive.uploadCatalogData(bySite, starStore, starSites, interactive))
    ) {
      return failure(drive, 'Timeline outline upload failed');
    }
    await drive.commitBookkeeping(
      Object.entries(bySite).map(([site, content]) => ({
        row: site,
        name: catalogTimelineFileName(site),
        content,
      })),
    );
    return { ok: true, sites, starSites, excluded };
  }

  const sites = [...allowed].sort();
  if (sites.length === 0) return { ok: true, buckets: {}, stars: {} };
  drive.beginDownloadBookkeeping();
  const report = await drive.downloadCatalogDataResult(sites, interactive);
  if (!report) return failure(drive, 'cloud_read_failed');
  // Returned for the caller to merge, like every other download: nothing is written here.
  return { ok: true, buckets: report.outlines, stars: report.stars, statuses: report.statuses };
}
