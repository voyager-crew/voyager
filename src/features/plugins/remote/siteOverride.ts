/**
 * Remote site override: the `site` section of a published per-host
 * catalog file can replace the bundled adapter for that host, so a selector
 * or brand-colour fix reaches users without a release.
 *
 * Precedence is decided here, once, for every consumer (PluginHost, the brand
 * theme, the popup): a covering, valid, same-version remote site wins only
 * when its catalog revision is strictly newer. Bundled data wins every tie.
 */
import { overlayPublishedSemanticSelectors } from '@/core/selectors/semanticProfiles';
import { logger } from '@/core/services/LoggerService';
import { EXTENSION_VERSION } from '@/core/utils/version';

import { packagedSiteForUrl } from '../sites/hostPolicy';
import { matchesAnyPattern } from '../sites/matchPattern';
import type { SiteRegistry } from '../sites/registry';
import type { PluginSource, PluginSourceContext, SiteAdapter } from '../types';
import { isRemotePluginCatalogEnabledAtBuild } from './config';
import { loadHostCatalogCache, siteAdapterFromEntry } from './hostCatalogCache';
import { protectSiteAdapterIdentity } from './siteIdentity';

/** First site override any source offers for this context, or null. */
export async function resolveSiteOverride(
  sources: readonly PluginSource[],
  context: PluginSourceContext | undefined,
): Promise<SiteAdapter | null> {
  for (const source of sources) {
    if (!source.siteOverride) continue;
    try {
      const adapter = await source.siteOverride(context);
      if (adapter) return adapter;
    } catch (error) {
      logger.warn('Plugin source site override failed', {
        source: source.id,
        error: String(error),
      });
    }
  }
  return null;
}

/** The adapter for `url`: the override when it covers the page, else the bundled one. */
export function resolveSiteAdapterForUrl(
  url: string,
  registry: SiteRegistry,
  override: SiteAdapter | null,
): SiteAdapter | null {
  if (override && matchesAnyPattern(url, override.matches)) {
    const bundled = registry.resolveByUrl(url);
    // A remote matches list cannot introduce a host or borrow another site’s identity.
    if (!bundled || bundled.id !== override.id) return bundled;
    // A later fetch of stale published data must not replace newer packaged selectors.
    if ((override.catalogRevision ?? 0) > (bundled?.catalogRevision ?? 0)) {
      if (packagedSiteForUrl(url) !== null) {
        if (!bundled || bundled.id !== packagedSiteForUrl(url)) {
          return registry.resolveByUrl(url);
        }
        return {
          ...bundled,
          catalogRevision: override.catalogRevision,
          selectors: overlayPublishedSemanticSelectors(
            bundled.id,
            bundled.selectors,
            override.selectors,
          ),
          locators: override.locators,
        };
      }
      return protectSiteAdapterIdentity(bundled, override);
    }
  }
  return registry.resolveByUrl(url);
}

/**
 * Read the cached override for a host directly from storage (for consumers
 * that do not go through plugin sources, such as the brand theme and popup).
 */
export async function loadSiteOverrideForHost(
  host: string | undefined,
  extensionVersion: string = EXTENSION_VERSION,
): Promise<SiteAdapter | null> {
  // A stale legacy cache must never open the packaged sites' adapter boundary.
  if (!host || !isRemotePluginCatalogEnabledAtBuild()) return null;
  return siteAdapterFromEntry(await loadHostCatalogCache(host), extensionVersion);
}

/**
 * Two adapters describe the same site when their data is identical. `bridge`
 * is left out on purpose: the background reads the bridge policy from the
 * cache itself, and comparing it here would remount every plugin on the site
 * whenever the policy changed.
 */
export function isSameSiteAdapter(a: SiteAdapter | null, b: SiteAdapter | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.brandColor === b.brandColor &&
    a.conversationIdPattern === b.conversationIdPattern &&
    JSON.stringify(a.export ?? null) === JSON.stringify(b.export ?? null) &&
    JSON.stringify(a.matches) === JSON.stringify(b.matches) &&
    JSON.stringify(a.selectors) === JSON.stringify(b.selectors) &&
    // The send tracker reads turn keys through this list; a change must rebuild it.
    JSON.stringify(a.turnKeyAttributes ?? []) === JSON.stringify(b.turnKeyAttributes ?? []) &&
    JSON.stringify(a.theme) === JSON.stringify(b.theme) &&
    JSON.stringify([...a.capabilities].sort()) === JSON.stringify([...b.capabilities].sort()) &&
    JSON.stringify(a.modelPicker ?? null) === JSON.stringify(b.modelPicker ?? null) &&
    JSON.stringify(a.projects ?? null) === JSON.stringify(b.projects ?? null) &&
    JSON.stringify(a.pageHooks ?? null) === JSON.stringify(b.pageHooks ?? null) &&
    JSON.stringify(a.folders ?? null) === JSON.stringify(b.folders ?? null)
  );
}
