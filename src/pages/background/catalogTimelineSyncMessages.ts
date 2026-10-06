/**
 * Background side of catalog outline sync (`gv.sync.catalogTimeline.*`). An extension page (the
 * popup) syncs every catalog site; a content script syncs only the catalog site it runs on, so a
 * ChatGPT page never reads or uploads Claude outlines. Gemini and AI Studio pages have none.
 */
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import { FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { NATIVE_SITE_IDS, resolvePluginPlatformId } from '@/features/plugins/sites/registry';
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

/** Bundled catalog sites plus any site this device already holds outlines for. */
async function knownCatalogSites(): Promise<Set<string>> {
  const sites = new Set(
    BUNDLED_SITE_ADAPTERS.map((adapter) => adapter.id).filter(
      (id) => !NATIVE_SITE_IDS.has(id) && isCatalogSiteId(id),
    ),
  );
  for (const key of Object.keys(await readLocalValues())) {
    const site = catalogHierarchySiteOf(key);
    if (site) sites.add(site);
  }
  return sites;
}

async function failure(fallback: string) {
  const state = await googleDriveSyncService.getState();
  return { ok: false, error: state.error ?? fallback, state };
}

export function isCatalogTimelineSyncMessage(type: string): boolean {
  return type === CATALOG_TIMELINE_PUSH_MESSAGE || type === CATALOG_TIMELINE_PULL_MESSAGE;
}

export async function handleCatalogTimelineSyncMessage(
  type: string,
  payload: { interactive?: boolean } | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const allowed = sitesForSender(sender);
  if (!allowed) return { ok: false, error: 'untrusted_sender' };
  const interactive = payload?.interactive !== false;

  if (type === CATALOG_TIMELINE_PUSH_MESSAGE) {
    if (allowed !== 'all' && allowed.size === 0) return { ok: true, sites: [] };
    const bySite = collectCatalogTimelineBuckets(
      await readLocalValues(),
      allowed === 'all' ? undefined : allowed,
    );
    const sites = Object.keys(bySite);
    // Nothing local to add: no Drive call, so no sign-in prompt either.
    if (sites.length === 0) return { ok: true, sites };
    if (!(await googleDriveSyncService.uploadCatalogTimeline(bySite, interactive))) {
      return failure('Timeline outline upload failed');
    }
    return { ok: true, sites };
  }

  const sites = [...(allowed === 'all' ? await knownCatalogSites() : allowed)].sort();
  if (sites.length === 0) return { ok: true, buckets: {} };
  const buckets = await googleDriveSyncService.downloadCatalogTimeline(sites, interactive);
  if (!buckets) return failure('Timeline outline download failed');
  // Returned for the caller to merge, like every other download: nothing is written here.
  return { ok: true, buckets };
}
