import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { readCloudSyncScope, SyncScopeExcludedError } from '@/core/services/CloudSyncScope';
import type { SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import { FOLDER_PLATFORMS, supportsAccountIsolation } from '@/features/folder/platforms';

import {
  parseCloudSyncSnapshotRun,
  type CloudSyncSnapshotRunRequest,
} from './cloudSyncSnapshotRun';
import { parseSyncScope } from './driveHistoryMessages';
import {
  getSenderPageUrl,
  isTrustedExtensionPageSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
} from './runtimeMessageRouting';

export interface CloudSyncRequest {
  interactive: boolean;
  platform: SyncPlatform;
  accountScope: SyncAccountScope | null;
  timelineHierarchyAccountScope: SyncAccountScope | null;
  highlightAccountScope: SyncAccountScope | null;
  includeHighlights: boolean;
  force: boolean;
  guardToken?: string;
  snapshotRun?: CloudSyncSnapshotRunRequest;
  selection: 'all' | 'site' | 'shared';
}

export function parseCloudSyncRequest(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
): CloudSyncRequest {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw)))
    throw new Error('invalid_sync_request');
  const value = raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw)) : {};
  const platform = parseSyncPlatform(value.platform);
  if (value.guardToken !== undefined && typeof value.guardToken !== 'string')
    throw new Error('invalid_sync_request');
  if (!platform || !isTrustedSyncMessageSender(sender, platform))
    throw new Error('untrusted_sender');
  for (const key of ['interactive', 'includeHighlights', 'force']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error('invalid_sync_request');
  }
  const scopes = ['accountScope', 'timelineHierarchyAccountScope', 'highlightAccountScope'].map(
    (key) => {
      const parsed = parseSyncScope(value[key]);
      if (value[key] !== undefined && value[key] !== null && !parsed)
        throw new Error('invalid_sync_request');
      return parsed;
    },
  );
  const selection = value.selection ?? (isTrustedExtensionPageSender(sender) ? 'all' : 'site');
  if (selection !== 'all' && selection !== 'site' && selection !== 'shared')
    throw new Error('invalid_sync_request');
  // A page's folder button cannot opt into shared data by forging a popup request.
  if (!isTrustedExtensionPageSender(sender) && selection !== 'site')
    throw new Error('untrusted_sender');
  return {
    interactive: value.interactive !== false,
    platform,
    accountScope: scopes[0] ?? null,
    timelineHierarchyAccountScope: scopes[1] ?? null,
    highlightAccountScope: scopes[2] ?? null,
    includeHighlights: value.includeHighlights === true,
    force: value.force === true,
    guardToken: typeof value.guardToken === 'string' ? value.guardToken : undefined,
    snapshotRun: parseCloudSyncSnapshotRun(value.snapshotRun),
    selection,
  };
}

export async function resolveAccountScopeForMessage(
  sender: chrome.runtime.MessageSender,
  platform: SyncPlatform,
  explicitScope?: SyncAccountScope | null,
  persist = true,
): Promise<SyncAccountScope | null> {
  if (!supportsAccountIsolation(platform)) return null;
  const hints = { pageUrl: getSenderPageUrl(sender) ?? null };
  if (!(await accountIsolationService.isIsolationEnabled({ platform, ...hints }))) return null;
  if (explicitScope) return explicitScope;
  return toSyncAccountScope(await accountIsolationService.resolveAccountScope(hints, persist));
}

export async function selectCloudSyncRows(request: CloudSyncRequest) {
  const scope = await readCloudSyncScope();
  const definition = FOLDER_PLATFORMS[request.platform];
  const site = request.selection !== 'shared' && scope.sites[request.platform] !== false;
  const shared = request.selection !== 'site' && definition.syncsSharedData && scope.shared;
  if (request.selection === 'site' && !site)
    throw new SyncScopeExcludedError([{ kind: 'site', siteId: request.platform }]);
  if (request.selection === 'shared' && !shared)
    throw new SyncScopeExcludedError([{ kind: 'shared' }]);
  if (!site && !shared)
    throw new SyncScopeExcludedError([
      { kind: 'site', siteId: request.platform },
      { kind: 'shared' },
    ]);
  return {
    site,
    shared,
    conversationExtras: site && definition.syncsConversationExtras,
    timelineHierarchy: site && definition.syncsConversationExtras,
    scope,
  };
}
