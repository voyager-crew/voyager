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

import { pageSelectorSettings } from './pageSelectorSettings';

interface PageSelectorStartupInput {
  readonly url: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
}

export interface PageSelectorStartup {
  readonly ready: Promise<void>;
  readonly useAvailableSnapshot: () => void;
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

/** Reuse PluginHost's adapter/settings reads; no additional storage gate on the bundled path. */
export function startPageSelectors(input: PageSelectorStartupInput): PageSelectorStartup {
  const host = locatorHost(input.url);
  if (!host || !isRemotePluginCatalogEnabledAtBuild() || input.lifetime.aborted) {
    // Nothing is read here, so there is no phase to retire; stop only ends isCurrent.
    let stopped = false;
    return {
      ready: Promise.resolve(),
      useAvailableSnapshot: () => {},
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
  let availableAdapter: SiteAdapter | null | undefined;
  const adapterRead = loadHostCatalogCache(host).then((entry) => {
    const override = siteAdapterFromEntry(entry, EXTENSION_VERSION);
    const candidate = resolveSiteAdapterForUrl(input.url, registry, override);
    availableAdapter = candidate;
    return candidate;
  });
  const hydration = initializeSiteSelectors(siteId, {
    host,
    doc: input.doc,
    lifetime: input.lifetime,
    readOnlineUpdates: async () =>
      (await legacySettings.load())[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] !== false,
    read: async () => {
      const candidate = await adapterRead;
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
  const ready = hydration.ready.then((settlement) => {
    if ((settlement !== 'read' && settlement !== 'available') || !hydration.isCurrent()) return;
    // Reuse the host's switch read, but never hold bundled feature startup behind it.
    void legacySettings.load().then(
      (settings) => {
        if (settings[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] !== false && hydration.isCurrent())
          sendCatalogRefreshRequest(host);
      },
      () => {}, // A retired extension cannot request a refresh; the host owns read diagnostics.
    );
  });
  const initialAdapter = hydration.ready.then(() => adapterRead);
  return {
    ready,
    useAvailableSnapshot: () => {
      // Consume completed storage reads synchronously; Promise plumbing is not another startup wait.
      const candidate = availableAdapter;
      const settings = legacySettings.current();
      if (settings?.[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED] === false) {
        hydration.useAvailableSnapshot(null);
      } else if (candidate === undefined) {
        hydration.useAvailableSnapshot();
      } else if (candidate === bundle || !hasSiteSelectorChanges(siteId, candidate)) {
        hydration.useAvailableSnapshot(null);
      } else {
        hydration.useAvailableSnapshot(settings === undefined ? undefined : candidate);
      }
    },
    initialAdapter,
    legacySettings,
    stop: hydration.stop,
    isCurrent: hydration.isCurrent,
  };
}
