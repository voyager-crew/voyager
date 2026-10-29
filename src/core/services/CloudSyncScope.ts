import { StorageKeys } from '@/core/types/common';

export interface CloudSyncScope {
  shared: boolean;
  sites: Record<string, boolean>;
}

export type SyncScopeRow = { kind: 'shared' } | { kind: 'site'; siteId: string };

/** Missing and malformed preferences preserve the pre-scope behavior. */
export function parseCloudSyncScope(value: unknown): CloudSyncScope {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('shared' in value) ||
    typeof value.shared !== 'boolean' ||
    !('sites' in value) ||
    !value.sites ||
    typeof value.sites !== 'object' ||
    Array.isArray(value.sites)
  )
    return { shared: true, sites: {} };
  const sites: Array<[string, boolean]> = [];
  for (const [site, included] of Object.entries(value.sites)) {
    if (typeof included !== 'boolean') return { shared: true, sites: {} };
    sites.push([site, included]);
  }
  return { shared: value.shared, sites: Object.fromEntries(sites) };
}

export async function readCloudSyncScope(): Promise<CloudSyncScope> {
  const stored = await chrome.storage.local.get(StorageKeys.CLOUD_SYNC_SCOPE);
  return parseCloudSyncScope(stored[StorageKeys.CLOUD_SYNC_SCOPE]);
}

export function isSyncScopeIncluded(scope: CloudSyncScope, row: SyncScopeRow): boolean {
  return row.kind === 'shared' ? scope.shared : scope.sites[row.siteId] !== false;
}

/** Site-access and the sync sheet share this writer; it changes no data buckets. */
export async function setSyncScopeRow(row: SyncScopeRow, included: boolean): Promise<void> {
  const scope = await readCloudSyncScope();
  const next: CloudSyncScope =
    row.kind === 'shared'
      ? { ...scope, shared: included }
      : { ...scope, sites: { ...scope.sites, [row.siteId]: included } };
  await chrome.storage.local.set({ [StorageKeys.CLOUD_SYNC_SCOPE]: next });
}

export async function markSiteIncluded(siteId: string): Promise<void> {
  await setSyncScopeRow({ kind: 'site', siteId }, true);
}

export class SyncScopeExcludedError extends Error {
  readonly code = 'sync_scope_excluded';
  constructor(readonly rows: readonly SyncScopeRow[]) {
    super('sync_scope_excluded');
  }
}

export async function requireSyncScope(row: SyncScopeRow): Promise<void> {
  if (!isSyncScopeIncluded(await readCloudSyncScope(), row))
    throw new SyncScopeExcludedError([row]);
}
