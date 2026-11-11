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

async function attempt(label: string, id: string, work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    logger.warn(`Scripted plugin ${label} failed`, { id, error: String(error) });
    return false;
  }
}

/** Ids of the stale registrations Chrome removed. */
async function unregisterStale(
  api: UserScriptsApi,
  stale: readonly string[],
): Promise<Set<string>> {
  if (!stale.length) return new Set();
  try {
    await api.unregister({ ids: [...stale] });
    return new Set(stale);
  } catch {
    const removed = new Set<string>();
    for (const id of stale) {
      if (await attempt('unregister', id, () => api.unregister({ ids: [id] }))) removed.add(id);
    }
    return removed;
  }
}

/**
 * Chrome keeps a world's configuration after its script is gone, up to a
 * limit, so a world no registration uses is reset; one still in use keeps its CSP.
 */
async function resetUnusedWorlds(api: UserScriptsApi, inUse: ReadonlySet<string>): Promise<void> {
  let worlds: chrome.userScripts.WorldProperties[];
  try {
    worlds = await api.getWorldConfigurations();
  } catch (error) {
    logger.warn('Scripted world list failed', { error: String(error) });
    return;
  }
  for (const { worldId } of worlds) {
    if (worldId && !inUse.has(worldId)) {
      await attempt('world reset', worldId, () => api.resetWorldConfiguration(worldId));
    }
  }
}

/**
 * One pass. Never throws; when the API is missing or refuses to list, it
 * changes nothing. Returns the ids it left unregistered because their world
 * could not be configured.
 */
export async function reconcileUserScripts(
  deps: ScriptedRegistrarDeps,
): Promise<ReadonlySet<string>> {
  const unconfigured = new Set<string>();
  const api = deps.userScripts();
  if (!api) return unconfigured;
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
    return unconfigured;
  }

  const wanted = new Map(desired.map((script) => [script.id, script]));
  const removed = await unregisterStale(
    api,
    existing.filter((script) => !wanted.has(script.id)).map((script) => script.id),
  );
  await resetUnusedWorlds(
    api,
    new Set([
      ...desired.map((plan) => plan.worldId),
      ...existing.flatMap((script) =>
        script.worldId && !removed.has(script.id) ? [script.worldId] : [],
      ),
    ]),
  );

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
    const registered = current.get(plan.id);
    const configured = await attempt('world setup', plan.id, () =>
      api.configureWorld({ worldId: plan.worldId, csp: SCRIPTED_WORLD_CSP, messaging: false }),
    );
    if (!configured) {
      // Without its world's CSP the plugin must not run at all.
      unconfigured.add(plan.id);
      if (registered)
        await attempt('unregister', plan.id, () => api.unregister({ ids: [plan.id] }));
      continue;
    }
    if (registered && comparable(registered) === comparable(script)) continue;
    if (!(await stillRuns(plan.id))) continue;
    if (!registered) {
      await attempt('register', plan.id, () => api.register([script]));
    } else {
      await attempt('update', plan.id, () => api.update([script]));
    }
  }
  return unconfigured;
}

/**
 * Passes run one at a time, and requests that arrive during a pass share the
 * single pass queued behind it, which reads storage when it starts. So the
 * last request always ends in a pass that saw its change.
 */
export function createScriptedRegistrar(deps: ScriptedRegistrarDeps): {
  reconcile(): Promise<void>;
  /** Ids the last finished pass could not set up a world for, so they do not run. */
  unconfigured(): ReadonlySet<string>;
} {
  let chain: Promise<void> = Promise.resolve();
  let queued: Promise<void> | null = null;
  let unconfigured: ReadonlySet<string> = new Set();
  return {
    reconcile() {
      if (queued) return queued;
      const pass = chain.then(async () => {
        queued = null;
        unconfigured = await reconcileUserScripts(deps);
      });
      queued = pass;
      chain = pass.catch(() => {});
      return pass;
    },
    unconfigured: () => unconfigured,
  };
}
