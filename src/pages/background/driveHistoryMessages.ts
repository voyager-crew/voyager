import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { isDriveSyncFileName } from '@/core/services/GoogleDriveHistoryPayload';
import {
  driveHistoryAccountPlatform,
  driveHistoryBaseName,
} from '@/core/services/GoogleDriveHistoryTransfers';
import {
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  PLUGINS_FILE_NAME,
  FORKS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
  HIGHLIGHTS_FILE_NAME,
} from '@/core/services/GoogleDriveSyncFileNames';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import type { DriveHistoryRestoreTarget } from '@/core/types/driveHistory';
import type { SyncAccountScope } from '@/core/types/sync';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { catalogStarsFileName } from '@/features/savedLibrary/starSitePolicy';
import { catalogTimelineFileName } from '@/features/timeline/catalogHierarchySync';

import {
  isTrustedExtensionPageSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
  getSenderPageUrl,
} from './runtimeMessageRouting';

export function parseSyncScope(value: unknown): SyncAccountScope | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('accountKey' in value) ||
    typeof value.accountKey !== 'string' ||
    !('accountId' in value) ||
    typeof value.accountId !== 'number' ||
    !Number.isFinite(value.accountId) ||
    !('routeUserId' in value) ||
    (value.routeUserId !== null && typeof value.routeUserId !== 'string')
  )
    return null;
  return {
    accountKey: value.accountKey,
    accountId: value.accountId,
    routeUserId: value.routeUserId,
  };
}

export async function handleDriveHistoryMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  drive: GoogleDriveSyncTransfer,
) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('files' in raw) ||
    !Array.isArray(raw.files) ||
    raw.files.length === 0 ||
    !raw.files.every(
      (name): name is string => typeof name === 'string' && isDriveSyncFileName(name),
    )
  )
    return { ok: false, error: 'invalid_sync_files' };
  const platform = parseSyncPlatform('platform' in raw ? raw.platform : undefined);
  if (!platform || !isTrustedSyncMessageSender(sender, platform))
    return { ok: false, error: 'untrusted_sender' };
  if (
    !isTrustedExtensionPageSender(sender) &&
    raw.files.some((name) => {
      const base = driveHistoryBaseName(name);
      const definition = FOLDER_PLATFORMS[platform];
      const allowed = [
        definition.driveFoldersFileName,
        catalogStarsFileName(platform),
        catalogTimelineFileName(platform),
      ];
      if (definition.syncsSharedData)
        allowed.push(PROMPTS_FILE_NAME, SETTINGS_FILE_NAME, PLUGINS_FILE_NAME);
      if (definition.syncsConversationExtras)
        allowed.push(
          FORKS_FILE_NAME,
          TIMELINE_HIERARCHY_FILE_NAME,
          STARRED_FILE_NAME,
          STARS_FILE_NAME,
          HIGHLIGHTS_FILE_NAME,
        );
      return !allowed.includes(base);
    })
  )
    return { ok: false, error: 'untrusted_sender' };
  const explicitScope = parseSyncScope('accountScope' in raw ? raw.accountScope : null);
  const pageUrl = getSenderPageUrl(sender) ?? null;
  const targets: DriveHistoryRestoreTarget[] = [];
  for (const name of raw.files) {
    const owner = driveHistoryAccountPlatform(name, platform);
    const base = driveHistoryBaseName(name);
    const scoped =
      owner !== null &&
      (base === HIGHLIGHTS_FILE_NAME ||
        // Hierarchy has its own page account even when folders use the shared bucket.
        (base === TIMELINE_HIERARCHY_FILE_NAME && explicitScope !== null) ||
        (await accountIsolationService.isIsolationEnabled({ platform: owner, pageUrl })));
    const accountScope = scoped
      ? (explicitScope ??
        toSyncAccountScope(await accountIsolationService.resolveAccountScope({ pageUrl }, false)))
      : null;
    targets.push({ name, accountScope });
  }
  const files = await drive.restorePreviousVersion(
    targets,
    !('interactive' in raw) || raw.interactive !== false,
  );
  return {
    ok: files.every((file) => file.status === 'restored'),
    files,
    state: await drive.getState(),
  };
}
