import { logger } from '@/core/services/LoggerService';

import { resolveEngineVersion } from '../engineVersion';
import { LocalPluginSource } from '../local/LocalPluginSource';
import { isLocalPluginId } from '../local/localPluginId';
import { HostCatalogSource } from '../remote/HostCatalogSource';
import { protectRemoteNativeIdentity } from '../remote/nativeIdentity';
import { engineSatisfied } from '../semver';
import { isPackagedOfficialPluginId } from '../sites/featureOwners';
import { matchesAnyPattern } from '../sites/matchPattern';
import type {
  PluginManifest,
  PluginSource,
  PluginSourceContext,
  PluginSourceListing,
} from '../types';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../verbs/contracts';
import { BuiltinPluginSource } from './BuiltinPluginSource';
import { BundledCatalogPluginSource } from './BundledCatalogPluginSource';
import { FOLDERS_PLUGIN_IDS } from './bundledFolderPlugins';

export { FOLDERS_PLUGIN_IDS } from './bundledFolderPlugins';

/** Whether only this build may supply the record under `id`. */
export function isBuildOnlyPluginId(id: string): boolean {
  return isPackagedOfficialPluginId(id) || FOLDERS_PLUGIN_IDS.has(id);
}

/**
 * Active sources, in tier order: first-party native plugins, the bundled
 * declarative snapshot, the per-host remote catalog (read from the cache the
 * background refresher maintains; never fetched here), and the plugins the
 * user imported locally.
 */
export function createDefaultPluginSources(): readonly PluginSource[] {
  return [
    new BuiltinPluginSource(),
    new BundledCatalogPluginSource(),
    new HostCatalogSource(),
    new LocalPluginSource(),
  ];
}

/** A newer remote version exists but needs a newer engine than this build has. */
export interface BlockedPluginUpdate {
  readonly version: string;
  readonly engine: string;
}

export interface SourcedPluginManifest {
  readonly manifest: PluginManifest;
  /** Stable source identifier only; never contains a catalog URL. */
  readonly sourceId: string;
  /** Present when the bundled snapshot stays active because the remote update is incompatible (D6). */
  readonly blockedUpdate?: BlockedPluginUpdate;
}

export interface MergePluginRecordsInput {
  readonly builtin: readonly SourcedPluginManifest[];
  /** Bundled snapshot plus any source without a declared kind, in source order. */
  readonly snapshot: readonly SourcedPluginManifest[];
  readonly remote: readonly SourcedPluginManifest[];
  /** User-imported plugins; merged last, only under `local.*` ids. */
  readonly local?: readonly SourcedPluginManifest[];
  /** Explicit revocations from an authoritative catalog for this host. */
  readonly revoked?: readonly string[];
  /** True when remote revocations may apply to `scopeUrl`'s host (kill switch). */
  readonly remoteAuthoritative: boolean;
  /** Page the listing is for; scopes the kill switch to plugins that target it. */
  readonly scopeUrl?: string;
  readonly engineVersion?: string;
}

/**
 * Merge rules (plan D6 / D20), per plugin id:
 *   - builtin ids always come from the builtin source; a remote entry with the
 *     same id is ignored (first-party code must not have its scope or settings
 *     rewritten remotely);
 *   - remote entry compatible with this engine → remote;
 *   - remote entry incompatible, snapshot compatible → snapshot, flagged with
 *     the blocked update so the popup can say "needs a newer Voyager";
 *   - both incompatible → remote (the status machine reports needs-engine);
 *   - remote authoritative for this host and a snapshot plugin targeting this
 *     page is in its revoked list → dropped (kill switch);
 *   - remote unavailable → snapshot as-is;
 *   - `local.*` ids belong to the user's imported plugins: an official or
 *     remote record under one is dropped, and a local record is added last,
 *     outside the kill switch, only when its id is still free;
 *   - packaged official ids (`PACKAGED_OFFICIAL_PLUGIN_IDS`, the Gemini and
 *     AI Studio features) and the catalog sites' folders plugins
 *     (`isBuildOnlyPluginId`) come only from this build: a remote record under one
 *     is dropped, so it can neither replace the bundled record nor stand in for
 *     a missing one, and the kill switch never delists the bundled record.
 */
export function mergePluginRecords(input: MergePluginRecordsInput): SourcedPluginManifest[] {
  const engineVersion = input.engineVersion ?? EFFECTIVE_PLUGIN_ENGINE_VERSION;
  const seen = new Set<string>();
  const revoked = new Set(input.revoked);
  const merged: SourcedPluginManifest[] = [];
  const official = (record: SourcedPluginManifest): boolean => !isLocalPluginId(record.manifest.id);
  const builtin = input.builtin.filter(official);
  const snapshot = input.snapshot.filter(official);
  // Decided by the build's stable id table, never by the owner entry or the
  // remote manifest itself.
  const remoteRecords = input.remote
    .filter((record) => official(record) && !isBuildOnlyPluginId(record.manifest.id))
    .map((record) => {
      const packaged = snapshot.find((entry) => entry.manifest.id === record.manifest.id)?.manifest;
      const manifest = protectRemoteNativeIdentity(record.manifest, packaged);
      return manifest === record.manifest ? record : { ...record, manifest };
    });

  for (const record of builtin) {
    if (seen.has(record.manifest.id)) continue;
    seen.add(record.manifest.id);
    merged.push(record);
  }

  const remoteById = new Map<string, SourcedPluginManifest>();
  for (const record of remoteRecords) {
    const id = record.manifest.id;
    if (seen.has(id) || remoteById.has(id)) continue;
    remoteById.set(id, record);
  }

  for (const record of snapshot) {
    const id = record.manifest.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const remote = remoteById.get(id);
    remoteById.delete(id);
    if (remote) {
      if (engineSatisfied(resolveEngineVersion(remote.manifest.engine), engineVersion)) {
        merged.push(remote);
      } else if (engineSatisfied(resolveEngineVersion(record.manifest.engine), engineVersion)) {
        merged.push({
          ...record,
          blockedUpdate: {
            version: remote.manifest.version,
            engine: resolveEngineVersion(remote.manifest.engine),
          },
        });
      } else {
        merged.push(remote);
      }
      continue;
    }
    const targetsScope =
      !!input.scopeUrl && matchesAnyPattern(input.scopeUrl, record.manifest.matches);
    // A catalog build that omits a plugin by mistake must not uninstall its bundled copy.
    if (input.remoteAuthoritative && targetsScope && revoked.has(id) && !isBuildOnlyPluginId(id))
      continue;
    merged.push(record);
  }

  for (const record of remoteById.values()) {
    if (seen.has(record.manifest.id)) continue;
    seen.add(record.manifest.id);
    merged.push(record);
  }

  for (const record of input.local ?? []) {
    const id = record.manifest.id;
    if (!isLocalPluginId(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(record);
  }

  return merged;
}

async function listingFromSource(
  source: PluginSource,
  context: PluginSourceContext | undefined,
): Promise<PluginSourceListing> {
  try {
    return await source.listWithAuthority!(context);
  } catch (error) {
    logger.warn('Plugin source failed to list', { source: source.id, error: String(error) });
    return { manifests: [], authoritative: false };
  }
}

async function listFromSource(
  source: PluginSource,
  context: PluginSourceContext | undefined,
): Promise<readonly PluginManifest[]> {
  try {
    return await source.list(context);
  } catch (error) {
    logger.warn('Plugin source failed to list', { source: source.id, error: String(error) });
    return [];
  }
}

export async function listPluginManifestsWithSources(
  sources: readonly PluginSource[] = createDefaultPluginSources(),
  context?: PluginSourceContext,
): Promise<readonly SourcedPluginManifest[]> {
  const builtin: SourcedPluginManifest[] = [];
  const snapshot: SourcedPluginManifest[] = [];
  const remote: SourcedPluginManifest[] = [];
  const local: SourcedPluginManifest[] = [];
  let remoteAuthoritative = false;
  const revoked = new Set<string>();

  for (const source of sources) {
    if (source.kind === 'remote' && source.listWithAuthority) {
      // Keep manifests, revocations and authority from the same cache version.
      const listing = await listingFromSource(source, context);
      remote.push(...listing.manifests.map((manifest) => ({ manifest, sourceId: source.id })));
      remoteAuthoritative ||= listing.authoritative;
      if (listing.authoritative) {
        for (const id of listing.revoked ?? []) revoked.add(id);
      }
      continue;
    }
    const records = (await listFromSource(source, context)).map((manifest) => ({
      manifest,
      sourceId: source.id,
    }));
    if (source.kind === 'builtin') {
      builtin.push(...records);
    } else if (source.kind === 'local') {
      local.push(...records);
    } else if (source.kind === 'remote') {
      remote.push(...records);
      if (!remoteAuthoritative && source.isAuthoritative) {
        try {
          remoteAuthoritative = await source.isAuthoritative(context);
        } catch (error) {
          logger.warn('Plugin source authority check failed', {
            source: source.id,
            error: String(error),
          });
        }
      }
    } else {
      snapshot.push(...records);
    }
  }

  const scopeUrl = context?.url ?? (context?.host ? `https://${context.host}/` : undefined);
  return mergePluginRecords({
    builtin,
    snapshot,
    remote,
    local,
    remoteAuthoritative,
    scopeUrl,
    revoked: [...revoked],
  });
}

export async function listPluginManifests(
  sources: readonly PluginSource[] = createDefaultPluginSources(),
  context?: PluginSourceContext,
): Promise<readonly PluginManifest[]> {
  return (await listPluginManifestsWithSources(sources, context)).map(({ manifest }) => manifest);
}

/** Re-read every source (fresh instances; the remote cache may have changed). */
export async function refreshPluginManifests(
  context?: PluginSourceContext,
): Promise<readonly PluginManifest[]> {
  return listPluginManifests(createDefaultPluginSources(), context);
}

export async function refreshPluginManifestsWithSources(
  context?: PluginSourceContext,
): Promise<readonly SourcedPluginManifest[]> {
  return listPluginManifestsWithSources(createDefaultPluginSources(), context);
}

/** Merge manifest lists from multiple sources; first occurrence of an id wins. */
export function dedupeManifestsById(
  lists: readonly (readonly PluginManifest[])[],
): PluginManifest[] {
  const seen = new Set<string>();
  const merged: PluginManifest[] = [];
  for (const list of lists) {
    for (const manifest of list) {
      if (seen.has(manifest.id)) continue;
      seen.add(manifest.id);
      merged.push(manifest);
    }
  }
  return merged;
}
