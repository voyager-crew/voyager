import { isLocalPluginId } from '../local/localPluginId';
import {
  type ScriptedCrashNotice,
  type ScriptedEnableEntry,
  type ScriptedStateV1,
  parseScriptHash,
} from './types';

export const EMPTY_SCRIPTED_STATE: ScriptedStateV1 = {
  version: 1,
  stopped: false,
  enabled: {},
  crashNotices: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A state a later build wrote: this build runs none of it and never writes over it. */
export function isNewerScriptedState(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.version) && value.version > 1;
}

function parseEnabled(value: unknown): Record<string, ScriptedEnableEntry> {
  const enabled: Record<string, ScriptedEnableEntry> = {};
  if (!isRecord(value)) return enabled;
  for (const [id, entry] of Object.entries(value)) {
    if (!isLocalPluginId(id) || !isRecord(entry)) continue;
    const reviewHash = parseScriptHash(entry.reviewHash);
    if (!reviewHash || !isFiniteNumber(entry.enabledAt)) continue;
    enabled[id] = { reviewHash, enabledAt: entry.enabledAt };
  }
  return enabled;
}

function parseCrashNotices(value: unknown): Record<string, ScriptedCrashNotice> {
  const notices: Record<string, ScriptedCrashNotice> = {};
  if (!isRecord(value)) return notices;
  for (const [id, entry] of Object.entries(value)) {
    if (!isLocalPluginId(id) || !isRecord(entry)) continue;
    if (!isFiniteNumber(entry.at) || typeof entry.url !== 'string') continue;
    const withIds = Array.isArray(entry.withIds)
      ? entry.withIds.filter(
          (other: unknown): other is string => typeof other === 'string' && isLocalPluginId(other),
        )
      : [];
    notices[id] = { at: entry.at, url: entry.url, withIds };
  }
  return notices;
}

/** Stored scripted state from `unknown`; anything unreadable runs nothing. */
export function parseScriptedState(value: unknown): ScriptedStateV1 {
  if (!isRecord(value) || value.version !== 1) return EMPTY_SCRIPTED_STATE;
  return {
    version: 1,
    stopped: value.stopped === true,
    enabled: parseEnabled(value.enabled),
    crashNotices: parseCrashNotices(value.crashNotices),
  };
}

/** The stored state without one plugin, or undefined when it holds nothing of it to remove. */
export function withoutScriptedPlugin(stored: unknown, id: string): ScriptedStateV1 | undefined {
  if (isNewerScriptedState(stored)) return undefined;
  const state = parseScriptedState(stored);
  if (!Object.hasOwn(state.enabled, id) && !Object.hasOwn(state.crashNotices, id)) return undefined;
  const enabled = { ...state.enabled };
  const crashNotices = { ...state.crashNotices };
  delete enabled[id];
  delete crashNotices[id];
  return { ...state, enabled, crashNotices };
}

/** The stored state without one plugin's enable entry, or undefined when it has none. */
export function withoutScriptedEnable(stored: unknown, id: string): ScriptedStateV1 | undefined {
  if (isNewerScriptedState(stored)) return undefined;
  const state = parseScriptedState(stored);
  if (!Object.hasOwn(state.enabled, id)) return undefined;
  const enabled = { ...state.enabled };
  delete enabled[id];
  return { ...state, enabled };
}
