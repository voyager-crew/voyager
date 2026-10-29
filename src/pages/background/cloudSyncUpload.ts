import type { SyncStatusFileRequest } from '@/core/services/CloudSyncBookkeeping';
import { CloudSyncFailure, cloudSyncFailureCode } from '@/core/services/CloudSyncFailure';
import type { CloudSyncUploadGuardTokens } from '@/core/services/CloudSyncUploadGuardTokens';
import {
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  PLUGINS_FILE_NAME,
  FORKS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
} from '@/core/services/GoogleDriveSyncFileNames';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { HighlightDriveSyncCoordinator } from '@/core/services/HighlightDriveSyncCoordinator';
import { exportBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarredMessagesData } from '@/features/savedLibrary/starTypes';
import { catalogTimelineFileName } from '@/features/timeline/catalogHierarchySync';
import type { ForkNodesData } from '@/pages/content/fork/forkTypes';

import { prepareCatalogUpload } from './catalogTimelineSyncMessages';
import {
  loadAuthoritativeSyncPayload,
  loadTimelineHierarchyForSync,
  readPluginStateForSync,
  filterStarredByRouteScope,
  filterForkNodesByRouteScope,
} from './cloudSyncLocalData';
import {
  parseCloudSyncRequest,
  resolveAccountScopeForMessage,
  selectCloudSyncRows,
} from './cloudSyncRequest';
import { isHighlightCloudSyncRequested } from './highlightMessages';

export interface CloudSyncReaders {
  getAllStarredMessages(): Promise<StarredMessagesData>;
  getAllForkNodes(): Promise<ForkNodesData>;
  starStore?: StarStore;
}

export async function handleCloudSyncUpload(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  drive: GoogleDriveSyncTransfer,
  readers: CloudSyncReaders,
  guardTokens: CloudSyncUploadGuardTokens,
  notifyHighlights: (scope: import('@/core/types/sync').SyncAccountScope) => Promise<void>,
) {
  const request = parseCloudSyncRequest(raw, sender);
  const selection = await selectCloudSyncRows(request);
  const { platform, interactive } = request;
  const accountScope = await resolveAccountScopeForMessage(
    sender,
    platform,
    request.accountScope,
    false,
  );
  const timelineScope = selection.timelineHierarchy ? request.timelineHierarchyAccountScope : null;
  const highlightScope = request.highlightAccountScope ?? timelineScope ?? request.accountScope;
  const accountIdentity = await drive.confirmAccountScope(accountScope);
  const timelineIdentity = await drive.confirmAccountScope(timelineScope);
  const {
    folders,
    prompts,
    syncHighlights,
    shouldSyncHighlights,
    starred,
    forks,
    hierarchy,
    settings,
    plugins,
    catalog,
  } = await (async () => {
    try {
      const { folders, prompts } = await loadAuthoritativeSyncPayload(
        platform,
        accountScope,
        selection,
      );
      const syncHighlights =
        selection.site &&
        (await isHighlightCloudSyncRequested(platform, request.includeHighlights));
      const shouldSyncHighlights = syncHighlights && highlightScope !== null;
      const starredRaw =
        selection.conversationExtras && !readers.starStore
          ? await readers.getAllStarredMessages()
          : null;
      const forksRaw = selection.conversationExtras ? await readers.getAllForkNodes() : null;
      const hierarchy = selection.timelineHierarchy
        ? await loadTimelineHierarchyForSync(timelineScope)
        : null;
      const starred =
        starredRaw && accountScope
          ? filterStarredByRouteScope(starredRaw, accountScope.routeUserId)
          : starredRaw;
      const forks =
        forksRaw && accountScope
          ? filterForkNodesByRouteScope(forksRaw, accountScope.routeUserId)
          : forksRaw;
      const settings = selection.shared ? await exportBackupableSyncSettings() : null;
      const plugins = selection.shared ? await readPluginStateForSync() : null;
      // Catalog reads belong to this upload's preflight, before any folder/shared file can change.
      const catalog = await prepareCatalogUpload(
        sender,
        readers.starStore,
        selection.scope,
        request.selection,
        platform,
      );
      return {
        folders,
        prompts,
        syncHighlights,
        shouldSyncHighlights,
        starred,
        forks,
        hierarchy,
        settings,
        plugins,
        catalog,
      };
    } catch (cause) {
      if (cloudSyncFailureCode(cause) === 'untrusted_sender') throw cause;
      throw new CloudSyncFailure(
        'local_read_failed',
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
    }
  })();
  const highlightIdentity = shouldSyncHighlights
    ? await drive.confirmAccountScope(highlightScope)
    : null;
  const localRequests: SyncStatusFileRequest[] = [
    {
      row: platform,
      name: FOLDER_PLATFORMS[platform].driveFoldersFileName,
      accountScope,
      content: folders,
    },
    { row: 'shared', name: PROMPTS_FILE_NAME, accountScope, content: prompts },
    { row: 'shared', name: SETTINGS_FILE_NAME, content: settings?.data },
    { row: 'shared', name: PLUGINS_FILE_NAME, content: plugins },
    { row: platform, name: FORKS_FILE_NAME, accountScope, content: forks },
    {
      row: platform,
      name: TIMELINE_HIERARCHY_FILE_NAME,
      accountScope: timelineScope ?? accountScope,
      content: hierarchy,
    },
    ...Object.entries(catalog.outlines).map(([site, content]) => ({
      row: site,
      name: catalogTimelineFileName(site),
      content,
    })),
  ];
  const highlights =
    shouldSyncHighlights && highlightScope
      ? await new HighlightDriveSyncCoordinator(drive).preparePush(highlightScope, interactive)
      : null;
  if (highlights && !highlights.ok)
    return {
      ok: false,
      error: cloudSyncFailureCode(highlights.result.error) ?? 'highlight_upload_failed',
      state: await drive.getState(),
    };
  const upload = await drive.upload(
    folders,
    prompts,
    starred,
    interactive,
    platform,
    forks,
    hierarchy,
    accountScope,
    timelineScope,
    settings?.data ?? null,
    plugins,
    readers.starStore,
    guardTokens.forRequest(
      {
        provider: (await drive.getState()).provider,
        operation: 'upload',
        platform,
        accountScope,
        timelineScope,
        highlightScope,
        accountIdentity,
        timelineIdentity,
        highlightIdentity,
        files: localRequests.map(({ row, name, accountScope: scope }) => ({
          row,
          name,
          accountScope: scope,
        })),
        selection: request.selection,
      },
      request,
    ),
    accountScope && !request.accountScope
      ? async () => {
          await resolveAccountScopeForMessage(sender, platform);
        }
      : undefined,
    {
      ...selection,
      catalog: { outlines: catalog.outlines, starSites: catalog.starSites },
      includedCatalogSites: catalog.includedCatalogSites,
    },
  );
  if (upload.kind === 'refused')
    return {
      ok: false,
      error: upload.error,
      refusedFiles: upload.refusedFiles,
      guardToken: upload.guardToken,
      state: await drive.getState(),
    };
  const success = upload.kind === 'uploaded';
  if (success && highlights?.ok && highlightScope) {
    const result = await highlights.commit();
    if (!result.ok)
      return {
        ok: false,
        error: cloudSyncFailureCode(result.error) ?? 'highlight_upload_failed',
        partial: true,
        state: await drive.getState(),
      };
    await notifyHighlights(highlightScope);
  }
  // No baseline is written until every selected file and owner has succeeded.
  if (success) await drive.commitBookkeeping(localRequests);
  return {
    ok: success,
    ...(upload.kind === 'failed' && upload.code ? { error: upload.code } : {}),
    selection: { site: selection.site, shared: selection.shared },
    catalog: { sites: Object.keys(catalog.outlines), starSites: catalog.starSites },
    highlights: syncHighlights
      ? { synced: success && shouldSyncHighlights, skipped: !shouldSyncHighlights }
      : undefined,
    state: await drive.getState(),
  };
}
