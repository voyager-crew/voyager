import browser, { type Manifest } from 'webextension-polyfill';

import {
  getVoyagerBuildTarget,
  isFirefox,
  supportsDynamicContentScriptRegistration,
  supportsOptionalHostPermissions,
} from '@/core/utils/browser';
import { CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID } from '@/features/plugins/builtin/chatgptResponseNotification/manifest';
import { isLocalPluginId } from '@/features/plugins/local/localPluginId';
import { enableLocalPluginIfUnchanged } from '@/features/plugins/local/localPluginStore';
import { PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE } from '@/features/plugins/runtime/messages';
import {
  partitionPluginOriginPatterns,
  pluginToOriginPatternsForActiveUrl,
} from '@/features/plugins/runtime/siteRegistration';
import {
  legacyBindingFor,
  legacyEnableWrite,
} from '@/features/plugins/storage/legacySettingBindings';
import { setPluginEnabled } from '@/features/plugins/storage/pluginState';
import type { PluginManifest } from '@/features/plugins/types';

import { writePopupSyncStorageChecked } from './popupStorage';

/**
 * Ask the background service to reconcile dynamic plugin content scripts after
 * an optional host permission grant. This is best-effort because Chrome may
 * close the popup while displaying its permission prompt; the background
 * permissions listener remains the fallback in that case. Returns whether the
 * background confirmed that reconciliation completed.
 */
export async function requestPluginContentScriptSync(): Promise<boolean> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
    })) as { ok?: unknown } | null;
    return response?.ok === true;
  } catch {
    // Chrome may close the popup while showing the optional-host prompt. The
    // background permissions.onAdded listener remains the fallback in that case.
    return false;
  }
}

/** Whether this browser can grant and inject the optional host access plugins need. */
export function canGrantPluginSiteAccess(): boolean {
  return (
    !!browser.permissions?.request &&
    supportsOptionalHostPermissions() &&
    supportsDynamicContentScriptRegistration()
  );
}

/**
 * Whether the plugin already holds the optional host access it needs on the
 * active site. An enabled plugin can still lack it: Chrome closes the popup
 * while its permission prompt is open, after the enable was persisted. Unknown
 * answers count as granted so a check failure never hides a working plugin.
 */
export async function hasPluginSiteAccess(
  plugin: PluginManifest,
  activeUrl: string | undefined,
): Promise<boolean> {
  const origins = pluginToOriginPatternsForActiveUrl(plugin, activeUrl);
  if (!origins.length || !browser.permissions?.contains) return true;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return true;
  }
}

/**
 * A later switch on a site reuses the grant an earlier one made: when only a
 * companion frame's origin is missing (Claude's artifacts), the plugin turns on
 * without a prompt and its row offers the repair, as after a plugin update.
 */
async function reusesSiteGrant(
  origins: readonly string[],
  permissions: readonly Manifest.OptionalPermission[],
): Promise<boolean> {
  const { topFrameOrigins, embeddedFrameOrigins } = partitionPluginOriginPatterns(origins);
  if (permissions.length > 0 || embeddedFrameOrigins.length === 0 || !topFrameOrigins.length) {
    return false;
  }
  try {
    return await browser.permissions.contains({ origins: topFrameOrigins });
  } catch {
    return false;
  }
}

/**
 * Optional API permissions a builtin plugin needs beyond host access, asked in
 * the same gesture: Firefox allows one prompt as the gesture's first await.
 * Safari delivers notifications through its native app, not this permission.
 */
function pluginApiPermissions(plugin: PluginManifest): Manifest.OptionalPermission[] {
  return plugin.id === CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID &&
    getVoyagerBuildTarget() !== 'safari'
    ? ['notifications']
    : [];
}

/**
 * `enabled` / `disabled`: the requested state was saved. `denied`: the user
 * refused (or the browser failed) the host-access prompt. `unsupported`: this
 * browser cannot grant or inject the access the plugin needs on this site.
 * `changed`: a local plugin's content changed (re-imported elsewhere) after the
 * user saw it, so it stays off until they review the new content.
 * `write_failed`: the new state could not be stored (a local plugin's enable, or
 * a legacy-bound official plugin's sync key); the previous state stays.
 */
export type PluginToggleOutcome =
  | 'enabled'
  | 'disabled'
  | 'denied'
  | 'unsupported'
  | 'changed'
  | 'write_failed';

/**
 * Store an enable flag where the plugin reads it: a legacy-bound official
 * plugin ignores its `gvPluginsState` entry, so its switch is the old sync key.
 */
async function writeEnabled(plugin: PluginManifest, enabled: boolean): Promise<boolean> {
  if (legacyBindingFor(plugin.id)) {
    return writePopupSyncStorageChecked(legacyEnableWrite(plugin.id, enabled));
  }
  await setPluginEnabled(plugin.id, enabled);
  return true;
}

/**
 * Persist the enable state. A local plugin is switched on only while its
 * stored content is still the manifest the user saw; otherwise this returns
 * why it stayed off.
 */
async function persistEnabled(
  plugin: PluginManifest,
  enabled: boolean,
): Promise<'saved' | 'changed' | 'write_failed'> {
  if (enabled && isLocalPluginId(plugin.id)) {
    const result = await enableLocalPluginIfUnchanged(plugin);
    return result === 'enabled' ? 'saved' : result;
  }
  return (await writeEnabled(plugin, enabled)) ? 'saved' : 'write_failed';
}

/**
 * Turn a plugin on or off from a popup gesture, requesting the optional host
 * access it needs on the active site first. `onEnabledChange` mirrors every
 * persisted state change into the caller's UI as it happens, including the
 * optimistic enable written before Chrome's permission prompt.
 */
export async function setPluginEnabledWithSiteAccess(
  plugin: PluginManifest,
  next: boolean,
  activeUrl: string | undefined,
  onEnabledChange: (enabled: boolean) => void,
): Promise<PluginToggleOutcome> {
  if (next) {
    const origins = pluginToOriginPatternsForActiveUrl(plugin, activeUrl);
    const permissions = pluginApiPermissions(plugin);
    const access = permissions.length > 0 ? { origins, permissions } : { origins };
    if (origins.length > 0 || permissions.length > 0) {
      // This plugin needs host access on a site Voyager reaches only via dynamic
      // content-script registration. If the platform can't grant or inject that
      // (an old Safari/build without the required APIs, or Firefox < 128 which
      // ignores optional_host_permissions), enabling would be a silent no-op —
      // so refuse and explain, instead of a misleading toggle.
      if (origins.length > 0 && !canGrantPluginSiteAccess()) return 'unsupported';
      try {
        // Firefox requires permissions.request to be the first await in the
        // user gesture, so skip the contains() pre-check there.
        if (!isFirefox() && browser.permissions.contains) {
          const alreadyGranted = await browser.permissions.contains(access);
          if (!alreadyGranted && !(await reusesSiteGrant(origins, permissions))) {
            // Chrome closes extension popups while showing an optional-host
            // prompt. Persist the user's intent BEFORE opening it so a
            // successful grant can be completed by the background even if
            // the popup is closed before permissions.request resolves.
            onEnabledChange(true);
            const persisted = await persistEnabled(plugin, true);
            if (persisted !== 'saved') {
              onEnabledChange(false);
              return persisted;
            }
            const granted = await browser.permissions.request(access);
            if (!granted) {
              onEnabledChange(false);
              await writeEnabled(plugin, false);
              return 'denied';
            }
            // Edge can resolve the request without reliably delivering the
            // permissions.onAdded event that normally performs registration.
            // Reconcile explicitly while retaining onAdded as Chrome's
            // popup-close fallback.
            await requestPluginContentScriptSync();
            return 'enabled';
          }
        } else if (!(await browser.permissions.request(access))) {
          return 'denied';
        }
      } catch {
        onEnabledChange(false);
        await writeEnabled(plugin, false);
        return 'denied';
      }
    }
  }
  onEnabledChange(next);
  const persisted = await persistEnabled(plugin, next);
  if (persisted !== 'saved') {
    onEnabledChange(!next);
    return persisted;
  }
  return next ? 'enabled' : 'disabled';
}
