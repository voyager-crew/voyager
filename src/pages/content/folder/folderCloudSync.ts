/**
 * Gemini's in-page cloud upload and sync: the shared client, plus what only
 * Gemini's cloud copy carries. After the folders save, the
 * timeline hierarchy saves before the background owners merge stars and forks.
 */
import {
  accountIsolationService,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import { isCloudRecord, readCloudApplyPayloads } from '@/core/services/CloudSyncApplyPlan';
import { CloudRestoreError, type CloudRestorePart } from '@/core/services/CloudSyncApplyService';
import { STAR_RESTORE_KEYS, planForkRestore } from '@/core/services/CloudSyncRestoreKeys';
import {
  recordCloudSyncWrites,
  type StorageWriteKey,
} from '@/core/services/CloudSyncSnapshotService';
import type { SyncAccountScope } from '@/core/types/sync';
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

/** The parts of Gemini's cloud copy beyond folders. */
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
 * Saves the merged timeline hierarchy, then asks the serialized owners to
 * merge stars and forks. False when the run went stale. A part that fails
 * throws a `CloudRestoreError` naming what landed (the folders saved first)
 * and what did not, so the result is partial and keeps its Undo.
 */
async function restoreBeyondFolders(
  host: FolderTransferHost,
  context: TransferContext,
  download: GeminiDownload,
  scopes: CloudSyncScopes,
  snapshotId: string,
): Promise<boolean> {
  const current = () => isCurrentTransfer(host, context);
  const { starred, starredAccountHash, stars, forks } = download;
  const restored: CloudRestorePart[] = ['folders'];
  // Only parts the backup has can fail, so an absent fork file is not reported as unrestored.
  const merges = [
    {
      payload: [starred, stars].find((value) => value !== null && typeof value === 'object'),
      kind: 'starred' as const,
      run: async () =>
        (
          await StarredMessagesService.mergeSync(
            { v1: starred, v2: stars, v1AccountHash: starredAccountHash },
            scopes.accountScope ?? null,
            snapshotId,
          )
        ).status,
    },
    {
      payload: forks,
      kind: 'forks' as const,
      run: () =>
        ForkNodesService.mergeCloud(
          isCloudRecord(forks) ? { ...forks, cloudSyncSnapshotId: snapshotId } : forks,
        ),
    },
  ].filter((merge) => merge.payload !== null && typeof merge.payload === 'object');

  const hierarchy = readCloudApplyPayloads(download).timelineHierarchy;
  if (hierarchy.status === 'found') {
    try {
      const hierarchyScope = scopes.timelineHierarchyAccountScope;
      const localHierarchy = await readLocalTimelineHierarchy(hierarchyScope);
      if (!current()) return false;
      const key = getTimelineHierarchyStorageKey(hierarchyScope?.accountKey);
      const value = mergeTimelineHierarchy(localHierarchy, hierarchy.value);
      await recordCloudSyncWrites(snapshotId, [{ area: 'local', key, value, kind: 'hierarchy' }]);
      if (!current()) return false;
      await chrome.storage.local.set({ [key]: value });
      if (!current()) return false;
      restored.push('hierarchy');
    } catch (error) {
      if (!current()) return false;
      throw new CloudRestoreError(
        restored,
        ['hierarchy', ...merges.map(({ kind }) => kind)],
        error,
      );
    }
  }

  for (const [index, merge] of merges.entries()) {
    try {
      const status = await merge.run();
      if (!current()) return false;
      if (status === 'merged') restored.push(merge.kind);
    } catch (error) {
      if (!current()) return false;
      throw new CloudRestoreError(
        restored,
        merges.slice(index).map(({ kind }) => kind),
        error,
      );
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
    // The host's transfer notice, completed in place with its title, action and timing.
    notice: ({ title, message, tone, ...rest }) => {
      const handle = host.notify(title ? `${title} · ${message}` : message, tone);
      if (!handle) return null;
      handle.update({ title, message, tone, ...rest });
      return handle;
    },
    begin: () => {
      const context = host.getContext();
      const { session } = context;
      if (!session?.ready) return null;
      const accountScope = toSyncAccountScope(session.accountScope);
      const current = () => isCurrentTransfer(host, context);
      return {
        current,
        folders: cloneFolderData(session.data),
        folderStorageKey: session.storageKey,
        data: () => host.getContext().data,
        scopes: async () => ({
          accountScope,
          timelineHierarchyAccountScope: await resolveTimelineHierarchySyncScope(),
        }),
        save: async (folders, _prompts, beforeWrite) => {
          const saved = await host.applyData(folders, beforeWrite);
          if (!saved && current()) host.notify(t('folder_save_error'), 'error');
          return saved;
        },
        prepareRestore: async (download: GeminiDownload, _prompts, scopes) => {
          const forks = await planForkRestore(download.forks);
          const hierarchy = readCloudApplyPayloads(download).timelineHierarchy;
          const keys: StorageWriteKey[] = [
            ...(hierarchy.status === 'found'
              ? [
                  {
                    area: 'local' as const,
                    key: getTimelineHierarchyStorageKey(
                      scopes.timelineHierarchyAccountScope?.accountKey,
                    ),
                  },
                ]
              : []),
            ...([download.starred, download.stars].some(
              (value) => value !== null && typeof value === 'object',
            )
              ? STAR_RESTORE_KEYS
              : []),
            ...forks.keys,
          ];
          const planned = forks.skip ? { ...download, forks: undefined } : download;
          return {
            keys,
            run: (snapshotId: string) =>
              restoreBeyondFolders(host, context, planned, scopes, snapshotId),
          };
        },
      };
    },
  };
}

/** Upload this account's folders and its own timeline data. */
export function uploadFolders(host: FolderTransferHost): Promise<void> {
  return uploadSiteFolders(geminiCloudSite(host));
}

/** Download the cloud copy and merge it into this account's folders, hierarchy, stars and forks. */
export function syncFolders(host: FolderTransferHost): Promise<void> {
  return syncSiteFolders(geminiCloudSite(host));
}
