import { useCallback, useEffect, useMemo, useState } from 'react';

import { resolveSiteAdapterForUrl } from '@/features/plugins/remote/siteOverride';
import {
  type PluginSettingWrite,
  compatibleSettingWrite,
  resolvePluginSettings,
} from '@/features/plugins/runtime/resolvePluginSettings';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';
import { type PluginStateMap, setPluginSettings } from '@/features/plugins/storage/pluginState';
import type {
  PluginManifest,
  PluginSettingValue,
  PluginSettings,
  SiteAdapter,
} from '@/features/plugins/types';
import { readTimelineSettings, timelineSettingKey } from '@/features/timeline/timelineSettings';

import type { TimelineSettingsValues } from '../components/TimelineSettingsCard';

/** Card search ids backed by a timeline plugin setting of the same meaning. */
const PLUGIN_SETTING_FOR_CARD: Readonly<Record<string, string>> = {
  timelineStyle: 'timelineStyle',
  enableMarkerLevel: 'markerLevel',
};
/** Card entries every catalog rail supports, whatever its plugin declares. */
const CATALOG_RAIL_ENTRIES: ReadonlySet<string> = new Set([
  'resetTimelinePosition',
  'viewStarredHistory',
]);

function isTimelinePlugin(plugin: PluginManifest): boolean {
  return (
    plugin.requires?.handlers?.includes('turnNavigator') === true ||
    (plugin.contributes.domOps ?? []).some(
      (op) => op.op === 'native' && op.handler === 'turnNavigator',
    )
  );
}

export interface CatalogTimelineSettingsInput {
  readonly activeUrl: string;
  readonly siteOverride: SiteAdapter | null;
  /** Plugins whose matches cover the active tab, in source order. */
  readonly manifests: readonly PluginManifest[];
  readonly pluginState: PluginStateMap;
  readonly writeSyncStorage: (payload: Record<string, unknown>) => Promise<void>;
}

export interface CatalogTimelineSettings {
  readonly values: TimelineSettingsValues;
  /** Whether the timeline card offers this entry (by its search id) for the site's rail. */
  readonly offers: (settingId: string) => boolean;
  readonly onChange: (patch: Partial<TimelineSettingsValues>) => void;
  readonly resetPosition: () => void;
}

/**
 * The timeline card's model on a site whose rail is a timeline plugin: values come from that
 * plugin's settings, edits are written to them, and the reset clears the site's own rail position.
 * Null when no timeline plugin covers the active tab.
 */
export function useCatalogTimelineSettings({
  activeUrl,
  siteOverride,
  manifests,
  pluginState,
  writeSyncStorage,
}: CatalogTimelineSettingsInput): CatalogTimelineSettings | null {
  // The page runs the first enabled timeline in source order, so a disabled builtin ahead of an
  // imported rail must not take the card's edits. With none enabled, the first one is what the
  // user would turn on.
  const manifest = useMemo(() => {
    const timelines = manifests.filter(isTimelinePlugin);
    return (
      timelines.find((plugin) => isPluginEnabled(pluginState, plugin.id)) ?? timelines[0] ?? null
    );
  }, [manifests, pluginState]);
  const siteId = useMemo(
    () => resolveSiteAdapterForUrl(activeUrl, SiteRegistry.createDefault(), siteOverride)?.id,
    [activeUrl, siteOverride],
  );
  const stored = manifest ? pluginState[manifest.id]?.settings : undefined;
  // Shown until the storage subscription delivers the write; another writer's change replaces it.
  const [pending, setPending] = useState<PluginSettings>({});
  useEffect(() => setPending({}), [stored]);

  const declared = manifest?.contributes.settings ?? {};
  const settings = useMemo(
    () =>
      manifest && siteId
        ? readTimelineSettings({
            siteId,
            pluginSettings: resolvePluginSettings(manifest, { ...stored, ...pending }),
            stored: {},
          })
        : null,
    [manifest, siteId, stored, pending],
  );

  const onChange = useCallback(
    (patch: Partial<TimelineSettingsValues>) => {
      if (!manifest) return;
      const writes: PluginSettingWrite[] = [];
      if (patch.timelineStyle) writes.push({ key: 'timelineStyle', value: patch.timelineStyle });
      if (typeof patch.markerLevelEnabled === 'boolean') {
        writes.push({ key: 'markerLevel', value: patch.markerLevelEnabled });
      }
      const fields = manifest.contributes.settings ?? {};
      // Same translation as the plugin's own settings: a page still running an older manifest
      // reads the keys it knew, and a choice another setting requires is written with it.
      const accepted: Record<string, PluginSettingValue> = {};
      for (const write of writes) {
        if (!Object.hasOwn(fields, write.key)) continue;
        Object.assign(accepted, compatibleSettingWrite(manifest, write).stored);
      }
      if (Object.keys(accepted).length === 0) return;
      setPending((current) => ({ ...current, ...accepted }));
      void setPluginSettings(manifest.id, accepted);
    },
    [manifest],
  );

  const resetPosition = useCallback(() => {
    if (siteId) void writeSyncStorage({ [timelineSettingKey(siteId, 'Position')]: null });
  }, [siteId, writeSyncStorage]);

  if (!manifest || !settings) return null;
  return {
    values: {
      timelineStyle: settings.style,
      mode: settings.scrollMode,
      hideContainer: settings.hideContainer,
      draggableTimeline: settings.draggable,
      timelinePreviewPinned: settings.previewPinned,
      markerLevelEnabled: settings.markerLevel,
      // Gemini-only features; their rows are never offered here.
      preventAutoScrollEnabled: false,
      showMessageTimestamps: false,
    },
    offers: (settingId) =>
      CATALOG_RAIL_ENTRIES.has(settingId) ||
      (Object.hasOwn(PLUGIN_SETTING_FOR_CARD, settingId) &&
        Object.hasOwn(declared, PLUGIN_SETTING_FOR_CARD[settingId])),
    onChange,
    resetPosition,
  };
}
