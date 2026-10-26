/**
 * Plugin ecosystem, accent colours and the Local Bridge.
 * Merged into `StorageKeys` by `./index.ts`; keep this file import-free.
 */
export const PLUGIN_STORAGE_KEYS = {
  // Plugin ecosystem
  // Per-plugin install/enable state (chrome.storage.local). Shape:
  //   Record<pluginId, { enabled: boolean; installedAt: number }>
  // Stored in local (not sync) because the installed set can be sizeable; sync
  // quota is precious. Entitlement (purchased/locked) is NOT stored here — it
  // comes from the EntitlementProvider so it can be server-driven later.
  PLUGINS_STATE: 'gvPluginsState',
  // Registered external marketplace sources (git-based catalogs). Reserved for
  // the future remote-registry milestone; unused today.
  PLUGIN_MARKETPLACE_SOURCES: 'gvPluginMarketplaceSources',
  // LEGACY whole-catalog cache written by the retired MarketplacePluginSource
  // (chrome.storage.local). Shape: { manifests: PluginManifest[]; fetchedAt }.
  // No reader remains; the key is ignored and never cleaned (storage only grows).
  PLUGIN_CATALOG_CACHE: 'gvPluginCatalogCache',
  // Key PREFIX for the per-host remote plugin catalog cache
  // (chrome.storage.local). Full key: `${prefix}${location.host}`, e.g.
  // `gvPluginHostCatalog:chat.deepseek.com`. Shape: HostCatalogCacheEntry (see
  // src/features/plugins/remote/hostCatalogCache.ts). Network-derived per-device
  // data rebuilt on the next check; never backed up.
  PLUGIN_HOST_CATALOG_PREFIX: 'gvPluginHostCatalog:',
  // Master switch for checking voyager.nagi.fun for plugin catalog updates
  // (chrome.storage.sync, backed up). Off = the extension never contacts the
  // catalog host except for an explicit manual check in the popup.
  PLUGIN_ONLINE_UPDATES_ENABLED: 'gvPluginOnlineUpdatesEnabled',
  // Minimum spacing between automatic catalog checks per host:
  // '1h' | '6h' | '24h' | 'manual' (chrome.storage.sync, backed up).
  PLUGIN_CATALOG_CHECK_INTERVAL: 'gvPluginCatalogCheckInterval',
  // Plugin cards the user has collapsed in the popup list (string[] of plugin
  // ids). Local (not sync) — it's a per-device UI preference, not user data.
  PLUGIN_UI_COLLAPSED: 'gvPluginUiCollapsed',
  // Last plugin version the popup showed per plugin id (Record<id, version>,
  // chrome.storage.local). Drives the "updated" badge after a catalog change
  // (plan D11); per-device UI state, never backed up.
  PLUGIN_SEEN_VERSIONS: 'gvPluginSeenVersions',
  // User-authored declarative plugins imported from the popup
  // (chrome.storage.local). Shape: Record<'local.<id>', LocalPluginRecord> (see
  // src/features/plugins/local/localPluginStore.ts): the raw manifest with CSS
  // inlined, re-validated on every read. Device-local; Drive backup of the
  // manifests is a follow-up (their enable state rides PLUGINS_STATE).
  PLUGIN_LOCAL_MANIFESTS: 'gvPluginLocalManifests',
  // Per-site custom accent colour overrides (chrome.storage.sync, backed up).
  // Shape: Record<siteId, string> keyed by SiteAdapter id ('gemini' | 'claude'
  // | 'chatgpt' | 'aistudio' | ...). A site WITH an entry uses that
  // colour for the whole Voyager UI on that site; a site WITHOUT an entry falls
  // back to its default (Gemini = Everforest sage; others = adapter brandColor).
  ACCENT_COLORS: 'gvAccentColors',

  // Local Bridge (src/pages/background/bridge/). All five are chrome.storage.local,
  // written by the background only and never synced or backed up.
  // Pairing with `voyager serve`: { serverId, port, token, pairedAt }. The token is
  // a secret: read only in the background and never sent to a content script on
  // purpose, though content scripts can read storage.local themselves.
  BRIDGE_PAIRING: 'gvBridgePairing',
  // Highest bridge policy revision accepted so far: { revision, allow: OpName[] }.
  // Lets a later, older catalog never re-allow what a newer one denied.
  BRIDGE_POLICY_HIGH_WATER: 'gvBridgePolicyHighWater',
  // Op results the server could not take yet (JSON only, at most 16 / 1 MiB).
  BRIDGE_OUTBOX: 'gvBridgeOutbox',
  // true once the person allowed jobs to run side by side (popup bridge card); absent: one at a time.
  BRIDGE_PARALLEL: 'gvBridgeParallel',
  // How many jobs may run side by side while BRIDGE_PARALLEL is on: 2–10, absent = 3.
  BRIDGE_PARALLEL_JOBS: 'gvBridgeParallelJobs',
  // The ChatGPT plan each account's pages last showed, written by the Local Bridge content
  // script (chrome.storage.local, never synced or backed up). Keyed by a hash of the
  // account id; plan fields only, no id, e-mail or token — see
  // src/features/bridge/accountPlanStore.ts.
  BRIDGE_ACCOUNT_PLANS: 'gvBridgeAccountPlans',

  // Site check on Gemini and AI Studio (chrome.storage.sync, backed up, default off): the
  // switch of their packaged `voyager.*-site-check` plugins. Other sites use gvPluginsState.
  SITE_CHECK_ENABLED: 'gvSiteCheckEnabled',
} as const;
