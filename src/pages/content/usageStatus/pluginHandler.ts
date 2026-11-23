/**
 * Gemini usage status as the packaged builtin plugin
 * `voyager.gemini-usage-status` runs it: the native module's runtime (account
 * cache, `/usage` scraping, silent refresh and the pill), owned by the
 * plugin's scope.
 *
 * The plugin host mounts this only while `gvUsageStatusEnabled` is on, so the
 * runtime never reads that switch, and fills `display` (used or remaining)
 * from `gvUsageStatusDisplay`; a change of it arrives through
 * `updateGeminiUsageStatusSettings` and re-renders the pill in place.
 * Unmounting aborts `scope.signal`, which removes the pill, listeners and
 * timers and leaves the usage cache, recipe and pill position stored. The
 * MAIN-world usage observer stays in core.
 */
import { resolveUsageDisplay } from '@/core/utils/usageDisplayValues';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings } from '@/features/plugins/types';

import { setUsageStatusDisplay, startUsageStatusRuntime } from './runtime';

export function activateGeminiUsageStatus(
  scope: PluginScope,
  settings: PluginSettings,
): Promise<void> {
  return startUsageStatusRuntime({
    signal: scope.signal,
    display: resolveUsageDisplay(settings.display),
  });
}

export function updateGeminiUsageStatusSettings(settings: PluginSettings): void {
  setUsageStatusDisplay(resolveUsageDisplay(settings.display));
}
