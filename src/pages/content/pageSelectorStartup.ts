import { initializeGeminiSelectors } from '@/core/gemini/selectors';
import { StorageKeys } from '@/core/types/common';
import { isRemotePluginCatalogEnabledAtBuild } from '@/features/plugins/remote/config';
import { loadPluginCatalogSettings } from '@/features/plugins/remote/hostCatalogSettings';
import {
  loadSiteOverrideForHost,
  resolveSiteAdapterForUrl,
} from '@/features/plugins/remote/siteOverride';
import { sendCatalogRefreshRequest } from '@/features/plugins/runtime/pluginHostOptions';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';
import { SiteRegistry } from '@/features/plugins/sites/registry';

interface PageSelectorStartupInput {
  readonly url: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
}

export interface PageSelectorStartup {
  readonly ready: Promise<void>;
  readonly stop: () => void;
  readonly isCurrent: () => boolean;
}

function locatorHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && isGeminiSelectorHost(parsed.host) ? parsed.host : null;
  } catch {
    return null;
  }
}

/** Only PluginHost and feature admission wait; ping, theme and page services stay synchronous. */
export function startPageGeminiSelectors(input: PageSelectorStartupInput): PageSelectorStartup {
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

  const settings = loadPluginCatalogSettings();
  const hydration = initializeGeminiSelectors({
    host,
    doc: input.doc,
    lifetime: input.lifetime,
    read: async () => {
      if (!(await settings).onlineUpdatesEnabled) return null;
      const override = await loadSiteOverrideForHost(host);
      return resolveSiteAdapterForUrl(input.url, SiteRegistry.createDefault(), override);
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
    if (settlement !== 'read') return;
    if ((await settings).onlineUpdatesEnabled && hydration.isCurrent()) {
      sendCatalogRefreshRequest(host);
    }
  });
  return { ready, stop: hydration.stop, isCurrent: hydration.isCurrent };
}
