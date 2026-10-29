/**
 * The packaged official plugins whose on/off switch is an existing Voyager
 * setting, and how to read and write it.
 *
 * For a bound id the legacy sync keys are the only authority: its entry in
 * `gvPluginsState` is ignored, enabled flag and settings alike, so restoring a
 * plugins backup and a settings backup in either order cannot disagree about
 * whether or how the feature runs. Its settings come only from its value
 * bindings (`legacyValueBindings.ts`), `{}` without any. Catalog Prompt Manager
 * reads the existing coverage list (`promptCoverageBinding.ts`). Every unbound
 * id keeps `isPluginEnabled`; scalar bindings live in `legacyEnableBindingTable.ts`.
 *
 * Not part of the
 * CLI bundle (it imports `StorageKeys`): `hostPolicy` must not import it.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { readInitialAIStudioSidebarWidth } from '@/core/utils/aistudioSidebarWidthValues';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { WATERMARK_STORAGE_KEYS } from '@/core/utils/watermarkSettings';

import { resolvePluginSettings } from '../runtime/resolvePluginSettings';
import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { PluginManifest, PluginSettings } from '../types';
import {
  LEGACY_ENABLE_BINDINGS,
  type LegacyEnableBinding,
  type LegacySettingSnapshot,
  type WasChangedLive,
  snapshotValue,
} from './legacyEnableBindingTable';
import { legacyValueKeys } from './legacyValueBindings';
import { isPluginEnabled } from './pluginDefaults';
import { promptCoverageBindingFor } from './promptCoverageBinding';

export {
  LEGACY_ENABLE_BINDINGS,
  type LegacyEnableBinding,
  type LegacySettingSnapshot,
  type WasChangedLive,
};

const neverChangedLive: WasChangedLive = () => false;

type StateEntries = Readonly<
  Record<string, { readonly enabled?: unknown; readonly settings?: PluginSettings } | undefined>
>;

export function legacyBindingFor(id: string): LegacyEnableBinding | null {
  return Object.prototype.hasOwnProperty.call(LEGACY_ENABLE_BINDINGS, id)
    ? LEGACY_ENABLE_BINDINGS[id]
    : null;
}

/** Bound switches ignore plugin-state entries and wait for their sync snapshot. */
export function hasEnableBinding(id: string): boolean {
  return legacyBindingFor(id) !== null || promptCoverageBindingFor(id) !== null;
}

/** The storage keys behind every enable and value binding, each once. */
export function legacyBindingKeys(): readonly string[] {
  return [
    ...new Set([
      ...Object.values(LEGACY_ENABLE_BINDINGS).map((entry) => entry.key),
      ...legacyValueKeys(),
      ...WATERMARK_STORAGE_KEYS,
      StorageKeys.FOLDER_ENABLED,
      StorageKeys.PROMPT_CUSTOM_WEBSITES,
    ]),
  ];
}

/**
 * Whether plugin `id` should run: its legacy keys when bound, otherwise its
 * plugin-state entry. `wasChangedLive` only matters to a binding that
 * derives its switch; a caller without a page lifetime (the popup) omits it.
 */
export function resolveEffectiveEnabled(
  state: StateEntries,
  legacy: LegacySettingSnapshot,
  id: string,
  wasChangedLive: WasChangedLive = neverChangedLive,
  url?: string,
): boolean {
  if (promptCoverageBindingFor(id)) {
    const coverage = promptCoverageBindingFor(id, url);
    return coverage?.read(snapshotValue(legacy, StorageKeys.PROMPT_CUSTOM_WEBSITES)) ?? false;
  }
  const bound = legacyBindingFor(id);
  if (bound) {
    return bound.derive
      ? bound.derive(legacy, wasChangedLive)
      : bound.read(snapshotValue(legacy, bound.key));
  }
  return isPluginEnabled(state, id);
}

/**
 * The settings an unbound plugin runs with: declared defaults merged with its
 * plugin-state entry. A bound official plugin gets `{}` here and never its map
 * values (stray ones must not restart it); the host and popup diagnostics
 * give it its legacy values instead (`legacyBoundSettings`).
 */
export function resolveEffectiveSettings(
  manifest: PluginManifest,
  state: StateEntries,
): PluginSettings {
  if (hasEnableBinding(manifest.id)) return {};
  const entry = Object.prototype.hasOwnProperty.call(state, manifest.id)
    ? state[manifest.id]
    : undefined;
  return resolvePluginSettings(manifest, entry?.settings);
}

/**
 * The sync-storage write that switches bound plugin `id` on or off.
 * Enabling Visual effects selects snow; disabling selects off.
 */
export function legacyEnableWrite(id: string, enabled: boolean): Readonly<Record<string, unknown>> {
  const bound = legacyBindingFor(id);
  if (!bound) throw new Error(`No legacy setting binding for plugin "${id}"`);
  if (id === OFFICIAL_PLUGIN_IDS.visualEffects) {
    return {
      [StorageKeys.GV_VISUAL_EFFECT]: bound.write(enabled),
      [StorageKeys.GV_SNOW_EFFECT]: false,
    };
  }
  return { [bound.key]: bound.write(enabled) };
}

function syncArea(): chrome.storage.SyncStorageArea | undefined {
  const g = globalThis as { chrome?: typeof chrome };
  return g.chrome?.storage?.sync;
}

/**
 * Read every binding key from sync storage; missing switches stay missing.
 * An invalidated extension context rejects (the caller must not mount on a
 * guessed default). Any other failure is logged and read as "all missing",
 * the defaults the native modules have always fallen back to. AI Studio width
 * resolves its localStorage fallback here so a failed read differs from a missing key.
 */
export async function loadLegacySettingSnapshot(
  keys: readonly string[] = legacyBindingKeys(),
): Promise<LegacySettingSnapshot> {
  const sync = syncArea();
  const fallback = () => ({
    [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: readInitialAIStudioSidebarWidth(undefined, false),
  });
  if (!sync) return fallback();
  let stored: Record<string, unknown> | undefined;
  try {
    stored = await sync.get<Record<string, unknown>>([...keys]);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    logger.warn('loadLegacySettingSnapshot failed', { error: String(error) });
    return fallback();
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (stored && Object.prototype.hasOwnProperty.call(stored, key)) snapshot[key] = stored[key];
  }
  // Unlike most settings, AI Studio distinguishes a missing sync key from a failed read.
  snapshot[StorageKeys.AISTUDIO_SIDEBAR_WIDTH] = readInitialAIStudioSidebarWidth(
    snapshot[StorageKeys.AISTUDIO_SIDEBAR_WIDTH],
  );
  return snapshot;
}

/**
 * Report changes to binding keys in sync storage. A removed key arrives as an
 * own key holding `undefined`, so merging the change over a snapshot restores
 * that binding's default.
 */
export function subscribeLegacySettings(
  callback: (changed: LegacySettingSnapshot) => void,
  keys: readonly string[] = legacyBindingKeys(),
): () => void {
  const g = globalThis as { chrome?: typeof chrome };
  const onChanged = g.chrome?.storage?.onChanged;
  if (!onChanged) return () => {};

  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'sync') return;
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
      changed[key] = changes[key]?.newValue;
      any = true;
    }
    if (any) callback(changed);
  };
  try {
    onChanged.addListener(listener);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) return () => {};
    throw error;
  }
  return () => {
    try {
      onChanged.removeListener(listener);
    } catch {
      // ignore — context may be gone
    }
  };
}
