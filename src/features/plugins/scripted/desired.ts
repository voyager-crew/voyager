import { scriptedRunState } from './state';
import type { ScriptedPlugin, ScriptedStateV1, UserScriptsAvailability } from './types';

/** One `chrome.userScripts` registration, before the registrar adds its packaged prelude. */
export interface DesiredUserScript {
  readonly id: string;
  readonly matches: readonly string[];
  readonly allFrames: false;
  readonly runAt: 'document_idle';
  readonly world: 'USER_SCRIPT';
  readonly worldId: string;
  readonly source: string;
}

/** Each plugin gets its own world, so one plugin's globals never reach another's. */
export function scriptedWorldId(pluginId: string): string {
  return `gv-${pluginId}`;
}

/** Exactly the registrations that should exist: one per plugin whose run state is `running`. */
export function desiredUserScripts(
  plugins: readonly ScriptedPlugin[],
  state: ScriptedStateV1,
  availability: UserScriptsAvailability,
): readonly DesiredUserScript[] {
  return plugins
    .filter((plugin) => scriptedRunState(plugin, state, availability).kind === 'running')
    .map(({ manifest }) => ({
      id: manifest.id,
      matches: [...manifest.matches],
      allFrames: false,
      runAt: 'document_idle',
      world: 'USER_SCRIPT',
      worldId: scriptedWorldId(manifest.id),
      source: manifest.contributes.script.source,
    }));
}
