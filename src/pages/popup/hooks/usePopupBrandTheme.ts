import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StorageKeys } from '@/core/types/common';
import { resolveSiteAdapterForUrl } from '@/features/plugins/remote/siteOverride';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';
import {
  type AccentColorMap,
  effectiveAccentForDisplay,
  resolveBrandColor,
  watchBrandSources,
} from '@/pages/content/platformTheme';

import { createPopupBrandThemeStyle } from '../utils/brandTheme';

export function usePopupBrandTheme({
  activeUrl,
  pluginSiteOverride,
}: {
  activeUrl: string;
  pluginSiteOverride: SiteAdapter | null;
}) {
  const [accentColors, setAccentColors] = useState<AccentColorMap>({});
  // Enabled plugins that declare theme.brand, as the page and the panel see them.
  const [brandManifests, setBrandManifests] = useState<readonly PluginManifest[]>([]);
  const accentWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAccentWrite = useRef<Record<string, string> | null>(null);
  const flushPendingAccent = useCallback(() => {
    if (accentWriteTimer.current) clearTimeout(accentWriteTimer.current);
    accentWriteTimer.current = null;
    const pending = pendingAccentWrite.current;
    pendingAccentWrite.current = null;
    if (!pending) return;
    try {
      chrome.storage?.sync?.set({ [StorageKeys.ACCENT_COLORS]: pending });
    } catch {
      // The extension context may have already closed.
    }
  }, []);
  // The host platform to theme the popup for (claude → orange, chatgpt → sky blue).
  // Brand accent for the popup, matching the tab the user is on (adapter
  // built-in, or a plugin's declared theme). Drives --primary/--ring/--accent so
  // the whole popup — not just primary buttons — adopts the platform colour.
  // The adapter for the active tab: the remote site override when one covers
  // the page, else the bundled adapter. Single source for id, label and brand.
  const activeSiteAdapter = useMemo(
    () => resolveSiteAdapterForUrl(activeUrl, SiteRegistry.createDefault(), pluginSiteOverride),
    [activeUrl, pluginSiteOverride],
  );
  const activeBrand = useMemo(
    () => resolveBrandColor(activeUrl, brandManifests, accentColors, activeSiteAdapter),
    [activeUrl, brandManifests, accentColors, activeSiteAdapter],
  );

  // Theme-colour picker: which site the override applies to, that site's
  // default (what "reset" returns to), and the site's own display label.
  const activeSiteId = activeSiteAdapter?.id ?? null;
  const activeSiteDefault = useMemo(
    () => effectiveAccentForDisplay(activeUrl, brandManifests, {}, activeSiteAdapter),
    [activeUrl, brandManifests, activeSiteAdapter],
  );
  const activeSiteLabel = activeSiteAdapter?.label ?? '';

  // The per-site accent map and the enabled brand plugins, kept live from the
  // same source as the page (changes flow back in from this popup's writes, a
  // plugin toggle, or another device's sync).
  useEffect(() => {
    const stop = watchBrandSources(activeUrl, ({ manifests, customColors }) => {
      setBrandManifests(manifests);
      // A plugin or catalog change re-reads storage; keep an unsaved preview.
      if (!pendingAccentWrite.current) setAccentColors(customColors);
    });
    return () => {
      stop();
      flushPendingAccent();
    };
  }, [activeUrl, flushPendingAccent]);

  const handleAccentColorChange = useCallback(
    (next: string | null) => {
      if (!activeSiteId) return;
      const updated = { ...accentColors };
      if (next) updated[activeSiteId] = next;
      else delete updated[activeSiteId];
      setAccentColors(updated); // instant popup preview from React state
      // Debounce the sync write: dragging the native colour wheel fires onChange
      // rapidly, and chrome.storage.sync throttles write bursts (~120/min), after
      // which writes are dropped and the colour appears to "freeze". Persist only
      // the final value once the user pauses.
      if (accentWriteTimer.current) clearTimeout(accentWriteTimer.current);
      pendingAccentWrite.current = updated;
      accentWriteTimer.current = setTimeout(flushPendingAccent, 200);
    },
    [activeSiteId, accentColors, flushPendingAccent],
  );

  return {
    style: activeBrand ? createPopupBrandThemeStyle(activeBrand) : undefined,
    picker: {
      siteId: activeSiteId,
      siteLabel: activeSiteLabel,
      defaultColor: activeSiteDefault,
      value: (activeSiteId && accentColors[activeSiteId]) || null,
      onChange: handleAccentColorChange,
    },
  };
}
