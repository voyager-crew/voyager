/**
 * Storage for user-imported plugins, in `chrome.storage.local` under
 * `StorageKeys.PLUGIN_LOCAL_MANIFESTS` as `Record<'local.<id>', LocalPluginRecord>`.
 *
 * A record keeps the manifest exactly as imported (CSS inlined, id already
 * namespaced). It is NOT trusted on the way out: `LocalPluginSource` passes it
 * through `validateLocalManifest` on every read, so a stricter guard in a later
 * build also covers plugins imported before it.
 *
 * Content scripts read this directly per the content-script storage rule.
 *
 * Mutations (popup only) are whole-map read-modify-writes, so three rules
 * keep them from losing data:
 *   - a failed read rejects the mutation instead of writing back a map built
 *     from `{}` (which would delete every other plugin);
 *   - entries this build cannot read are written back untouched;
 *   - every mutation holds the plugin-storage lock (`pluginStorageLock.ts`),
 *     shared with every plugin-state writer, so two popups, an import racing a
 *     remove, or a late setting toggle run one after the other instead of
 *     overwriting each other.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

import { withoutScriptedEnable, withoutScriptedPlugin } from '../scripted/parseState';
import {
  type PluginStateEntry,
  readPluginStateStrict,
  withPluginDisabled,
  withPluginEnabled,
} from '../storage/pluginState';
import { withPluginStorageLock } from '../storage/pluginStorageLock';
import type { PluginManifest } from '../types';
import { isLocalPluginId } from './localPluginId';
import { validateLocalManifest } from './validateLocalManifest';

export interface LocalPluginRecord {
  /** Raw manifest as imported, CSS inlined; validated again on every read. */
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly importedAt: number;
  readonly updatedAt: number;
}
export type LocalPluginRecordMap = Readonly<Record<string, LocalPluginRecord>>;

/** Upper bound on stored local plugins; protects storage and every page load. */
export const MAX_LOCAL_PLUGINS = 50;

const KEY = StorageKeys.PLUGIN_LOCAL_MANIFESTS;
function localArea(): chrome.storage.LocalStorageArea | undefined {
  const g = globalThis as { chrome?: typeof chrome };
  return g.chrome?.storage?.local;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Keep well-formed `local.*` entries only; never trust the stored shape. */
export function sanitizeLocalPluginRecords(value: unknown): LocalPluginRecordMap {
  if (!isRecord(value)) return {};
  const records: Record<string, LocalPluginRecord> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isLocalPluginId(id) || !isRecord(entry) || !isRecord(entry.manifest)) continue;
    if (entry.manifest.id !== id) continue;
    const importedAt = finiteOr(entry.importedAt, 0);
    records[id] = {
      manifest: entry.manifest,
      importedAt,
      updatedAt: finiteOr(entry.updatedAt, importedAt),
    };
    if (Object.keys(records).length >= MAX_LOCAL_PLUGINS) break;
  }
  return records;
}

/** The stored map as-is (unknown entries included); a failed read throws. */
async function readStoredMapStrict(
  local: chrome.storage.LocalStorageArea,
): Promise<Record<string, unknown>> {
  const result = await local.get({ [KEY]: {} });
  const value: unknown = result?.[KEY];
  return isRecord(value) ? value : {};
}

export async function loadLocalPluginRecords(): Promise<LocalPluginRecordMap> {
  const local = localArea();
  if (!local) return {};
  try {
    const result = await local.get({ [KEY]: {} });
    return sanitizeLocalPluginRecords(result?.[KEY]);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('loadLocalPluginRecords failed', { error: String(error) });
    }
    return {};
  }
}

/**
 * What a review saw installed under one id: null when nothing was, else the
 * stored record exactly (content and update time), so any import, edit or
 * removal since then reads as a change.
 */
export function localPluginRecordSnapshot(record: LocalPluginRecord | undefined): string | null {
  return record ? JSON.stringify([record.updatedAt, record.manifest]) : null;
}

/** The install under an id is no longer the one the user reviewed; nothing was written. */
export class LocalPluginChangedError extends Error {
  constructor(id: string) {
    super(`${id} changed since it was reviewed`);
    this.name = 'LocalPluginChangedError';
  }
}

export interface SaveLocalPluginOptions {
  /**
   * `localPluginRecordSnapshot` of the install the user reviewed. When given,
   * the save happens only while the install is still exactly that one, checked
   * under the storage lock; otherwise it rejects with `LocalPluginChangedError`.
   */
  readonly expectedInstalled?: string | null;
}

/**
 * Store a VALIDATED manifest under its (namespaced) id, replacing any previous
 * version, and switch the plugin off in the SAME storage write, a scripted
 * plugin's device-local enable included, so every import lands off, an
 * identical one too. One write means no observer (a page's PluginHost, the
 * scripted registrar, another popup) can ever see the new version under an
 * old enable, and a popup closed mid-import leaves either the old state or the
 * new disabled one. Callers validate first: a
 * failed import never reaches this, so the previous version stays in place.
 * Rejects, writing nothing, when either read or the write fails.
 */
export async function saveLocalPluginRecord(
  manifest: Readonly<Record<string, unknown>>,
  now: number = Date.now(),
  options: SaveLocalPluginOptions = {},
): Promise<void> {
  const id = manifest.id;
  if (typeof id !== 'string' || !isLocalPluginId(id)) {
    throw new Error('local plugin id must be namespaced under local.');
  }
  const local = localArea();
  if (!local) throw new Error('extension storage is unavailable');
  await withPluginStorageLock(async () => {
    const stored = await readStoredMapStrict(local);
    const state = await readPluginStateStrict(local);
    const current = sanitizeLocalPluginRecords(stored);
    const previous = current[id];
    if (
      options.expectedInstalled !== undefined &&
      localPluginRecordSnapshot(previous) !== options.expectedInstalled
    ) {
      throw new LocalPluginChangedError(id);
    }
    if (!previous && Object.keys(current).length >= MAX_LOCAL_PLUGINS) {
      throw new Error(`at most ${MAX_LOCAL_PLUGINS} local plugins can be installed`);
    }
    const record: LocalPluginRecord = {
      manifest,
      importedAt: previous?.importedAt ?? now,
      updatedAt: now,
    };
    const scripted = await local.get({ [StorageKeys.PLUGIN_SCRIPTED_STATE]: {} });
    const nextScripted = withoutScriptedEnable(scripted?.[StorageKeys.PLUGIN_SCRIPTED_STATE], id);
    await local.set({
      [KEY]: { ...stored, [id]: record },
      [StorageKeys.PLUGINS_STATE]: withPluginDisabled(state, id, now),
      ...(nextScripted ? { [StorageKeys.PLUGIN_SCRIPTED_STATE]: nextScripted } : {}),
    });
  });
}

/**
 * Delete one record together with its enable state and settings, in one write
 * so no toggle can slip in between. A scripted plugin also loses its review, so
 * importing the same script again needs a new one. Rejects, writing nothing,
 * when a read or the write fails.
 */
export async function removeLocalPluginRecord(id: string): Promise<void> {
  const local = localArea();
  if (!local) return;
  await withPluginStorageLock(async () => {
    const stored = await readStoredMapStrict(local);
    const state = await readPluginStateStrict(local);
    if (!Object.hasOwn(stored, id) && !Object.hasOwn(state, id)) return;
    const next: Record<string, unknown> = { ...stored };
    delete next[id];
    const nextState: Record<string, PluginStateEntry> = { ...state };
    delete nextState[id];
    const scripted = await local.get({ [StorageKeys.PLUGIN_SCRIPTED_STATE]: {} });
    const nextScripted = withoutScriptedPlugin(scripted?.[StorageKeys.PLUGIN_SCRIPTED_STATE], id);
    await local.set({
      [KEY]: next,
      [StorageKeys.PLUGINS_STATE]: nextState,
      ...(nextScripted ? { [StorageKeys.PLUGIN_SCRIPTED_STATE]: nextScripted } : {}),
    });
  });
}

/**
 * Switch a local plugin on only while its stored content is exactly the
 * manifest the user reviewed (`seen`, as `LocalPluginSource` listed it). A
 * re-import in another popup between that review and this write publishes the
 * new content disabled; an enable started before it must not switch the new
 * content on, and a version check would miss a same-version edit. `changed`
 * when the content changed or is gone; `write_failed` when storage could not
 * be read or written. Neither writes anything.
 */
export type LocalPluginEnableResult = 'enabled' | 'changed' | 'write_failed';

export async function enableLocalPluginIfUnchanged(
  seen: PluginManifest,
  now: number = Date.now(),
): Promise<LocalPluginEnableResult> {
  const local = localArea();
  if (!local) return 'write_failed';
  try {
    return await withPluginStorageLock(async () => {
      const record = sanitizeLocalPluginRecords(await readStoredMapStrict(local))[seen.id];
      // Read the way `LocalPluginSource` listed `seen`, host policy deferred.
      const current = record
        ? validateLocalManifest(record.manifest, undefined, { hostPolicy: 'defer' })
        : null;
      if (!current?.success || JSON.stringify(current.data.manifest) !== JSON.stringify(seen)) {
        logger.warn('Local plugin changed since it was reviewed; not enabling', { id: seen.id });
        return 'changed';
      }
      const state = await readPluginStateStrict(local);
      await local.set({
        [StorageKeys.PLUGINS_STATE]: withPluginEnabled(state, seen.id, true, now),
      });
      return 'enabled';
    });
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('enableLocalPluginIfUnchanged failed', { id: seen.id, error: String(error) });
    }
    return 'write_failed';
  }
}

/** Subscribe to imports, updates and removals of local plugins. */
export function subscribeLocalPlugins(callback: () => void): () => void {
  const g = globalThis as { chrome?: typeof chrome };
  const onChanged = g.chrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && changes[KEY]) callback();
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
