import browser from 'webextension-polyfill';

import {
  type AccountScope,
  accountIsolationService,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import { cloneFolderData } from '@/features/folder/model/folderData';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';
import { mergeFolderData, mergePrompts, mergeTimelineHierarchy } from '@/utils/merge';

import { ForkNodesService } from '../fork/ForkNodesService';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '../timeline/hierarchyStorage';
import type { TimelineHierarchyData } from '../timeline/hierarchyTypes';
import { type FolderTransferHost, debugTransfer, isCurrentTransfer } from './folderTransferHost';
import type { FolderData } from './types';

type SyncDownloadResponse =
  | {
      ok?: boolean;
      error?: string;
      highlights?: { synced?: boolean; count?: number; empty?: boolean };
      data?: {
        folders?: { data?: FolderData };
        prompts?: { items?: PromptItem[] };
        starred?: unknown;
        starredAccountHash?: string;
        stars?: unknown;
        forks?: unknown;
        timelineHierarchy?: { data?: TimelineHierarchyData };
      };
    }
  | undefined;

type SyncSnapshot = {
  prompts: PromptItem[];
  timelineHierarchy: TimelineHierarchyData;
};

type CloudSnapshot = { folders: FolderData } & SyncSnapshot;

function toSyncAccountScope(scope: AccountScope | null): SyncAccountScope | undefined {
  if (!scope) return undefined;
  return {
    accountKey: scope.accountKey,
    accountId: scope.accountId,
    routeUserId: scope.routeUserId,
  };
}

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

function notifySyncError(host: FolderTransferHost, errorMsg: string): void {
  host.notify(
    t('syncError').replace('{error}', () => errorMsg),
    'error',
  );
}

/** Upload this account's folders and the local prompts; the background adds starred messages. */
export async function uploadFolders(host: FolderTransferHost): Promise<void> {
  const context = host.getContext();
  const { session } = context;
  if (!session?.ready) return;
  const accountScope = toSyncAccountScope(session.accountScope);
  const folders = cloneFolderData(session.data);
  try {
    host.notify(t('uploadInProgress'), 'info');
    const timelineHierarchyAccountScope = await resolveTimelineHierarchySyncScope();
    if (!isCurrentTransfer(host, context)) return;

    // Get prompts from storage
    let prompts: PromptItem[] = [];
    try {
      const storageResult = await chrome.storage.local.get(['gvPromptItems']);
      if (storageResult.gvPromptItems) {
        prompts = storageResult.gvPromptItems as PromptItem[];
      }
    } catch (err) {
      console.warn('[FolderTransfer] Could not get prompts for upload:', err);
    }
    if (!isCurrentTransfer(host, context)) return;

    debugTransfer(
      `Uploading - folders: ${folders.folders?.length || 0}, prompts: ${prompts.length}`,
    );

    // Send upload request to background script
    // Background script will also fetch starred messages for Gemini platform
    const response = (await browser.runtime.sendMessage({
      type: 'gv.sync.upload',
      payload: {
        folders,
        prompts,
        platform: 'gemini',
        accountScope,
        timelineHierarchyAccountScope,
      },
    })) as { ok?: boolean; error?: string } | undefined;

    if (response?.ok) {
      host.notify(t('uploadSuccess'), 'success');
    } else {
      notifySyncError(host, response?.error || 'Unknown error');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FolderTransfer] Cloud upload failed:', error);
    notifySyncError(host, errorMsg);
  }
}

/** Read the local prompts and timeline hierarchy the cloud copy merges into. */
async function readLocalSyncSnapshot(scope: SyncAccountScope | undefined): Promise<SyncSnapshot> {
  let prompts: PromptItem[] = [];
  try {
    const storageResult = await chrome.storage.local.get(['gvPromptItems']);
    if (storageResult.gvPromptItems) {
      prompts = storageResult.gvPromptItems as PromptItem[];
    }
  } catch (err) {
    console.warn('[FolderTransfer] Could not get local prompts for merge:', err);
  }

  let timelineHierarchy: TimelineHierarchyData = { conversations: {} };
  try {
    const hierarchyResult = (await chrome.storage.local.get(
      getTimelineHierarchyStorageKeysToRead(scope?.accountKey),
    )) as Record<string, unknown>;
    timelineHierarchy = resolveTimelineHierarchyDataForStorageScope(
      hierarchyResult,
      scope?.accountKey,
      scope?.routeUserId ?? null,
    );
  } catch (err) {
    console.warn('[FolderTransfer] Could not get local timeline hierarchy for merge:', err);
  }
  return { prompts, timelineHierarchy };
}

/** The downloaded payload with an empty value standing in for each missing part. */
function readCloudSnapshot(
  data: NonNullable<NonNullable<SyncDownloadResponse>['data']>,
): CloudSnapshot {
  const cloud = {
    folders: data.folders?.data || { folders: [], folderContents: {} },
    prompts: data.prompts?.items || [],
    timelineHierarchy: data.timelineHierarchy?.data || { conversations: {} },
  };
  debugTransfer(
    `Downloaded - folders: ${cloud.folders.folders?.length || 0}, prompts: ${cloud.prompts.length}`,
  );
  return cloud;
}

/** Merge the cloud copy with local data; folders are merged against `localFolders`. */
function mergeCloudSnapshot(
  cloud: CloudSnapshot,
  localFolders: FolderData,
  local: SyncSnapshot,
): CloudSnapshot {
  const merged = {
    folders: mergeFolderData(localFolders, cloud.folders),
    // Simple ID-based merge
    prompts: mergePrompts(local.prompts, cloud.prompts),
    timelineHierarchy: mergeTimelineHierarchy(local.timelineHierarchy, cloud.timelineHierarchy),
  };

  debugTransfer(
    `Merged - folders: ${merged.folders.folders?.length || 0}, prompts: ${merged.prompts.length}, hierarchy conversations: ${Object.keys(merged.timelineHierarchy.conversations || {}).length}`,
  );
  return merged;
}

/**
 * Download the cloud copy and merge it into local data. Folders save through the host first,
 * then prompts and hierarchy save before the background merges stars and forks.
 */
export async function syncFolders(host: FolderTransferHost): Promise<void> {
  const context = host.getContext();
  const { session } = context;
  if (!session?.ready) return;
  const accountScope = toSyncAccountScope(session.accountScope);
  try {
    host.notify(t('downloadInProgress'), 'info');
    const timelineHierarchyAccountScope = await resolveTimelineHierarchySyncScope();
    if (!isCurrentTransfer(host, context)) return;
    const timelineHierarchyStorageKey = getTimelineHierarchyStorageKey(
      timelineHierarchyAccountScope?.accountKey,
    );

    // Send download request to background script
    const response = (await browser.runtime.sendMessage({
      type: 'gv.sync.download',
      payload: {
        platform: 'gemini',
        accountScope,
        timelineHierarchyAccountScope,
      },
    })) as SyncDownloadResponse;

    if (!isCurrentTransfer(host, context)) return;
    if (!response?.ok) {
      notifySyncError(host, response?.error || 'Download failed');
      return;
    }

    if (!response.data) {
      if (response.highlights?.synced) {
        host.notify(t('syncSuccess'), 'success');
        return;
      }
      host.notify(t('syncNoData') || 'No data in cloud', 'info');
      return;
    }

    const cloud = readCloudSnapshot(response.data);
    const local = await readLocalSyncSnapshot(timelineHierarchyAccountScope);
    if (!isCurrentTransfer(host, context)) return;

    // Merge against the folders as they are now, not as they were when the sync started.
    const merged = mergeCloudSnapshot(cloud, host.getContext().data, local);

    const saved = await host.applyData(merged.folders);
    if (!isCurrentTransfer(host, context)) return;
    if (!saved) {
      host.notify(t('folder_save_error'), 'error');
      return;
    }

    // Save non-star data before asking the serialized owner to merge stars.
    await chrome.storage.local.set({
      gvPromptItems: merged.prompts,
      [timelineHierarchyStorageKey]: merged.timelineHierarchy,
    });
    if (!isCurrentTransfer(host, context)) return;

    const { starred, starredAccountHash, stars, forks } = response.data;
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
              accountScope ?? null,
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
        if (!isCurrentTransfer(host, context)) return;
        if (status === 'merged') restored.push(merge.label);
      } catch (error) {
        if (!isCurrentTransfer(host, context)) return;
        const failed = merges.slice(index).map((pending) => pending.label);
        host.notify(
          t('syncRestorePartial')
            .replace('{restored}', restored.join(t('syncRestoreListSeparator')))
            .replace('{failed}', failed.join(t('syncRestoreListSeparator')))
            .replace('{error}', () => (error instanceof Error ? error.message : 'Unknown error')),
          'error',
        );
        return;
      }
    }

    host.refresh();
    host.notify(t('downloadMergeSuccess'), 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FolderTransfer] Cloud sync failed:', error);
    if (isCurrentTransfer(host, context)) notifySyncError(host, errorMsg);
  }
}
