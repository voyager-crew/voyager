/**
 * Gemini's timeline as the builtin plugin `voyager.gemini-timeline` runs it. The plugin host
 * fills its style, scroll mode, hidden container, dragging, pinned preview and node levels from
 * their `geminiTimeline*` sync keys; a change of one arrives through
 * `updateGeminiTimelineSettings` and reaches the running rail in place, without a remount.
 */
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import type { PluginSettings, SiteAdapter } from '@/features/plugins/types';
import { activateTurnNavigator } from '@/features/plugins/verbs/turnNavigator';
import type { PrimitiveHandle } from '@/features/plugins/verbs/types';

/** The mounted rail's handle while the plugin runs; the host mounts one at a time. */
const rails = new Set<PrimitiveHandle>();

/** Admission and the legacy master switch belong to PluginHost; page services outlive the rail. */
export function activateGeminiTimeline(
  scope: PluginScope,
  settings: PluginSettings,
  adapter: SiteAdapter | null,
): void {
  const rail = activateTurnNavigator(
    scope,
    { dataBackend: 'shared' },
    {
      doc: document,
      adapter,
      pluginId: OFFICIAL_PLUGIN_IDS.geminiTimeline,
      settings,
      setTargetCounter: () => {},
    },
    settings,
  );
  if (!rail) return;
  scope.effect(() => {
    rails.add(rail);
    return () => {
      rails.delete(rail);
    };
  }, 'gemini-timeline:settings');
}

export function updateGeminiTimelineSettings(settings: PluginSettings): void {
  for (const rail of rails) rail.updateSettings?.(settings);
}
