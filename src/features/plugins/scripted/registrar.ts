/**
 * Makes `chrome.userScripts` hold exactly the registrations
 * `desiredUserScripts` plans, from whatever it holds now. Chrome clears user
 * scripts on an extension update, a stale id outlives a removed plugin, and a
 * re-import changes a source in place, so each pass diffs `getScripts()`
 * against the plan rather than assuming what an earlier pass left.
 */
import { logger } from '@/core/services/LoggerService';

import { type DesiredUserScript, desiredUserScripts } from './desired';
import { SCRIPTED_PRELUDE_FILE } from './prelude/file';
import { scriptedRunState } from './state';
import type { UserScriptsApi } from './status';
import type { ScriptedPlugin, ScriptedStateV1, UserScriptsAvailability } from './types';

export type { UserScriptsApi } from './status';

export interface ScriptedRegistrarDeps {
  readAvailability(): Promise<UserScriptsAvailability>;
  readPlugins(): Promise<readonly ScriptedPlugin[]>;
  readState(): Promise<ScriptedStateV1>;
  /** Read at each pass: Chrome may expose the namespace only once the user allows it. */
  userScripts(): UserScriptsApi | undefined;
}

/**
 * No connection, frame, image or font of the world's own; only packaged
 * extension scripts. A plugin's code is injected, not loaded, so it still runs.
 */
export const SCRIPTED_WORLD_CSP = "default-src 'none'; script-src 'self'";

type RegisteredUserScript = chrome.userScripts.RegisteredUserScript;

export function toRegisteredUserScript(desired: DesiredUserScript): RegisteredUserScript {
  return {
    id: desired.id,
    matches: [...desired.matches],
    js: [{ file: SCRIPTED_PRELUDE_FILE }, { code: desired.source }],
    allFrames: desired.allFrames,
    runAt: desired.runAt,
    world: desired.world,
    worldId: desired.worldId,
  };
}

function comparable(script: RegisteredUserScript): string {
  return JSON.stringify([
    script.matches ?? [],
    (script.js ?? []).map((source) => [source.file ?? null, source.code ?? null]),
    script.allFrames ?? false,
    script.runAt ?? 'document_idle',
    script.world ?? 'USER_SCRIPT',
    script.worldId ?? '',
  ]);
}

async function attempt(label: string, id: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.warn(`Scripted plugin ${label} failed`, { id, error: String(error) });
  }
}

/** One pass. Never throws; when the API is missing or refuses to list, it changes nothing. */
export async function reconcileUserScripts(deps: ScriptedRegistrarDeps): Promise<void> {
  const api = deps.userScripts();
  if (!api) return;
  const [availability, plugins, state] = await Promise.all([
    deps.readAvailability(),
    deps.readPlugins(),
    deps.readState(),
  ]);
  const desired = desiredUserScripts(plugins, state, availability);
  let existing: RegisteredUserScript[];
  try {
    existing = await api.getScripts();
  } catch {
    return;
  }

  const wanted = new Map(desired.map((script) => [script.id, script]));
  const stale = existing.filter((script) => !wanted.has(script.id)).map((script) => script.id);
  if (stale.length) {
    try {
      await api.unregister({ ids: stale });
    } catch {
      for (const id of stale) await attempt('unregister', id, () => api.unregister({ ids: [id] }));
    }
  }

  const current = new Map(existing.map((script) => [script.id, script]));
  const byId = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
  // A plugin turned off while this pass awaited must not register: read the state again just before.
  const stillRuns = async (id: string): Promise<boolean> => {
    const plugin = byId.get(id);
    return (
      !!plugin && scriptedRunState(plugin, await deps.readState(), availability).kind === 'running'
    );
  };
  for (const plan of desired) {
    const script = toRegisteredUserScript(plan);
    await attempt('world setup', plan.id, () =>
      api.configureWorld({ worldId: plan.worldId, csp: SCRIPTED_WORLD_CSP, messaging: false }),
    );
    const registered = current.get(plan.id);
    if (registered && comparable(registered) === comparable(script)) continue;
    if (!(await stillRuns(plan.id))) continue;
    if (!registered) {
      await attempt('register', plan.id, () => api.register([script]));
    } else {
      await attempt('update', plan.id, () => api.update([script]));
    }
  }
}

/**
 * Passes run one at a time, and requests that arrive during a pass share the
 * single pass queued behind it, which reads storage when it starts. So the
 * last request always ends in a pass that saw its change.
 */
export function createScriptedRegistrar(deps: ScriptedRegistrarDeps): {
  reconcile(): Promise<void>;
} {
  let chain: Promise<void> = Promise.resolve();
  let queued: Promise<void> | null = null;
  return {
    reconcile() {
      if (queued) return queued;
      const pass = chain.then(() => {
        queued = null;
        return reconcileUserScripts(deps);
      });
      queued = pass;
      chain = pass.catch(() => {});
      return pass;
    },
  };
}
