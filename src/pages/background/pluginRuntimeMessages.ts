/**
 * Background handlers for plugin runtime messages from content scripts and the
 * popup. Returns null for any other message so the caller keeps routing it.
 */
import { catalogHostFromUrl } from '@/features/plugins/remote/hostCatalogPolicy';
import { parseHostCatalogRefreshPayload } from '@/features/plugins/remote/hostCatalogRefresh';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
  PLUGIN_SET_SETTING_MESSAGE,
} from '@/features/plugins/runtime/messages';
import { compatibleSettingWrite } from '@/features/plugins/runtime/resolvePluginSettings';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { listPluginManifests } from '@/features/plugins/sources/defaultSources';
import {
  type PluginSettingRequest,
  isDeclaredPluginSetting,
  parsePluginSettingRequest,
} from '@/features/plugins/storage/pluginSettingRequest';
import { setPluginSettings } from '@/features/plugins/storage/pluginState';
import type { PluginManifest } from '@/features/plugins/types';

import { getSenderPageUrl } from './runtimeMessageRouting';

export interface PluginRuntimeMessageDeps {
  /** The serialized dynamic content-script registration sync. */
  syncContentScripts(): Promise<void>;
  /** The single remote catalog refresher. */
  refreshCatalog(host: string, force: boolean): Promise<unknown>;
  /** The plugin the catalog serves for `pageUrl` under `id`; defaults to every source. */
  findPluginManifest?(id: string, pageUrl: string): Promise<PluginManifest | undefined>;
}

const INVALID_PAYLOAD = { ok: false, error: 'invalid_payload' } as const;
const UNTRUSTED_SENDER = { ok: false, error: 'untrusted_sender' } as const;
const WRITE_FAILED = { ok: false, error: 'write_failed' } as const;

/**
 * The plugin under `id` as the page's own host lists it: the cached remote
 * catalog needs `host` (a remote-only plugin, a remote-updated schema), and
 * `catalogHostFromUrl` is undefined on hosts without online catalog support.
 */
async function findListedManifest(id: string, pageUrl: string) {
  const context = { url: pageUrl, host: catalogHostFromUrl(pageUrl) };
  return (await listPluginManifests(undefined, context)).find((m) => m.id === id);
}

/**
 * Store one setting for a content script of ours running in a tab the plugin
 * targets, and only a key the plugin declares, with a value of that type.
 */
async function setSettingFromContent(
  request: PluginSettingRequest,
  sender: chrome.runtime.MessageSender,
  deps: PluginRuntimeMessageDeps,
): Promise<unknown> {
  const pageUrl = getSenderPageUrl(sender);
  if (sender.id !== chrome.runtime.id || !sender.tab || !pageUrl) return UNTRUSTED_SENDER;
  const manifest = await (deps.findPluginManifest ?? findListedManifest)(request.id, pageUrl);
  if (!manifest) return INVALID_PAYLOAD;
  const write = compatibleSettingWrite(manifest, request);
  if (!isDeclaredPluginSetting(manifest, { ...request, ...write.checked })) return INVALID_PAYLOAD;
  const frameUrls = [pageUrl, sender.url].filter((url): url is string => Boolean(url));
  if (!frameUrls.some((url) => matchesAnyPattern(url, manifest.matches))) return UNTRUSTED_SENDER;
  const stored = await setPluginSettings(request.id, write.stored);
  return stored ? { ok: true } : WRITE_FAILED;
}

export function handlePluginRuntimeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  deps: PluginRuntimeMessageDeps,
): Promise<unknown> | null {
  if (typeof message !== 'object' || message === null) return null;
  const { type, payload } = message as { type?: unknown; payload?: unknown };

  if (type === PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE) {
    return deps.syncContentScripts().then(() => ({ ok: true }));
  }
  if (type === PLUGIN_CATALOG_REFRESH_MESSAGE) {
    const request = parseHostCatalogRefreshPayload(payload);
    if (!request) return Promise.resolve(INVALID_PAYLOAD);
    return deps.refreshCatalog(request.host, request.force);
  }
  if (type === PLUGIN_SET_SETTING_MESSAGE) {
    // Written here, under the plugin-storage lock the popup shares; a content
    // script's own write could not be serialized with a local-plugin import.
    const request = parsePluginSettingRequest(payload);
    if (!request) return Promise.resolve(INVALID_PAYLOAD);
    return setSettingFromContent(request, sender, deps);
  }
  return null;
}
