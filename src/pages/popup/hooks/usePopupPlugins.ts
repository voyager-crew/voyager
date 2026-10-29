import { useCallback, useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  type DiagnosticPluginInput,
  STORAGE_DERIVED_BASIS,
  diagnosticPluginSourceFromId,
} from '@/core/services/DiagnosticsExportService';
import { subscribeLocalPlugins } from '@/features/plugins/local/localPluginStore';
import { subscribeHostCatalog } from '@/features/plugins/remote/hostCatalogCache';
import { catalogHostFromUrl } from '@/features/plugins/remote/hostCatalogPolicy';
import { loadSiteOverrideForHost } from '@/features/plugins/remote/siteOverride';
import { legacyBoundSettings } from '@/features/plugins/runtime/legacySnapshotFeed';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_STATUS_MESSAGE,
} from '@/features/plugins/runtime/messages';
import type { PluginStatus } from '@/features/plugins/runtime/pluginStatus';
import { surfaceSwitchForUrl } from '@/features/plugins/runtime/surfaceSwitch';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import {
  type BlockedPluginUpdate,
  type SourcedPluginManifest,
  listPluginManifestsWithSources,
  refreshPluginManifestsWithSources,
} from '@/features/plugins/sources/defaultSources';
import { effectivePluginView } from '@/features/plugins/storage/effectivePluginView';
import {
  type LegacySettingSnapshot,
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '@/features/plugins/storage/legacySettingBindings';
import {
  type PluginStateMap,
  loadPluginState,
  subscribePluginState,
} from '@/features/plugins/storage/pluginState';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';

import { POPUP_LEGACY_SNAPSHOT_KEYS } from '../officialPlugins/officialPluginRegistry';
import { withFormFactorStatuses } from '../utils/formFactorStatuses';
import { isSelfClearingBlock } from '../utils/releasingStatus';
import type { CurrentTab } from './currentTab';
import { usePopupFormFactor } from './usePopupFormFactor';

// A plugin waiting for a runtime to shut down, or for the official plugin's
// legacy switch to be read (`pending`), starts without any storage change the
// popup could observe, so it re-asks while one is waiting, up to a bound: a
// disposer that never settles keeps its plugin waiting for good.
const RELEASE_POLL_INTERVAL_MS = 1000;
const RELEASE_POLL_LIMIT = 10;

export type PopupPluginsContext = CurrentTab;

/** Plugin catalog, installed state and active-tab status for one popup lifetime. */
export function usePopupPlugins({
  activeUrl,
  activeTabContextLoaded,
  requestTab,
}: PopupPluginsContext) {
  const [pluginManifests, setPluginManifests] = useState<readonly PluginManifest[]>([]);
  const [pluginSourceIds, setPluginSourceIds] = useState<Readonly<Record<string, string>>>({});
  const [pluginBlockedUpdates, setPluginBlockedUpdates] = useState<
    Readonly<Record<string, BlockedPluginUpdate>>
  >({});
  // Site adapter published for the active host through the remote catalog, if
  // any; it replaces the bundled adapter's label and brand colour.
  const [pluginSiteOverride, setPluginSiteOverride] = useState<SiteAdapter | null>(null);
  // Statuses computed by the active tab's PluginHost (D8); empty when
  // the tab has no content script, in which case the card infers locally.
  const [pluginStatuses, setPluginStatuses] = useState<readonly PluginStatus[]>([]);
  const [pluginState, setPluginState] = useState<PluginStateMap>({});
  const [pluginStateLoaded, setPluginStateLoaded] = useState(false);
  const [pluginsLoading, setPluginsLoading] = useState<boolean>(true);
  const [pluginsRefreshing, setPluginsRefreshing] = useState<boolean>(false);
  // The legacy switches packaged official plugins follow instead of their
  // plugin-state entry, and a counter bumped when AI Studio's master switch
  // flips: either change can mount or unmount plugins in the active tab. The
  // official plugin list reads the same live copy.
  const [legacySettings, setLegacySettings] = useState<LegacySettingSnapshot>({});
  const [legacySettingsLoaded, setLegacySettingsLoaded] = useState(false);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const formFactor = usePopupFormFactor();

  // Plugins whose match patterns cover the active tab's URL. A plugin only ever
  // shows on — and only affects — the site it targets, so Claude plugins appear
  // only on Claude, ChatGPT plugins only on ChatGPT, and neither on Gemini.
  const siteScopedManifests = useMemo(
    () => pluginManifests.filter((plugin) => matchesAnyPattern(activeUrl, plugin.matches)),
    [activeUrl, pluginManifests],
  );
  // A plugin this device cannot run says so even when the tab reports nothing.
  const shownStatuses = useMemo(
    () => withFormFactorStatuses(pluginStatuses, pluginManifests, formFactor),
    [pluginStatuses, pluginManifests, formFactor],
  );
  const diagnosticPlugins = useMemo<readonly DiagnosticPluginInput[]>(
    () =>
      pluginManifests.map((plugin): DiagnosticPluginInput => {
        const state = pluginState[plugin.id];
        // A bound official plugin runs on its legacy values, not on its plugin-state entry.
        // The popup derives them from storage alone: the page's own history (a value
        // removed live keeps its last number there, a live chat-width change stops the
        // switch derivation) is not visible here, and the page reports no effective
        // values, so these are labelled storage-derived rather than passed off as the page's.
        const bound = legacyBoundSettings(plugin.id, legacySettings);
        // A coverage-bound switch reads the open page's own host there (an alias keeps its own).
        const url = matchesAnyPattern(activeUrl, plugin.matches) ? activeUrl : undefined;
        return {
          id: plugin.id,
          version: plugin.version,
          source: diagnosticPluginSourceFromId(pluginSourceIds[plugin.id]),
          enabled: effectivePluginView(plugin, pluginState, legacySettings, url).enabled,
          settingsSchema: plugin.contributes.settings,
          settings: bound ?? state?.settings,
          ...(bound ? { basis: STORAGE_DERIVED_BASIS } : {}),
        };
      }),
    [activeUrl, legacySettings, pluginManifests, pluginSourceIds, pluginState],
  );
  // Host of the active tab for the per-host remote plugin catalog; undefined
  // until the tab is known and for hosts that can never have a catalog file.
  const pluginCatalogHost = useMemo(() => catalogHostFromUrl(activeUrl), [activeUrl]);

  const applyPluginRecords = useCallback((records: readonly SourcedPluginManifest[]) => {
    setPluginManifests(records.map(({ manifest }) => manifest));
    setPluginSourceIds(
      Object.fromEntries(records.map(({ manifest, sourceId }) => [manifest.id, sourceId])),
    );
    setPluginBlockedUpdates(
      Object.fromEntries(
        records.flatMap(({ manifest, blockedUpdate }) =>
          blockedUpdate ? [[manifest.id, blockedUpdate] as const] : [],
        ),
      ),
    );
  }, []);

  const refresh = useCallback(async () => {
    setPluginsRefreshing(true);
    try {
      // Manual checks bypass the interval and backoff; the background still
      // enforces the shared online-updates switch. The popup only re-reads
      // the cache afterwards.
      if (pluginCatalogHost) {
        try {
          await browser.runtime.sendMessage({
            type: PLUGIN_CATALOG_REFRESH_MESSAGE,
            payload: { host: pluginCatalogHost, force: true },
          });
        } catch {
          // Background unavailable; fall through and re-read what is cached.
        }
      }
      applyPluginRecords(
        await refreshPluginManifestsWithSources({ url: activeUrl, host: pluginCatalogHost }),
      );
    } finally {
      setPluginsRefreshing(false);
    }
  }, [activeUrl, applyPluginRecords, pluginCatalogHost]);

  // Ask the active tab's PluginHost for plugin statuses (needs-engine,
  // needs-handler, mounted, no-effect, blocked, pending version …). The health
  // verdict arrives once the page has been quiet for a while, so poll once
  // more shortly after opening. A tab without a content script simply answers
  // nothing and the card falls back to local inference.
  const refreshPluginStatuses = useCallback(async (): Promise<readonly PluginStatus[] | null> => {
    if (requestTab === null) return null;
    try {
      const response = (await requestTab({ type: PLUGIN_STATUS_MESSAGE })) as
        | { ok?: boolean; statuses?: readonly PluginStatus[] }
        | undefined;
      if (response?.ok && Array.isArray(response.statuses)) {
        setPluginStatuses(response.statuses);
        return response.statuses;
      }
    } catch {
      // No content script in this tab (not a plugin site, or not injected yet).
    }
    return null;
  }, [requestTab]);

  useEffect(() => {
    let active = true;
    let releasePolls = 0;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      const statuses = await refreshPluginStatuses();
      if (!active || !statuses?.some(isSelfClearingBlock)) return;
      if (releaseTimer !== undefined || releasePolls >= RELEASE_POLL_LIMIT) return;
      releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        releasePolls += 1;
        void ask();
      }, RELEASE_POLL_INTERVAL_MS);
    };
    void ask();
    const later = setTimeout(() => void ask(), 2500);
    return () => {
      active = false;
      clearTimeout(later);
      clearTimeout(releaseTimer);
    };
  }, [refreshPluginStatuses, pluginManifests, pluginState, legacySettings, surfaceRevision]);

  useEffect(() => {
    let active = true;
    // Subscribe first: a change that lands during the read wins over it.
    let touched: LegacySettingSnapshot = {};
    // The official plugin list's option panels show their own keys from the same snapshot.
    const unsubscribe = subscribeLegacySettings((changed) => {
      if (!active) return;
      touched = { ...touched, ...changed };
      setLegacySettings((current) => ({ ...current, ...changed }));
    }, POPUP_LEGACY_SNAPSHOT_KEYS);
    loadLegacySettingSnapshot(POPUP_LEGACY_SNAPSHOT_KEYS).then(
      (loaded) => {
        if (!active) return;
        setLegacySettings({ ...loaded, ...touched });
        setLegacySettingsLoaded(true);
      },
      () => {
        // Extension context gone: the popup is closing anyway.
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => surfaceSwitchForUrl(activeUrl)?.subscribe(() => setSurfaceRevision((n) => n + 1)),
    [activeUrl],
  );

  // Load plugin manifests: builtin + bundled snapshot + the cached remote
  // catalog for the active tab's host + the user's local plugins. Waits for the tab context so the remote
  // tier is read for the right host, and re-reads whenever the background
  // writes a CHANGED catalog for that host.
  useEffect(() => {
    if (!activeTabContextLoaded) return;
    let active = true;
    const context = { url: activeUrl, host: pluginCatalogHost };
    const load = (): void => {
      void listPluginManifestsWithSources(undefined, context)
        .then((records) => {
          if (active) applyPluginRecords(records);
        })
        .finally(() => {
          if (active) setPluginsLoading(false);
        });
      void loadSiteOverrideForHost(pluginCatalogHost).then((override) => {
        if (active) setPluginSiteOverride(override);
      });
    };
    load();
    const unsubscribe = pluginCatalogHost
      ? subscribeHostCatalog(pluginCatalogHost, load)
      : () => {};
    // An imported, updated or removed local plugin changes the list too.
    const unsubscribeLocal = subscribeLocalPlugins(load);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeLocal();
    };
  }, [activeTabContextLoaded, activeUrl, applyPluginRecords, pluginCatalogHost]);

  useEffect(() => {
    let active = true;
    void loadPluginState().then((state) => {
      if (active) {
        setPluginState(state);
        setPluginStateLoaded(true);
      }
    });
    const unsubscribe = subscribePluginState((state) => {
      if (active) setPluginState(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    pluginManifests,
    pluginSourceIds,
    pluginBlockedUpdates,
    pluginSiteOverride,
    pluginStatuses: shownStatuses,
    pluginState,
    pluginStateLoaded,
    legacySettings,
    legacySettingsLoaded,
    pluginsLoading,
    pluginsRefreshing,
    pluginCatalogHost,
    siteScopedManifests,
    diagnosticPlugins,
    formFactor,
    refresh,
  };
}
