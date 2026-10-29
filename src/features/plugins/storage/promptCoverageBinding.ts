/** Prompt Manager's catalog switch is a view of the existing coverage list. */
import { StorageKeys } from '@/core/types/common';
import {
  customWebsitesIncludeHost,
  normalizeCustomWebsite,
  sanitizeCustomWebsites,
} from '@/core/utils/customWebsites';

import { BUNDLED_SITE_ADAPTERS, listBundledPluginEntries } from '../catalog/sites';
import { usesCatalogDataStores } from '../sites/hostPolicy';
import { matchesAnyPattern } from '../sites/matchPattern';
import type { SiteAdapter } from '../types';
import { withPluginStorageLock } from './pluginStorageLock';

export interface PromptCoverageBinding {
  readonly pluginId: string;
  /** The actual page host, including its port; aliases keep independent coverage. */
  readonly host: string;
  readonly area: 'sync';
  readonly key: typeof StorageKeys.PROMPT_CUSTOM_WEBSITES;
  read(stored: unknown): boolean;
  /** Preserve unrelated entries and the current string-array format. */
  write(stored: unknown, enabled: boolean): string[];
}

const declarations = listBundledPluginEntries().filter(
  (entry) => entry.pluginDir === 'prompt-manager' && usesCatalogDataStores(entry.siteDir),
);
const sites: ReadonlyMap<string, SiteAdapter> = new Map(
  BUNDLED_SITE_ADAPTERS.filter((site) =>
    declarations.some((entry) => entry.siteDir === site.id),
  ).map((site) => [`voyager.${site.id}-prompt-manager`, site]),
);

/**
 * A bundled Prompt Manager plugin's coverage binding. Pass the page URL when
 * viewing a host alias; without it, a site-wide UI uses the first bundled host.
 * Native surfaces and plugins without a bundled declaration have no binding.
 */
export function promptCoverageBindingFor(
  pluginId: string,
  url?: string,
): PromptCoverageBinding | null {
  const site = sites.get(pluginId);
  if (!site) return null;
  const page = url ?? site.matches[0]?.replace(/\*$/, '');
  if (!page || !matchesAnyPattern(page, site.matches)) return null;
  const host = new URL(page).host;
  const website = normalizeCustomWebsite(host);
  if (!website) return null;
  return {
    pluginId,
    host,
    area: 'sync',
    key: StorageKeys.PROMPT_CUSTOM_WEBSITES,
    read: (stored) => customWebsitesIncludeHost(stored, host),
    write: (stored, enabled) => {
      const current = sanitizeCustomWebsites(stored);
      if (enabled)
        return customWebsitesIncludeHost(current, host) ? current : [...current, website];
      // The old format has no exclusions: deleting inherited coverage would
      // also switch off other custom hosts or ports. Leave that entry intact.
      if (current.some((item) => item !== website && customWebsitesIncludeHost([item], host))) {
        throw new Error(`Prompt Manager coverage for ${host} is inherited from a broader entry`);
      }
      return current.filter((item) => item !== website);
    },
  };
}

/** Lookup for a popup/panel viewing a concrete page; no site list is duplicated. */
export function promptCoverageBindingForUrl(url: string): PromptCoverageBinding | null {
  for (const [id, site] of sites) {
    if (matchesAnyPattern(url, site.matches)) return promptCoverageBindingFor(id, url);
  }
  return null;
}

/**
 * Strict read-modify-write: a failed read writes nothing. This changes only the
 * coverage key, never permissions, prompt data or gvPluginsState. Extension
 * contexts share the existing plugin-storage lock; page UIs use their bridge.
 */
export async function setPromptCoverageEnabled(
  binding: PromptCoverageBinding,
  enabled: boolean,
): Promise<void> {
  await withPluginStorageLock(async () => {
    const stored = await chrome.storage.sync.get(binding.key);
    await chrome.storage.sync.set({ [binding.key]: binding.write(stored[binding.key], enabled) });
  });
}
