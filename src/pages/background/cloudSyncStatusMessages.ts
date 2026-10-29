import { accountIsolationService } from '@/core/services/AccountIsolationService';
import type { SyncFileStatus } from '@/core/services/CloudSyncBookkeeping';
import { cloudSyncFailureCode } from '@/core/services/CloudSyncFailure';
import { readCloudSyncScope } from '@/core/services/CloudSyncScope';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import type { SyncPlatform } from '@/core/types/sync';
import {
  FOLDER_PLATFORM_IDS,
  isFolderPlatform,
  supportsAccountIsolation,
} from '@/features/folder/platforms';

import { knownCatalogSites } from './catalogTimelineSyncMessages';
import { resolveAccountScopeForMessage } from './cloudSyncRequest';
import { readSyncStatusRow, readCatalogSyncStatusRow } from './cloudSyncStatusData';
import type { CloudSyncReaders } from './cloudSyncUpload';
import { parseSyncScope } from './driveHistoryMessages';
import {
  isTrustedExtensionPageSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
} from './runtimeMessageRouting';

function aggregate(files: readonly SyncFileStatus[]): SyncFileStatus['status'] {
  if (files.some((file) => file.status === 'newer_in_cloud')) return 'newer_in_cloud';
  if (files.some((file) => file.status === 'to_merge')) return 'to_merge';
  if (files.some((file) => file.status === 'newer_here')) return 'newer_here';
  if (files.some((file) => file.status === 'not_uploaded')) return 'not_uploaded';
  return 'synced';
}

export async function handleCloudSyncStatus(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  drive: GoogleDriveSyncTransfer,
  readers: CloudSyncReaders,
) {
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw))
      : {};
  const platform = parseSyncPlatform(value.platform);
  if (!platform || !isTrustedSyncMessageSender(sender, platform))
    return { ok: false, error: 'untrusted_sender' };
  const extension = isTrustedExtensionPageSender(sender);
  const catalogSites = extension ? await knownCatalogSites(readers.starStore) : new Set<string>();
  const requested: unknown =
    value.rows ?? (extension ? ['shared', ...FOLDER_PLATFORM_IDS, ...catalogSites] : [platform]);
  if (
    !Array.isArray(requested) ||
    !requested.every(
      (row): row is string =>
        typeof row === 'string' &&
        (row === 'shared' || isFolderPlatform(row) || catalogSites.has(row)),
    )
  )
    return { ok: false, error: 'invalid_sync_request' };
  if (!extension && requested.some((row) => row !== platform))
    return { ok: false, error: 'untrusted_sender' };
  const scope = await readCloudSyncScope();
  const rows = [];
  for (const row of new Set(requested)) {
    const included = row === 'shared' ? scope.shared : scope.sites[row] !== false;
    if (!included) {
      rows.push({ row, included, status: 'excluded', files: [] });
      continue;
    }
    const owner: SyncPlatform = isFolderPlatform(row) ? row : platform;
    try {
      // Another site's account cannot be inferred from this popup or the current tab.
      if (
        owner !== platform &&
        supportsAccountIsolation(owner) &&
        (await accountIsolationService.isIsolationEnabled({ platform: owner }))
      )
        continue;
      if (row !== 'shared' && !isFolderPlatform(row)) {
        const files = await drive.getFileStatus(await readCatalogSyncStatusRow(row));
        rows.push({
          row,
          included,
          status: aggregate(files),
          files,
          bothChanged: files.some(
            (file) => file.status === 'newer_in_cloud' && file.localChanged && file.cloudChanged,
          ),
        });
        continue;
      }
      const accountScope = await resolveAccountScopeForMessage(
        sender,
        owner,
        owner === platform ? parseSyncScope(value.accountScope) : null,
        false,
      );
      const timelineScope =
        owner === platform ? parseSyncScope(value.timelineHierarchyAccountScope) : null;
      const highlightScope =
        owner === platform
          ? (parseSyncScope(value.highlightAccountScope) ?? timelineScope ?? accountScope)
          : accountScope;
      await drive.confirmAccountScope(accountScope);
      await drive.confirmAccountScope(timelineScope);
      await drive.confirmAccountScope(highlightScope);
      const requests = await readSyncStatusRow({
        row,
        platform: owner,
        accountScope,
        timelineScope,
        highlightScope,
        readers,
      });
      const files = await drive.getFileStatus(requests);
      rows.push({
        row,
        included,
        status: aggregate(files),
        files,
        bothChanged: files.some(
          (file) => file.status === 'newer_in_cloud' && file.localChanged && file.cloudChanged,
        ),
      });
    } catch (error) {
      const code =
        cloudSyncFailureCode(error) ??
        (error instanceof Error ? error.message : 'sync_status_failed');
      rows.push({
        row,
        included,
        status: code === 'account_unconfirmed' ? 'account_unconfirmed' : 'failed',
        error: code,
        files: [],
      });
    }
  }
  return { ok: !rows.some((row) => row.status === 'failed'), rows };
}
