import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import type { PluginManifest } from '@/features/plugins/types';

interface VisualEffectsAvailabilityInput {
  isPluginSite: boolean;
  activeSiteDomain: string;
  customWebsites: readonly string[];
  /** A plugin that is on holds this site's host access (see useSitePluginRuns). */
  sitePluginRuns: boolean;
  /** The tab's content script answered with the effect's plugin status. */
  pageRunsEffect: boolean;
}

/**
 * Native sites already ship with host access. A third-party site can show the
 * effect once Voyager's content script runs there: Prompt Manager covers it, or
 * a plugin that is on, by choice or by default, holds the site's host access.
 * Being on is not enough by itself: a builtin on by default may have no access,
 * and then no content script runs there to show the effect. A page whose
 * content script still runs keeps the row after its last plugin is turned off,
 * so an effect already falling there can still be switched off.
 */
export function canUseVisualEffects({
  isPluginSite,
  activeSiteDomain,
  customWebsites,
  sitePluginRuns,
  pageRunsEffect,
}: VisualEffectsAvailabilityInput): boolean {
  if (!isPluginSite) return true;
  if (!activeSiteDomain) return false;
  if (pageRunsEffect) return true;
  if (customWebsitesIncludeHost(customWebsites, activeSiteDomain)) return true;
  return sitePluginRuns;
}

/**
 * The manifests the official list shows for the page. A page no manifest can
 * match (chrome://, file://) still lists the effect: it is one shared choice,
 * and applies on the next page that can show it.
 */
export function withVisualEffectsManifest(
  siteScoped: readonly PluginManifest[],
  catalog: readonly PluginManifest[],
): readonly PluginManifest[] {
  const isEffects = (plugin: PluginManifest) => plugin.id === OFFICIAL_PLUGIN_IDS.visualEffects;
  if (siteScoped.some(isEffects)) return siteScoped;
  const effects = catalog.find(isEffects);
  return effects ? [...siteScoped, effects] : siteScoped;
}
