/**
 * Which scripted local plugins may run on this device. Invariants are in
 * `README.md`; every writer holds the plugin-storage lock, so an enable can
 * never land over a re-import that started after the review.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

import { sanitizeLocalPluginRecords } from '../local/localPluginStore';
import { validateLocalManifest } from '../local/validateLocalManifest';
import { withPluginStorageLock } from '../storage/pluginStorageLock';
import type { ScriptedCrash } from './crashGuard';
import { EMPTY_SCRIPTED_STATE, isNewerScriptedState, parseScriptedState } from './parseState';
import {
  type ScriptHash,
  type ScriptedManifest,
  type ScriptedPlugin,
  type ScriptedRunState,
  type ScriptedStateV1,
  type UserScriptsAvailability,
  isScriptedManifest,
} from './types';

const KEY = StorageKeys.PLUGIN_SCRIPTED_STATE;
const MANIFESTS = StorageKeys.PLUGIN_LOCAL_MANIFESTS;

function localArea(): chrome.storage.LocalStorageArea | undefined {
  const g = globalThis as { chrome?: typeof chrome };
  return g.chrome?.storage?.local;
}

export async function scriptedReviewHash(manifest: ScriptedManifest): Promise<ScriptHash> {
  const reviewed = { matches: manifest.matches, source: manifest.contributes.script.source };
  return (await hashValue(reviewed)) as ScriptHash;
}

/** A stored local manifest read the way the scripted runtime reads it, or undefined. */
export async function readScriptedPlugin(stored: unknown): Promise<ScriptedPlugin | undefined> {
  const result = validateLocalManifest(stored, undefined, {
    hostPolicy: 'defer',
    allowScripted: true,
  });
  if (!result.success || !isScriptedManifest(result.data.manifest)) return undefined;
  const manifest = result.data.manifest;
  return { manifest, reviewHash: await scriptedReviewHash(manifest) };
}

/** Every stored local plugin that passes the scripted gate, unreadable ones skipped. */
export async function loadScriptedPlugins(): Promise<ScriptedPlugin[]> {
  const local = localArea();
  if (!local) return [];
  try {
    const stored = await local.get({ [MANIFESTS]: {} });
    const records = Object.values(sanitizeLocalPluginRecords(stored?.[MANIFESTS]));
    const plugins = await Promise.all(records.map((record) => readScriptedPlugin(record.manifest)));
    return plugins.filter((plugin): plugin is ScriptedPlugin => plugin !== undefined);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadScriptedPlugins failed', { error: String(error) });
    }
    return [];
  }
}

export async function loadScriptedState(): Promise<ScriptedStateV1> {
  const local = localArea();
  if (!local) return EMPTY_SCRIPTED_STATE;
  try {
    const result = await local.get({ [KEY]: {} });
    return parseScriptedState(result?.[KEY]);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadScriptedState failed', { error: String(error) });
    }
    return EMPTY_SCRIPTED_STATE;
  }
}

/** A failed read, or a state a newer build wrote, throws: never write over what was not read. */
async function readScriptedStateStrict(
  local: chrome.storage.LocalStorageArea,
): Promise<ScriptedStateV1> {
  const result = await local.get({ [KEY]: {} });
  const raw: unknown = result?.[KEY];
  if (isNewerScriptedState(raw)) throw new Error('scripted state was written by a newer Voyager');
  return parseScriptedState(raw);
}

async function updateScriptedState(
  label: string,
  context: Record<string, unknown>,
  update: (current: ScriptedStateV1) => ScriptedStateV1,
): Promise<boolean> {
  const local = localArea();
  if (!local) return false;
  try {
    await withPluginStorageLock(async () => {
      await local.set({ [KEY]: update(await readScriptedStateStrict(local)) });
    });
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn(`${label} failed`, { ...context, error: String(error) });
    }
    return false;
  }
}

export type ScriptedEnableResult = 'enabled' | 'changed' | 'write_failed';

/**
 * Turn a scripted plugin on only while its stored content still hashes to
 * `seen`, the hash of what the user reviewed. `changed` when it was edited,
 * re-imported or removed since; neither `changed` nor `write_failed` writes.
 */
export async function enableScriptedIfUnchanged(
  id: string,
  seen: ScriptHash,
  now: number = Date.now(),
): Promise<ScriptedEnableResult> {
  const local = localArea();
  if (!local) return 'write_failed';
  try {
    return await withPluginStorageLock(async () => {
      const stored = await local.get({ [MANIFESTS]: {} });
      const record = sanitizeLocalPluginRecords(stored?.[MANIFESTS])[id];
      const plugin = record ? await readScriptedPlugin(record.manifest) : undefined;
      if (plugin?.reviewHash !== seen) {
        logger.warn('Scripted plugin changed since it was reviewed; not enabling', { id });
        return 'changed';
      }
      const state = await readScriptedStateStrict(local);
      const enabled = { ...state.enabled, [id]: { reviewHash: seen, enabledAt: now } };
      await local.set({ [KEY]: { ...state, enabled } });
      return 'enabled';
    });
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('enableScriptedIfUnchanged failed', { id, error: String(error) });
    }
    return 'write_failed';
  }
}

export function disableScripted(id: string): Promise<boolean> {
  return updateScriptedState('disableScripted', { id }, (current) => {
    const enabled = { ...current.enabled };
    delete enabled[id];
    return { ...current, enabled };
  });
}

/** The crash guard's verdict: each plugin it names that is still on turns off and gets a notice. */
export function recordScriptedCrash(crash: ScriptedCrash): Promise<boolean> {
  return updateScriptedState('recordScriptedCrash', { ids: crash.ids }, (current) => {
    const enabled = { ...current.enabled };
    const crashNotices = { ...current.crashNotices };
    for (const id of crash.ids) {
      if (!Object.hasOwn(enabled, id)) continue;
      delete enabled[id];
      crashNotices[id] = { at: crash.at, url: crash.url, withIds: [...crash.ids] };
    }
    return { ...current, enabled, crashNotices };
  });
}

export function clearScriptedCrashNotice(id: string): Promise<boolean> {
  return updateScriptedState('clearScriptedCrashNotice', { id }, (current) => {
    const crashNotices = { ...current.crashNotices };
    delete crashNotices[id];
    return { ...current, crashNotices };
  });
}

/** The kill switch: while stopped, no scripted plugin runs and each keeps its enable state. */
export function setScriptedStopped(stopped: boolean): Promise<boolean> {
  return updateScriptedState('setScriptedStopped', { stopped }, (current) => ({
    ...current,
    stopped,
  }));
}

const OFF: ScriptedRunState = { kind: 'off' };
const RUNNING: ScriptedRunState = { kind: 'running' };

export function scriptedRunState(
  plugin: ScriptedPlugin,
  state: ScriptedStateV1,
  availability: UserScriptsAvailability,
): ScriptedRunState {
  const id = plugin.manifest.id;
  const entry = state.enabled[id];
  if (!entry) return state.crashNotices[id] ? { kind: 'paused', reason: 'crash-guard' } : OFF;
  if (entry.reviewHash !== plugin.reviewHash) return { kind: 'paused', reason: 'needs-review' };
  switch (availability.kind) {
    case 'unsupported':
      return { kind: 'paused', reason: 'unsupported' };
    case 'toggle-off':
      return { kind: 'paused', reason: 'user-scripts-off' };
    case 'available':
      return state.stopped ? { kind: 'paused', reason: 'stopped-all' } : RUNNING;
    default: {
      const _exhaustive: never = availability;
      return _exhaustive;
    }
  }
}
