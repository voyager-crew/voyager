/**
 * Per-plugin install/enable state, persisted in `chrome.storage.local`.
 *
 * Stored under `StorageKeys.PLUGINS_STATE` as `Record<pluginId, PluginStateEntry>`.
 * Local (not sync) because the set of installed plugins can be sizeable and sync
 * quota is precious — same reasoning as the gems list cache. Entitlement
 * (purchased/locked) is intentionally NOT stored here; that comes from the
 * `EntitlementProvider` so it can be server-driven later.
 *
 * Content scripts READ this directly per the content-script rules, but never
 * write it: every writer here holds the plugin-storage lock, which a content
 * script cannot share (see `pluginStorageLock.ts`), so a page sends a setting
 * change to the background through `requestPluginSetting`.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

import { isLocalPluginId } from '../local/localPluginId';
import type { PluginSettingValue, PluginSettings } from '../types';
import { isPluginEnabled } from './pluginDefaults';
import { withPluginStorageLock } from './pluginStorageLock';
import { promptCoverageBindingFor, setPromptCoverageEnabled } from './promptCoverageBinding';

export interface PluginStateEntry {
  readonly enabled: boolean;
  readonly installedAt: number;
  /** User-chosen values for the plugin's declared settings (if any). */
  readonly settings?: PluginSettings;
}
export type PluginStateMap = Readonly<Record<string, PluginStateEntry>>;
export type PluginStateRestoreMode = 'merge' | 'overwrite';

const KEY = StorageKeys.PLUGINS_STATE;

function localArea(): chrome.storage.LocalStorageArea | undefined {
  const g = globalThis as { chrome?: typeof chrome };
  return g.chrome?.storage?.local;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeRecordKey(value: string): boolean {
  return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}

function sanitizeSettings(value: unknown): PluginSettings | undefined {
  if (!isRecord(value)) return undefined;

  const settings: Record<string, PluginSettingValue> = {};
  for (const [key, setting] of Object.entries(value)) {
    if (!isSafeRecordKey(key)) continue;
    if (
      typeof setting === 'string' ||
      typeof setting === 'boolean' ||
      (typeof setting === 'number' && Number.isFinite(setting))
    ) {
      settings[key] = setting;
    }
  }

  return settings;
}

/**
 * Treat Drive payloads as untrusted input. Keep valid plugin entries/settings,
 * drop malformed fields, and never allow prototype-mutating record keys.
 */
export function sanitizePluginState(value: unknown): PluginStateMap {
  if (!isRecord(value)) return {};

  const state: Record<string, PluginStateEntry> = {};
  for (const [id, rawEntry] of Object.entries(value)) {
    if (!id || !isSafeRecordKey(id) || !isRecord(rawEntry)) continue;
    if (typeof rawEntry.enabled !== 'boolean') continue;

    const installedAt =
      typeof rawEntry.installedAt === 'number' && Number.isFinite(rawEntry.installedAt)
        ? rawEntry.installedAt
        : 0;
    const settings = sanitizeSettings(rawEntry.settings);
    state[id] = {
      enabled: rawEntry.enabled,
      installedAt,
      ...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
    };
  }

  return state;
}

/**
 * Read the state map, letting a failed read throw. Every read-modify-write
 * uses this: falling back to `{}` there would write back a map holding only
 * the entry being changed and wipe every other plugin's state.
 */
export async function readPluginStateStrict(
  local: chrome.storage.LocalStorageArea,
): Promise<PluginStateMap> {
  const result = await local.get({ [KEY]: {} });
  return sanitizePluginState(result?.[KEY]);
}

/** The state map with one plugin switched on or off, keeping its settings. */
export function withPluginEnabled(
  state: PluginStateMap,
  id: string,
  enabled: boolean,
  now: number,
): PluginStateMap {
  const previous = state[id];
  return { ...state, [id]: { ...previous, enabled, installedAt: previous?.installedAt ?? now } };
}

/** The state map with one plugin switched off, keeping its settings. */
export function withPluginDisabled(state: PluginStateMap, id: string, now: number): PluginStateMap {
  return withPluginEnabled(state, id, false, now);
}

export async function loadPluginState(): Promise<PluginStateMap> {
  const local = localArea();
  if (!local) return {};
  try {
    return await readPluginStateStrict(local);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadPluginState failed', { error: String(error) });
    }
    return {};
  }
}

/**
 * A local plugin's enable state is a review decision on this device: the cloud
 * copy may switch one off, never on. Otherwise restoring an older backup would
 * enable a newer, unreviewed version imported since that upload.
 */
function clampLocalPluginsEnabled(
  restored: PluginStateMap,
  current: PluginStateMap,
): PluginStateMap {
  const next: Record<string, PluginStateEntry> = { ...restored };
  for (const [id, entry] of Object.entries(restored)) {
    if (!isLocalPluginId(id) || !entry.enabled || current[id]?.enabled === true) continue;
    next[id] = { ...entry, enabled: false };
  }
  return next;
}

/**
 * Restore plugin state downloaded from Drive. Cloud entries win on merge,
 * except that a local plugin is never switched on (`clampLocalPluginsEnabled`).
 * A merge reads local state strictly: if that read fails the restore rejects
 * and writes nothing, rather than writing the cloud entries alone and dropping
 * every local-only plugin's state. An overwrite whose read fails still runs,
 * with every local plugin switched off.
 */
/**
 * True when `restorePluginState` would write `value`: a state map that is empty
 * or keeps at least one valid entry. Anything else leaves local state as is.
 */
export function isRestorablePluginState(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Object.keys(value).length === 0 || Object.keys(sanitizePluginState(value)).length > 0;
}

export async function restorePluginState(
  value: unknown,
  mode: PluginStateRestoreMode = 'merge',
  beforeWrite?: (state: PluginStateMap) => Promise<void>,
): Promise<PluginStateMap> {
  const local = localArea();
  if (!local) return {};

  if (!isRestorablePluginState(value)) {
    return loadPluginState();
  }
  const cloudState = sanitizePluginState(value);
  return withPluginStorageLock(async () => {
    const current =
      mode === 'overwrite'
        ? await readPluginStateStrict(local).catch((): PluginStateMap => ({}))
        : await readPluginStateStrict(local);
    const restored = mode === 'overwrite' ? cloudState : { ...current, ...cloudState };
    const next = clampLocalPluginsEnabled(restored, current);
    if (beforeWrite) await beforeWrite(next);
    await local.set({ [KEY]: next });
    return next;
  });
}

/**
 * Read-modify-write the state map under the plugin-storage lock. A failed read
 * or write is logged, writes nothing and resolves false.
 */
async function updatePluginState(
  label: string,
  context: Record<string, unknown>,
  update: (current: PluginStateMap) => PluginStateMap,
): Promise<boolean> {
  const local = localArea();
  if (!local) return false;
  try {
    await withPluginStorageLock(async () => {
      await local.set({ [KEY]: update(await readPluginStateStrict(local)) });
    });
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn(`${label} failed`, { ...context, error: String(error) });
    }
    return false;
  }
}

export async function setPluginEnabled(id: string, enabled: boolean, url?: string): Promise<void> {
  if (promptCoverageBindingFor(id)) {
    const coverage = promptCoverageBindingFor(id, url);
    if (!coverage) throw new Error('Prompt Manager does not cover the requested URL');
    await setPromptCoverageEnabled(coverage, enabled);
    return;
  }
  await updatePluginState('setPluginEnabled', { id }, (current) =>
    withPluginEnabled(current, id, enabled, Date.now()),
  );
}

/**
 * Persist a single setting value for a plugin (preserving enabled state + other
 * settings). A plugin with no entry keeps its default, so changing a setting of
 * a default-on plugin never switches it off. Resolves false, after logging, when
 * the value was not stored.
 */
export async function setPluginSetting(
  id: string,
  key: string,
  value: PluginSettingValue,
): Promise<boolean> {
  return setPluginSettings(id, { [key]: value });
}

/** Persist several setting values for a plugin in one storage write, as `setPluginSetting`. */
export async function setPluginSettings(
  id: string,
  values: Readonly<Record<string, PluginSettingValue>>,
): Promise<boolean> {
  const keys = Object.keys(values);
  return updatePluginState('setPluginSettings', { id, keys }, (current) => {
    const previous = current[id];
    return {
      ...current,
      [id]: {
        enabled: isPluginEnabled(current, id),
        installedAt: previous?.installedAt ?? Date.now(),
        settings: { ...previous?.settings, ...values },
      },
    };
  });
}

const COLLAPSED_KEY = StorageKeys.PLUGIN_UI_COLLAPSED;

/** Load the set of plugin ids the user has collapsed in the popup list. */
export async function loadCollapsedPlugins(): Promise<string[]> {
  const local = localArea();
  if (!local) return [];
  try {
    const result = await local.get({ [COLLAPSED_KEY]: [] });
    const raw = result?.[COLLAPSED_KEY];
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadCollapsedPlugins failed', { error: String(error) });
    }
    return [];
  }
}

/** Persist whether a plugin card is collapsed (so it stays that way next time). */
export async function setPluginCollapsed(id: string, collapsed: boolean): Promise<void> {
  const local = localArea();
  if (!local) return;
  try {
    const next = new Set(await loadCollapsedPlugins());
    if (collapsed) next.add(id);
    else next.delete(id);
    await local.set({ [COLLAPSED_KEY]: Array.from(next) });
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('setPluginCollapsed failed', { id, error: String(error) });
    }
  }
}

const SEEN_VERSIONS_KEY = StorageKeys.PLUGIN_SEEN_VERSIONS;

/** Plugin id → last version the popup showed on this device (plan D11 badge). */
export async function loadSeenPluginVersions(): Promise<Readonly<Record<string, string>>> {
  const local = localArea();
  if (!local) return {};
  try {
    const result = await local.get({ [SEEN_VERSIONS_KEY]: {} });
    const raw = result?.[SEEN_VERSIONS_KEY];
    if (!isRecord(raw)) return {};
    const seen: Record<string, string> = {};
    for (const [id, version] of Object.entries(raw)) {
      if (isSafeRecordKey(id) && typeof version === 'string') seen[id] = version;
    }
    return seen;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadSeenPluginVersions failed', { error: String(error) });
    }
    return {};
  }
}

/** Record the versions the popup just showed, merged over what was seen before. */
export async function markPluginVersionsSeen(
  versions: Readonly<Record<string, string>>,
): Promise<void> {
  const local = localArea();
  if (!local) return;
  try {
    const current = await loadSeenPluginVersions();
    const next: Record<string, string> = { ...current };
    let changed = false;
    for (const [id, version] of Object.entries(versions)) {
      if (!isSafeRecordKey(id) || typeof version !== 'string') continue;
      if (next[id] === version) continue;
      next[id] = version;
      changed = true;
    }
    if (changed) await local.set({ [SEEN_VERSIONS_KEY]: next });
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('markPluginVersionsSeen failed', { error: String(error) });
    }
  }
}

/** Subscribe to plugin-state changes (e.g. user toggles a plugin in the store UI). */
export function subscribePluginState(callback: (state: PluginStateMap) => void): () => void {
  const g = globalThis as { chrome?: typeof chrome };
  const onChanged = g.chrome?.storage?.onChanged;
  if (!onChanged) return () => {};

  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local' || !changes[KEY]) return;
    callback(sanitizePluginState(changes[KEY].newValue));
  };
  onChanged.addListener(listener);
  return () => {
    try {
      onChanged.removeListener(listener);
    } catch {
      // ignore — context may be gone
    }
  };
}
