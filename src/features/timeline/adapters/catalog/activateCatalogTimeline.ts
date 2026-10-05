import { type Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { requestPluginSetting } from '@/features/plugins/storage/pluginSettingRequest';
import type { PluginSettings } from '@/features/plugins/types';
import type { PrimitiveHandle } from '@/features/plugins/verbs/types';
import { showTimelineStyleCoachmark } from '@/features/timeline/timelineStyleCoachmark';

import { TimelineEngine } from '../../TimelineEngine';
import { runRouteTimeline } from '../../runRouteTimeline';
import { CatalogTimelineAdapter } from './CatalogTimelineAdapter';
import { CatalogTurnOwnership } from './CatalogTurnOwnership';
import { publishStarNamespace } from './activeStarNamespace';
import { type CatalogTimelineConfig } from './config';
import { starConversationId, turnConversationId } from './conversationId';

/** The primitive scope owns route lifetime; viewport remounts stay inside one engine. */
export function activateCatalogTimeline(
  scope: PluginScope,
  config: CatalogTimelineConfig,
  settings: PluginSettings = {},
): PrimitiveHandle {
  let currentSettings = settings;
  const ownership = new CatalogTurnOwnership({
    routeId: () => location.href.split('#')[0],
    starId: () => starConversationId(config),
    turnConversation: (element) => turnConversationId(config, element),
  });
  ownership.begin();
  // ChatGPT export's starred filter must read the ids this rail writes.
  scope.effect(
    () =>
      publishStarNamespace({
        siteId: config.siteId,
        conversationIdPattern: config.conversationIdPattern,
      }),
    'star-namespace',
  );
  if (document.body)
    scope.observe(document.body, { childList: true, subtree: true }, (records) =>
      ownership.recordInsertions(records),
    );
  // Each route's startup is a scope effect, so disposal awaits a pending init before it settles.
  let stopStart: Dispose | null = null;
  const timeline = runRouteTimeline({
    signal: scope.signal,
    followHash: true,
    createEngine: () => {
      const engine = new TimelineEngine(
        new CatalogTimelineAdapter(config, ownership),
        scope.signal,
      );
      // Settings belong to the mounted plugin version; route changes keep them.
      engine.updateSettings(currentSettings);
      return engine;
    },
    start: (engine) => {
      void stopStart?.();
      stopStart = scope.effect(
        () =>
          engine.init().then(() => {
            if (!scope.isDisposed && timeline.engine === engine)
              engine.updateSettings(currentSettings);
            return () => engine.destroy();
          }),
        'catalog-timeline-start',
      );
    },
  });
  scope.effect(() => timeline.stop, 'catalog-timeline');
  let yieldGuide = false;
  try {
    yieldGuide = !!config.yieldWhenSelector && !!document.querySelector(config.yieldWhenSelector);
  } catch {
    /* Invalid optional catalog selector does not block the timeline. */
  }
  if (
    !yieldGuide &&
    // The guide switches to compact, which node levels rule out.
    currentSettings.markerLevel !== true &&
    currentSettings.compactView !== true &&
    currentSettings.timelineStyle !== 'compact' &&
    currentSettings.timelineStyle !== 'ruler'
  ) {
    void showTimelineStyleCoachmark({
      id: config.coachmarkId,
      enabled: false,
      signal: scope.signal,
      onStyleChange: async (compact) => {
        if (scope.isDisposed) return;
        const key = currentSettings.timelineStyle === undefined ? 'compactView' : 'timelineStyle';
        const value = key === 'compactView' ? compact : compact ? 'compact' : 'dots';
        currentSettings = { ...currentSettings, [key]: value };
        timeline.engine?.updateSettings(currentSettings);
        await requestPluginSetting(config.pluginId, key, value);
      },
    });
  }
  return {
    updateSettings(next) {
      currentSettings = next;
      timeline.engine?.updateSettings(next);
    },
  };
}
