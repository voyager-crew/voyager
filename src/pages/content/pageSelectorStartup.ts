import { initializeSiteSelectors, locatorSiteForHost } from '@/core/selectors';
import { hasSiteSelectorChanges } from '@/core/selectors/service';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { isRemotePluginCatalogEnabledAtBuild } from '@/features/plugins/remote/config';
import {
  loadHostCatalogCache,
  siteAdapterFromEntry,
} from '@/features/plugins/remote/hostCatalogCache';
import { resolveSiteAdapterForUrl } from '@/features/plugins/remote/siteOverride';
import type { LegacySettingsSource } from '@/features/plugins/runtime/legacySnapshotFeed';
import { sendCatalogRefreshRequest } from '@/features/plugins/runtime/pluginHostOptions';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { SiteAdapter } from '@/features/plugins/types';

import { startPageSelectorAdapter } from './pageSelectorAdapter';
import { pageSelectorSettings } from './pageSelectorSettings';

interface PageSelectorStartupInput {
  readonly url: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
}

export interface PageSelectorStartup {
  readonly ready: Promise<void>;
  readonly stop: () => void;
  readonly isCurrent: () => boolean;
  readonly initialAdapter?: Promise<SiteAdapter | null>;
  readonly legacySettings?: LegacySettingsSource;
}

function locatorHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && locatorSiteForHost(parsed.host) ? parsed.host : null;
  } catch {
    return null;
  }
}

/** Share PluginHost's reads and bound the first page-locator consumer by hydration.ready. */
export function startPageSelectors(input: PageSelectorStartupInput): PageSelectorStartup {
  const host = locatorHost(input.url);
  if (!host || !isRemotePluginCatalogEnabledAtBuild() || input.lifetime.aborted) {
    // Nothing is read here, so there is no phase to retire; stop only ends isCurrent.
    let stopped = false;
    return {
      ready: Promise.resolve(),
      stop: () => {
        stopped = true;
      },
      isCurrent: () => !stopped && !input.lifetime.aborted,
    };
  }

  const siteId = locatorSiteForHost(host)!;
  const registry = SiteRegistry.createDefault();
  const bundle = registry.resolveByUrl(input.url);
  const legacySettings = pageSelectorSettings(input.url);
  // Adapter precedence is identical at startup and reload, even when locator hydration is OFF.
  const adapter = startPageSelectorAdapter({
    bundled: bundle,
    lifetime: input.lifetime,
    read: async () => {
      const entry = await loadHostCatalogCache(host);
      const override = siteAdapterFromEntry(entry, EXTENSION_VERSION);
      return resolveSiteAdapterForUrl(input.url, registry, override);
    },
  });
  const hydration = initializeSiteSelectors(siteId, {
    host,
    doc: input.doc,
    lifetime: input.lifetime,
    readOnlineUpdates: async () =>
      (await legacySettings.load())[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] !== false,
    read: async () => {
      const { adapter: candidate } = await adapter.ready;
      // A missing/stale cache needs no switch read before starting the page.
      if (candidate === bundle || !hasSiteSelectorChanges(siteId, candidate)) {
        return null;
      }
      const settings = await legacySettings.load();
      if (settings[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] === false) return null;
      return candidate;
    },
    // An OFF event retires a pending ON read before it can install the catalog snapshot.
    invalidatedBy: (invalidate) => {
      const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'sync' && StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED in changes) invalidate();
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    },
  });
  const ready = hydration.ready.then(async (settlement) => {
    if (settlement !== 'read' || !hydration.isCurrent()) return;
    if ((await adapter.ready).by !== 'read') return;
    // Reuse the host's switch read, but never hold bundled feature startup behind it.
    void legacySettings.load().then(
      (settings) => {
        if (settings[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] !== false && hydration.isCurrent())
          sendCatalogRefreshRequest(host);
      },
      () => {}, // A retired extension cannot request a refresh; the host owns read diagnostics.
    );
  });
  const initialAdapter = hydration.ready.then(async () => (await adapter.ready).adapter);
  return {
    ready,
    initialAdapter,
    legacySettings,
    stop: () => {
      adapter.stop();
      hydration.stop();
    },
    isCurrent: hydration.isCurrent,
  };
}
