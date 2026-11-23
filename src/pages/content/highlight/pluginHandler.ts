/**
 * Gemini highlights as the packaged builtin plugin `voyager.gemini-highlight`
 * runs them. The plugin host mounts this only while `gvHighlightEnabled` is on
 * and fills `timelineMarkers` from `gvHighlightTimelineMarkersEnabled`; a change
 * of it arrives through `updateGeminiHighlightSettings` and shows or hides the
 * timeline ticks in place, without restarting the action.
 */
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings } from '@/features/plugins/types';

import { setHighlightTimelineMarkersEnabled, startHighlightAction } from './highlightAction';

/** On unless the setting is off, as the stored key has always read. */
const timelineMarkersOf = (settings: PluginSettings): boolean => settings.timelineMarkers !== false;

/** Own Highlight's action and annotation UI; storage and the shared toolbar stay in core. */
export function activateGeminiHighlight(scope: PluginScope, settings: PluginSettings): void {
  scope.effect(() => {
    const stop = startHighlightAction();
    setHighlightTimelineMarkersEnabled(timelineMarkersOf(settings));
    let stopped = false;
    const stopOnce = () => {
      if (stopped) return;
      stopped = true;
      scope.signal.removeEventListener('abort', stopOnce);
      stop();
    };
    // Abort must destroy a manager still initializing before async ledger disposal can wait.
    scope.signal.addEventListener('abort', stopOnce, { once: true });
    if (scope.signal.aborted) stopOnce();
    return stopOnce;
  }, 'gemini-highlight');
}

export function updateGeminiHighlightSettings(settings: PluginSettings): void {
  setHighlightTimelineMarkersEnabled(timelineMarkersOf(settings));
}
