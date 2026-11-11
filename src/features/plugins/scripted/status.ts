/**
 * Availability and run state as seen from the extension context that asks.
 * Chrome exposes `chrome.userScripts` only to contexts created after the user
 * allowed user scripts, so a popup or panel opened after the toggle can see it
 * while the background worker that started earlier cannot. Each context
 * therefore probes its own `chrome.userScripts`.
 */
import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { readPlatformFormFactor } from '@/core/utils/formFactor';

import { chromeMajorVersion, probeUserScripts } from './availability';
import type { ScriptedStatus } from './messages';
import { loadScriptedPlugins, loadScriptedState, scriptedRunState } from './state';
import type { UserScriptsAvailability } from './types';

export type UserScriptsApi = Pick<
  typeof chrome.userScripts,
  'configureWorld' | 'getScripts' | 'register' | 'unregister' | 'update'
>;

/** This context's `chrome.userScripts`, read now: never cache it. */
export function userScriptsHere(): UserScriptsApi | undefined {
  return (globalThis as { chrome?: { userScripts?: UserScriptsApi } }).chrome?.userScripts;
}

export async function readAvailabilityHere(): Promise<UserScriptsAvailability> {
  return probeUserScripts({
    target: getVoyagerBuildTarget(),
    formFactor: await readPlatformFormFactor(),
    chromeMajor: chromeMajorVersion(globalThis.navigator?.userAgent ?? ''),
    userScripts: userScriptsHere(),
  });
}

export async function readScriptedStatus(
  availability: UserScriptsAvailability,
): Promise<ScriptedStatus> {
  const [plugins, state] = await Promise.all([loadScriptedPlugins(), loadScriptedState()]);
  return {
    ok: true,
    availability,
    stopped: state.stopped,
    plugins: plugins.map((plugin) => ({
      id: plugin.manifest.id,
      runState: scriptedRunState(plugin, state, availability),
    })),
  };
}
