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

async function readLocalValues(): Promise<Record<string, unknown>> {
  return (await chrome.storage.local.get(null)) as Record<string, unknown>;
}

/** Bundled catalog sites plus any site this device already holds outlines or stars for. */
async function knownCatalogSites(store: StarStore | undefined): Promise<Set<string>> {
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
  const sites = catalogStarSites(await store.getSyncSnapshot(null));
  return [...sites].filter((site) => allowed === 'all' || allowed.has(site)).sort();
}

export async function handleCatalogTimelineSyncMessage(
  type: string,
  payload: { interactive?: boolean; stars?: boolean } | undefined,
  sender: chrome.runtime.MessageSender,
  starStore: StarStore | undefined,
  drive: GoogleDriveSyncTransfer,
): Promise<unknown> {
  const allowed = sitesForSender(sender);
  if (!allowed) return { ok: false, error: 'untrusted_sender' };
  const interactive = payload?.interactive !== false;

  if (type === CATALOG_TIMELINE_PUSH_MESSAGE) {
    if (allowed !== 'all' && allowed.size === 0) return { ok: true, sites: [], starSites: [] };
    const bySite = collectCatalogTimelineBuckets(
      await readLocalValues(),
      allowed === 'all' ? undefined : allowed,
    );
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
    return { ok: true, sites, starSites };
  }

  const sites = [...(allowed === 'all' ? await knownCatalogSites(starStore) : allowed)].sort();
  if (sites.length === 0) return { ok: true, buckets: {}, stars: {} };
  const buckets = await drive.downloadCatalogTimeline(sites, interactive);
  if (!buckets) return failure(drive, 'Timeline outline download failed');
  const stars = await drive.downloadCatalogStars(sites, interactive);
  if (!stars) return failure(drive, 'Catalog star download failed');
  // Returned for the caller to merge, like every other download: nothing is written here.
  return { ok: true, buckets, stars };
}
