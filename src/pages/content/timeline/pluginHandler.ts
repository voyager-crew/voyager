import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import type { PluginSettings, SiteAdapter } from '@/features/plugins/types';
import { activateTurnNavigator } from '@/features/plugins/verbs/turnNavigator';

/** Admission and the legacy master switch belong to PluginHost; page services outlive the rail. */
export function activateGeminiTimeline(
  scope: PluginScope,
  settings: PluginSettings,
  adapter: SiteAdapter | null,
): void {
  activateTurnNavigator(
    scope,
    { dataBackend: 'shared' },
    {
      doc: document,
      adapter,
      pluginId: OFFICIAL_PLUGIN_IDS.geminiTimeline,
      settings,
      setTargetCounter: () => {},
    },
    null,
  );
}
