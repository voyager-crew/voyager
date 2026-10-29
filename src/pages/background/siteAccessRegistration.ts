import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { isFirefox } from '@/core/utils/browser';
import {
  customWebsiteOriginPatterns,
  customWebsitesIncludeHost,
  sanitizeCustomWebsites,
} from '@/core/utils/customWebsites';
import { isChatGptProUsageSupported } from '@/features/plugins/builtin/chatgptProUsage/manifest';
import {
  partitionPluginOriginPatterns,
  pluginsToOriginPatterns,
} from '@/features/plugins/runtime/siteRegistration';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { listPluginManifests } from '@/features/plugins/sources/defaultSources';
import type { PluginManifest } from '@/features/plugins/types';

import {
  BRIDGE_ACCOUNT_MAIN_SCRIPT_ID,
  isBridgeAccountObserverSupported,
  syncBridgeAccountObserver,
} from './bridge/accountObserverRegistration';
import {
  CHATGPT_PRO_USAGE_MAIN_SCRIPT_ID,
  syncChatGptProUsageObserver,
} from './chatgptProUsageRegistration';
import { unregisterRegisteredContentScripts } from './contentScriptRegistration';
import { loadEnabledPlugins } from './enabledPlugins';
import { createPromptNudgeRegistration } from './promptNudgeRegistration';
import { syncShadowKeyGuardRegistration } from './shadowKeyGuardRegistration';

const CUSTOM_CONTENT_SCRIPT_ID = 'gv-custom-content-script';
const PLUGIN_CONTENT_SCRIPT_ID = 'gv-plugin-content-script';
const PLUGIN_EMBEDDED_CONTENT_SCRIPT_ID = 'gv-plugin-embedded-content-script';
const CLAUDE_USAGE_MAIN_SCRIPT_ID = 'gv-plugin-claude-usage-main';
const CUSTOM_WEBSITE_KEY = 'gvPromptCustomWebsites';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether the list has an entry for `host` already: the host on any port, or a parent domain. */
function hasEntryForHost(entries: readonly unknown[], host: string): boolean {
  return (
    customWebsitesIncludeHost(entries, host) ||
    sanitizeCustomWebsites(entries).some((entry) => entry.replace(/:\d+$/, '') === host)
  );
}

export function createSiteAccessRegistration() {
  const MANIFEST_DEFAULT_DOMAINS = new Set(
    [
      ...(chrome.runtime.getManifest().host_permissions || []),
      ...(chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.matches || []) || []),
    ]
      .map(patternToDomain)
      .filter((d): d is string => !!d),
  );

  // Domains targeted by plugins. Granting one of these (when a user
  // enables a plugin) must NOT also register it as a Prompt-Manager "custom
  // website", so we exclude them from the permissions.onAdded → custom-website
  // merge below. Populated asynchronously from the cached catalog (see
  // refreshPluginSiteDomains).
  let pluginSiteDomains = new Set<string>();

  async function loadPluginCatalog(): Promise<readonly PluginManifest[]> {
    try {
      return await listPluginManifests();
    } catch {
      return [];
    }
  }

  async function refreshPluginSiteDomains(): Promise<void> {
    const catalog = await loadPluginCatalog();
    pluginSiteDomains = new Set(
      pluginsToOriginPatterns(catalog)
        .map(patternToDomain)
        .filter((d): d is string => !!d),
    );
  }

  function patternToDomain(pattern: string | undefined): string | null {
    if (!pattern) return null;
    try {
      const withoutScheme = pattern.replace(/^[^:]+:\/\//, '');
      const hostPart = withoutScheme.replace(/\/.*$/, '').replace(/^\*\./, '');
      if (!hostPart || hostPart === '*') return null;
      return hostPart;
    } catch {
      return null;
    }
  }

  function toMatchPatterns(domain: string): string[] {
    return customWebsiteOriginPatterns(domain) ?? [];
  }

  function toRelativeExtensionPath(resource: string): string {
    try {
      const url = new URL(resource);
      if (url.protocol === 'moz-extension:') {
        return url.pathname.replace(/^\/+/, '');
      }
    } catch {
      // Not an absolute extension URL; fall through.
    }

    return resource.replace(/^\/+/, '');
  }

  function extractDomainsFromOrigins(origins?: string[]): string[] {
    if (!Array.isArray(origins)) return [];
    const domains = origins
      .map(patternToDomain)
      .filter((d): d is string => !!d)
      // The Local Bridge pairing grants http://127.0.0.1/*; loopback is never a prompt site.
      .filter((d) => !LOOPBACK_HOSTS.has(d))
      .filter((d) => !MANIFEST_DEFAULT_DOMAINS.has(d))
      .filter((d) => !pluginSiteDomains.has(d));
    return Array.from(new Set(domains));
  }

  async function filterGrantedOrigins(patterns: string[]): Promise<string[]> {
    const granted: string[] = [];

    for (const origin of patterns) {
      try {
        const hasPermission = await browser.permissions.contains({ origins: [origin] });
        if (hasPermission) {
          granted.push(origin);
        }
      } catch (error) {
        console.warn('[Background] Failed to check permission for', origin, error);
      }
    }

    return granted;
  }

  // Serialized for the same reason as the plugin sync below: storage and
  // permission listeners can both fire at once and double-inject.
  let customContentScriptSyncQueue: Promise<void> = Promise.resolve();

  function syncCustomContentScripts(domains?: string[]): Promise<void> {
    const next = customContentScriptSyncQueue.then(() => doSyncCustomContentScripts(domains));
    customContentScriptSyncQueue = next.catch(() => {});
    return next;
  }

  async function doSyncCustomContentScripts(domains?: string[]): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;

    const manifestContentScript = chrome.runtime.getManifest().content_scripts?.[0];
    if (!manifestContentScript) return;

    const domainList =
      domains ??
      (
        await chrome.storage.sync.get({
          [CUSTOM_WEBSITE_KEY]: [],
        })
      )[CUSTOM_WEBSITE_KEY];

    const matchPatterns = Array.from(
      new Set(
        (Array.isArray(domainList) ? domainList : []).flatMap(toMatchPatterns).filter(Boolean),
      ),
    );

    const grantedMatches = await filterGrantedOrigins(matchPatterns);

    try {
      await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_CONTENT_SCRIPT_ID] });
    } catch {
      // No-op if script was not registered
    }

    if (!grantedMatches.length) return;

    const runAt =
      manifestContentScript.run_at === 'document_start'
        ? 'document_start'
        : manifestContentScript.run_at === 'document_end'
          ? 'document_end'
          : 'document_idle';

    const jsResources = isFirefox()
      ? (manifestContentScript.js || []).map(toRelativeExtensionPath)
      : manifestContentScript.js || [];
    const cssResources = isFirefox()
      ? manifestContentScript.css?.map(toRelativeExtensionPath)
      : manifestContentScript.css;

    try {
      await chrome.scripting.registerContentScripts([
        {
          id: CUSTOM_CONTENT_SCRIPT_ID,
          js: jsResources,
          css: cssResources,
          matches: grantedMatches,
          allFrames: manifestContentScript.all_frames,
          runAt,
          persistAcrossSessions: true,
        },
      ]);
      logger.info('[Background] Custom content scripts registered', { matches: grantedMatches });
    } catch (error) {
      console.error('[Background] Failed to register custom content scripts:', error);
    }

    // Registration only covers future navigations, so enabling a site would
    // otherwise take a reload to show up. Cover the tabs already open on it.
    await injectVoyagerScriptIntoOpenTabs(grantedMatches, undefined, jsResources, cssResources);
  }

  /**
   * A live Voyager content script answers this ping. Orphaned scripts (extension
   * updated/reloaded underneath the page) have an invalidated runtime and cannot
   * respond, so they correctly read as "not injected".
   */
  async function hasLiveVoyagerContentScript(tabId: number, frameId?: number): Promise<boolean> {
    try {
      const message = { type: 'gv.content.ping' };
      const response = (
        frameId === undefined
          ? await browser.tabs.sendMessage(tabId, message)
          : await browser.tabs.sendMessage(tabId, message, { frameId })
      ) as { ok?: boolean } | undefined;
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  async function getMatchingFrameIds(tabId: number, matches: readonly string[]): Promise<number[]> {
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => location.href,
      });
      return frames.flatMap((frame) =>
        typeof frame.result === 'string' && matchesAnyPattern(frame.result, matches)
          ? [frame.frameId]
          : [],
      );
    } catch {
      // Never substitute the parent frame for an unresolvable companion frame.
      // The persistent registration will cover it on the next navigation/reload.
      return [];
    }
  }

  async function injectVoyagerScriptIntoOpenTabs(
    tabMatches: string[],
    frameMatches: string[] | undefined,
    jsResources: string[],
    cssResources: string[] | undefined,
  ): Promise<void> {
    if (!chrome.scripting?.executeScript || !tabMatches.length) return;
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({ url: tabMatches });
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      try {
        const frameIds = frameMatches ? await getMatchingFrameIds(tab.id, frameMatches) : [0];
        const missingFrameIds: number[] = [];
        for (const frameId of frameIds) {
          // insertCSS APPENDS a fresh copy on every call. Check every matching
          // frame independently so an already-live Claude parent does not prevent
          // first-time injection into its artifact child frame.
          if (!(await hasLiveVoyagerContentScript(tab.id, frameId))) missingFrameIds.push(frameId);
        }
        if (!missingFrameIds.length) continue;
        const target = { tabId: tab.id, frameIds: missingFrameIds };
        if (cssResources?.length) {
          await chrome.scripting.insertCSS({ target, files: cssResources });
        }
        if (jsResources.length) {
          await chrome.scripting.executeScript({ target, files: jsResources });
        }
      } catch {
        // Tab may be discarded or disallow injection — ignore; reload will cover it.
      }
    }
  }

  // Serialized: concurrent syncs (storage listener + permission events) would
  // otherwise race the ping-then-inject sequence and double-inject.
  let pluginContentScriptSyncQueue: Promise<void> = Promise.resolve();

  function syncPluginContentScripts(): Promise<void> {
    const next = pluginContentScriptSyncQueue.then(() => doSyncPluginContentScripts());
    pluginContentScriptSyncQueue = next.catch(() => {});
    return next;
  }

  /**
   * Plugin ecosystem — dynamic content-script registration.
   *
   * Mirrors syncCustomContentScripts: derive the origins of currently-ENABLED
   * plugins, keep only those the user has already granted host permission
   * for, and (re)register the content script for them. The content script runs
   * `startPluginHost()`, which mounts the enabled plugin on the page.
   *
   * Plugin enable-state is the single source of truth (storage.local); permissions
   * and registrations are derived from it.
   */
  async function doSyncPluginContentScripts(): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;

    const enabledPlugins = await loadEnabledPlugins(loadPluginCatalog);
    // Own registration call and failure path: the guard never blocks the plugin host.
    await syncShadowKeyGuardRegistration({
      scripting: chrome.scripting,
      manifest: chrome.runtime.getManifest(),
      enabledPlugins,
      filterGranted: filterGrantedOrigins,
      toResource: isFirefox() ? toRelativeExtensionPath : (path) => path,
    });

    const manifestContentScript = chrome.runtime.getManifest().content_scripts?.[0];
    if (!manifestContentScript) return;

    const grantedMatches = await filterGrantedOrigins(pluginsToOriginPatterns(enabledPlugins));

    await unregisterRegisteredContentScripts(chrome.scripting, [
      PLUGIN_CONTENT_SCRIPT_ID,
      PLUGIN_EMBEDDED_CONTENT_SCRIPT_ID,
      CLAUDE_USAGE_MAIN_SCRIPT_ID,
      CHATGPT_PRO_USAGE_MAIN_SCRIPT_ID,
      BRIDGE_ACCOUNT_MAIN_SCRIPT_ID,
    ]);

    if (!grantedMatches.length) return;

    // Before the content scripts below, so a page loading now gets the observer at document_start.
    await syncChatGptProUsageObserver({
      scripting: chrome.scripting,
      enabledPlugins,
      grantedOrigins: grantedMatches,
      supportsMainWorld: isChatGptProUsageSupported(),
      queryTabs: (url) => chrome.tabs.query({ url }),
    });
    await syncBridgeAccountObserver({
      scripting: chrome.scripting,
      enabledPlugins,
      grantedOrigins: grantedMatches,
      supportsMainWorld: isBridgeAccountObserverSupported(),
      queryTabs: (url) => chrome.tabs.query({ url }),
    });

    const runAt =
      manifestContentScript.run_at === 'document_start'
        ? 'document_start'
        : manifestContentScript.run_at === 'document_end'
          ? 'document_end'
          : 'document_idle';

    const jsResources = isFirefox()
      ? (manifestContentScript.js || []).map(toRelativeExtensionPath)
      : manifestContentScript.js || [];
    const cssResources = isFirefox()
      ? manifestContentScript.css?.map(toRelativeExtensionPath)
      : manifestContentScript.css;
    const { topFrameOrigins, embeddedFrameOrigins } = partitionPluginOriginPatterns(grantedMatches);

    try {
      const registrations: chrome.scripting.RegisteredContentScript[] = [];
      if (topFrameOrigins.length) {
        registrations.push({
          id: PLUGIN_CONTENT_SCRIPT_ID,
          js: jsResources,
          css: cssResources,
          matches: topFrameOrigins,
          allFrames: false,
          runAt,
          persistAcrossSessions: true,
        });
      }
      if (embeddedFrameOrigins.length) {
        registrations.push({
          id: PLUGIN_EMBEDDED_CONTENT_SCRIPT_ID,
          js: jsResources,
          css: cssResources,
          matches: embeddedFrameOrigins,
          allFrames: true,
          runAt,
          persistAcrossSessions: true,
        });
      }
      if (registrations.length) {
        await chrome.scripting.registerContentScripts(registrations);
      }
      // Inject into already-open matching tabs so the user sees the effect without
      // a manual reload.
      await injectVoyagerScriptIntoOpenTabs(topFrameOrigins, undefined, jsResources, cssResources);
      if (embeddedFrameOrigins.length) {
        await injectVoyagerScriptIntoOpenTabs(
          grantedMatches,
          embeddedFrameOrigins,
          jsResources,
          cssResources,
        );
      }
    } catch (error) {
      console.error('[Background] Failed to register plugin content scripts:', error);
    }
  }

  const { sync: syncPromptNudgeIcon } = createPromptNudgeRegistration(() => pluginSiteDomains);

  async function permissionAdded(origins?: string[]): Promise<void> {
    // Refresh the plugin-site set FIRST so a freshly-granted plugin origin
    // (e.g. claude.ai / chatgpt.com) is reliably excluded from the Prompt-Manager
    // custom-website list. Otherwise onAdded can fire before the initial async
    // refresh has populated `pluginSiteDomains`, racing a plugin site into the
    // custom-website list.
    await refreshPluginSiteDomains();

    const domains = extractDomainsFromOrigins(origins);
    if (domains.length) {
      try {
        const current = await browser.storage.sync.get({ [CUSTOM_WEBSITE_KEY]: [] });
        const existing = Array.isArray(current[CUSTOM_WEBSITE_KEY])
          ? current[CUSTOM_WEBSITE_KEY]
          : [];
        // A grant never repeats or widens an entry for its host: `example.org:3000`
        // keeps its port, and a parent domain already covers a subdomain. The
        // popup saves what it adds back before the browser answers, so an entry
        // it is restoring is already here.
        const merged = [...existing];
        for (const domain of domains) {
          if (!hasEntryForHost(merged, domain)) merged.push(domain);
        }
        if (merged.length !== existing.length) {
          await browser.storage.sync.set({ [CUSTOM_WEBSITE_KEY]: merged });
        }
      } catch (error) {
        console.warn('[Background] Failed to persist domains from permissions.onAdded:', error);
      }
    }

    // A granted origin may belong to an enabled plugin — (re)register both the
    // custom-website and the plugin content scripts for newly-granted origins.
    await syncCustomContentScripts();
    await syncPluginContentScripts();
    // The freshly-granted site is now enabled, so it should no longer be nudged.
    await syncPromptNudgeIcon();
  }

  function permissionRemoved(): void {
    void syncCustomContentScripts();
    // Keep plugin content-script registrations in sync when a site's host
    // permission is revoked from the browser UI — filterGrantedOrigins will now
    // drop the revoked origin, so the stale plugin registration is removed.
    void syncPluginContentScripts();
    // A revoked plugin site becomes eligible for the nudge dot again.
    void syncPromptNudgeIcon();
  }

  return {
    syncCustom: syncCustomContentScripts,
    syncPlugins: syncPluginContentScripts,
    refreshPluginSiteDomains,
    syncPromptNudgeIcon,
    permissionAdded,
    permissionRemoved,
  };
}
