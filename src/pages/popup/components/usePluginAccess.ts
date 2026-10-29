import { useCallback, useEffect, useState } from 'react';

import browser from 'webextension-polyfill';

import { pluginToOriginPatternsForActiveUrl } from '@/features/plugins/runtime/siteRegistration';
import type { PluginManifest } from '@/features/plugins/types';

import {
  canGrantPluginSiteAccess,
  requestPluginContentScriptSync,
  setPluginEnabledWithSiteAccess,
} from '../utils/pluginEnablement';
import type { EnabledMap } from './usePluginPreferences';

export function usePluginAccess(
  manifests: readonly PluginManifest[],
  activeUrl: string | undefined,
  enabledMap: EnabledMap,
  onEnabledChange: (id: string, enabled: boolean) => void,
) {
  const [deniedId, setDeniedId] = useState<string | null>(null);
  const [unsupportedId, setUnsupportedId] = useState<string | null>(null);
  // Why a local plugin's enable was refused: re-imported meanwhile, or not stored.
  const [enableRefusal, setEnableRefusal] = useState<{
    id: string;
    key: 'localPluginChangedBeforeEnable' | 'watermarkNotice_error';
  } | null>(null);
  const [missingPermissionIds, setMissingPermissionIds] = useState<Set<string>>(new Set());
  // A site revoked from the site access card, or granted elsewhere, rechecks the rows below.
  const [permissionChanges, setPermissionChanges] = useState(0);
  useEffect(() => {
    const permissions = browser.permissions;
    const recheck = () => setPermissionChanges((count) => count + 1);
    permissions?.onAdded?.addListener(recheck);
    permissions?.onRemoved?.addListener(recheck);
    return () => {
      permissions?.onAdded?.removeListener(recheck);
      permissions?.onRemoved?.removeListener(recheck);
    };
  }, []);
  // Plugin updates can add a narrowly-scoped companion origin after a user has
  // already enabled the plugin. Chrome cannot grant that new optional origin in
  // the background, so surface an explicit user-gesture repair instead of
  // silently leaving the new surface inactive.
  useEffect(() => {
    let active = true;
    if (!browser.permissions?.contains) return;

    const enabledPlugins = manifests.filter((plugin) => enabledMap[plugin.id] === true);
    void Promise.all(
      enabledPlugins.map(async (plugin): Promise<string | null> => {
        const origins = pluginToOriginPatternsForActiveUrl(plugin, activeUrl);
        if (!origins.length) return null;
        try {
          return (await browser.permissions.contains({ origins })) ? null : plugin.id;
        } catch {
          return null;
        }
      }),
    ).then((missingIds) => {
      if (active) setMissingPermissionIds(new Set(missingIds.filter((id): id is string => !!id)));
    });

    return () => {
      active = false;
    };
  }, [activeUrl, enabledMap, manifests, permissionChanges]);

  const handleToggle = useCallback(
    async (plugin: PluginManifest, next: boolean) => {
      setDeniedId(null);
      setUnsupportedId(null);
      setEnableRefusal(null);
      const outcome = await setPluginEnabledWithSiteAccess(plugin, next, activeUrl, (enabled) =>
        onEnabledChange(plugin.id, enabled),
      );
      if (outcome === 'denied') setDeniedId(plugin.id);
      else if (outcome === 'unsupported') setUnsupportedId(plugin.id);
      else if (outcome === 'changed')
        setEnableRefusal({ id: plugin.id, key: 'localPluginChangedBeforeEnable' });
      // The generic "Couldn't update the setting. Try again." message.
      else if (outcome === 'write_failed')
        setEnableRefusal({ id: plugin.id, key: 'watermarkNotice_error' });
    },
    [activeUrl, onEnabledChange],
  );

  const handleGrantRequiredAccess = useCallback(
    async (plugin: PluginManifest) => {
      setDeniedId(null);
      setUnsupportedId(null);
      const origins = pluginToOriginPatternsForActiveUrl(plugin, activeUrl);
      if (!origins.length) {
        setMissingPermissionIds((previous) => {
          const next = new Set(previous);
          next.delete(plugin.id);
          return next;
        });
        return;
      }
      if (!canGrantPluginSiteAccess()) {
        setUnsupportedId(plugin.id);
        return;
      }
      try {
        if (!(await browser.permissions.request({ origins }))) {
          setDeniedId(plugin.id);
          return;
        }
        if (!(await requestPluginContentScriptSync())) return;
        setMissingPermissionIds((previous) => {
          const next = new Set(previous);
          next.delete(plugin.id);
          return next;
        });
      } catch {
        setDeniedId(plugin.id);
      }
    },
    [activeUrl],
  );

  return {
    deniedId,
    unsupportedId,
    enableRefusal,
    missingPermissionIds,
    handleToggle,
    handleGrantRequiredAccess,
  };
}
