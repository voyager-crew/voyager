/**
 * Gemini's in-page cloud upload and sync: the shared client, plus what only
 * Gemini's cloud copy carries. After the folders save, the merged prompts and
 * timeline hierarchy save before the background owners merge stars and forks.
 */
import {
  accountIsolationService,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import { cloneFolderData } from '@/features/folder/model/folderData';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';
import { mergeTimelineHierarchy } from '@/utils/merge';

import { ForkNodesService } from '../fork/ForkNodesService';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '../timeline/hierarchyStorage';
import type { TimelineHierarchyData } from '../timeline/hierarchyTypes';
import {
  type CloudDownload,
  type CloudSyncScopes,
  type CloudSyncSite,
  syncSiteFolders,
  uploadSiteFolders,
} from './cloudSyncClient';
import {
  type FolderTransferHost,
  type TransferContext,
  isCurrentTransfer,
} from './folderTransferHost';

/** The parts of Gemini's cloud copy beyond folders and prompts. */
type GeminiDownload = CloudDownload & {
  starred?: unknown;
  starredAccountHash?: string;
  stars?: unknown;
  forks?: unknown;
  timelineHierarchy?: { data?: TimelineHierarchyData };
};

async function resolveTimelineHierarchySyncScope(): Promise<SyncAccountScope | undefined> {
  try {
    const context = detectAccountContextFromDocument(window.location.href, document);
    if (!context.routeUserId && !context.email) {
      return undefined;
    }

    const scope = await accountIsolationService.resolveAccountScope({
      pageUrl: window.location.href,
      routeUserId: context.routeUserId,
      email: context.email,
    });

    return toSyncAccountScope(scope);
  } catch (error) {
    console.warn('[FolderTransfer] Failed to resolve timeline hierarchy sync scope:', error);
    return undefined;
  }
}

async function readLocalTimelineHierarchy(
  scope: SyncAccountScope | undefined,
): Promise<TimelineHierarchyData> {
  try {
    const hierarchyResult = (await chrome.storage.local.get(
      getTimelineHierarchyStorageKeysToRead(scope?.accountKey),
    )) as Record<string, unknown>;
    return resolveTimelineHierarchyDataForStorageScope(
      hierarchyResult,
      scope?.accountKey,
      scope?.routeUserId ?? null,
    );
  } catch (err) {
    console.warn('[FolderTransfer] Could not get local timeline hierarchy for merge:', err);
    return { conversations: {} };
  }
}

/**
 * Saves the merged prompts and timeline hierarchy, then asks the serialized
 * owners to merge stars and forks. False when the run went stale or a part failed.
 */
async function restoreBeyondFolders(
  host: FolderTransferHost,
  context: TransferContext,
  download: GeminiDownload,
  prompts: PromptItem[],
  scopes: CloudSyncScopes,
): Promise<boolean> {
  const current = () => isCurrentTransfer(host, context);
  const hierarchyScope = scopes.timelineHierarchyAccountScope;
  const localHierarchy = await readLocalTimelineHierarchy(hierarchyScope);
  if (!current()) return false;
  // Save non-star data before asking the serialized owner to merge stars.
  await chrome.storage.local.set({
    [StorageKeys.PROMPT_ITEMS]: prompts,
    [getTimelineHierarchyStorageKey(hierarchyScope?.accountKey)]: mergeTimelineHierarchy(
      localHierarchy,
      download.timelineHierarchy?.data || { conversations: {} },
    ),
  });
  if (!current()) return false;

  const { starred, starredAccountHash, stars, forks } = download;
  const restored = [t('folder_title'), t('promptDataMigration')];
  // Only parts the backup has can fail, so an absent fork file is not reported as unrestored.
  const merges = [
    {
      payload: [starred, stars].find((value) => value !== null && typeof value === 'object'),
      label: t('savedLibraryStars'),
      run: async () =>
        (
          await StarredMessagesService.mergeSync(
            { v1: starred, v2: stars, v1AccountHash: starredAccountHash },
            scopes.accountScope ?? null,
          )
        ).status,
    },
    {
      payload: forks,
      label: t('syncRestoreForks'),
      run: () => ForkNodesService.mergeCloud(forks),
    },
  ].filter((merge) => merge.payload !== null && typeof merge.payload === 'object');
  for (const [index, merge] of merges.entries()) {
    try {
      const status = await merge.run();
      if (!current()) return false;
      if (status === 'merged') restored.push(merge.label);
    } catch (error) {
      if (!current()) return false;
      const failed = merges.slice(index).map((pending) => pending.label);
      host.notify(
        t('syncRestorePartial')
          .replace('{restored}', restored.join(t('syncRestoreListSeparator')))
          .replace('{failed}', failed.join(t('syncRestoreListSeparator')))
          .replace('{error}', () => (error instanceof Error ? error.message : 'Unknown error')),
        'error',
      );
      return false;
    }
  }

  host.refresh();
  return true;
}

function geminiCloudSite(host: FolderTransferHost): CloudSyncSite {
  return {
    platform: 'gemini',
    t,
    notify: (message, tone) => host.notify(message, tone),
    begin: () => {
      const context = host.getContext();
      const { session } = context;
      if (!session?.ready) return null;
      const accountScope = toSyncAccountScope(session.accountScope);
      const current = () => isCurrentTransfer(host, context);
      return {
        current,
        folders: cloneFolderData(session.data),
        data: () => host.getContext().data,
        scopes: async () => ({
          accountScope,
          timelineHierarchyAccountScope: await resolveTimelineHierarchySyncScope(),
        }),
        save: async (folders) => {
          const saved = await host.applyData(folders);
          if (!saved && current()) host.notify(t('folder_save_error'), 'error');
          return saved;
        },
        afterSave: (download, prompts, scopes) =>
          restoreBeyondFolders(host, context, download, prompts ?? [], scopes),
      };
    },
  };
}

/** Upload this account's folders and the local prompts; the background adds starred messages. */
export function uploadFolders(host: FolderTransferHost): Promise<void> {
  return uploadSiteFolders(geminiCloudSite(host));
}

/** Download the cloud copy and merge it into this account's folders, prompts, hierarchy, stars and forks. */
export function syncFolders(host: FolderTransferHost): Promise<void> {
  return syncSiteFolders(geminiCloudSite(host));
}
