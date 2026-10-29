import { DRIVE_NOT_AUTHENTICATED } from '@/core/services/CloudSyncFailure';
import {
  captureCloudSyncSnapshot,
  finishCloudSyncRunRow,
} from '@/core/services/CloudSyncSnapshotService';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { pullCloudSyncHighlights } from '@/core/services/cloudSyncHighlights';
import { NATIVE_SITE_IDS } from '@/features/plugins/sites/registry';
import type { StarsExportPayloadV2 } from '@/features/savedLibrary/starSyncPayload';
import { CATALOG_TIMELINE_PULL_MESSAGE } from '@/features/timeline/catalogHierarchySync';
import type { CatalogTimelineBuckets } from '@/features/timeline/catalogHierarchySync';

import { handleCatalogTimelineSyncMessage, knownCatalogSites } from './catalogTimelineSyncMessages';
import { CloudSyncDownloadTracking, recognizedDownloadFiles } from './cloudSyncDownloadTracking';
import { retargetForkNodesToRoute } from './cloudSyncLocalData';
import {
  parseCloudSyncRequest,
  resolveAccountScopeForMessage,
  selectCloudSyncRows,
} from './cloudSyncRequest';
import {
  assertCloudSyncSnapshotRunRequest,
  captureCloudSyncSnapshotRun,
} from './cloudSyncSnapshotRun';
import {
  readSyncStatusRow,
  readCatalogSyncStatusRow,
  type SyncStatusStorageView,
} from './cloudSyncStatusData';
import type { CloudSyncReaders } from './cloudSyncUpload';
import { isHighlightCloudSyncRequested } from './highlightMessages';
import { isTrustedExtensionPageSender } from './runtimeMessageRouting';

export async function handleCloudSyncDownload(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  drive: GoogleDriveSyncTransfer,
  readers: CloudSyncReaders,
  tracking: CloudSyncDownloadTracking,
  notifyHighlights: (scope: import('@/core/types/sync').SyncAccountScope) => Promise<void>,
) {
  const request = parseCloudSyncRequest(raw, sender);
  await assertCloudSyncSnapshotRunRequest(request.snapshotRun, sender);
  const selection = await selectCloudSyncRows(request);
  drive.beginDownloadBookkeeping();
  const { platform, interactive } = request;
  const accountScope = await resolveAccountScopeForMessage(
    sender,
    platform,
    request.accountScope,
    false,
  );
  const timelineScope = selection.timelineHierarchy ? request.timelineHierarchyAccountScope : null;
  const highlightScope = request.highlightAccountScope ?? timelineScope ?? request.accountScope;
  await drive.confirmAccountScope(accountScope);
  await drive.confirmAccountScope(timelineScope);
  const syncHighlights =
    selection.site && (await isHighlightCloudSyncRequested(platform, request.includeHighlights));
  const shouldSyncHighlights = syncHighlights && highlightScope !== null;
  if (shouldSyncHighlights) await drive.confirmAccountScope(highlightScope);
  const catalogCandidates =
    request.selection === 'shared'
      ? []
      : request.selection === 'site'
        ? NATIVE_SITE_IDS.has(platform)
          ? []
          : [platform]
        : [...(await knownCatalogSites(readers.starStore))];
  const includedCatalogSites = catalogCandidates.filter(
    (site) => selection.scope.sites[site] !== false,
  );
  const data = await drive.download(interactive, platform, accountScope, timelineScope, {
    ...selection,
    includedCatalogSites,
  });
  if (!data) {
    const state = await drive.getState();
    if (state.error)
      return {
        ok: false,
        error: state.error === DRIVE_NOT_AUTHENTICATED ? 'not_authenticated' : 'cloud_read_failed',
        state,
      };
  }
  const catalog =
    request.selection !== 'shared'
      ? await handleCatalogTimelineSyncMessage(
          CATALOG_TIMELINE_PULL_MESSAGE,
          { interactive, selection: request.selection, platform },
          sender,
          readers.starStore,
          drive,
        )
      : {
          ok: true as const,
          buckets: {} as CatalogTimelineBuckets,
          stars: {} as Record<string, StarsExportPayloadV2>,
        };
  if (!catalog.ok || !('buckets' in catalog) || !('stars' in catalog)) return catalog;
  const remoteHighlights =
    shouldSyncHighlights && highlightScope
      ? await drive.downloadHighlightsResult(highlightScope, interactive)
      : undefined;
  if (remoteHighlights?.kind === 'failed')
    return { ok: false, error: 'cloud_read_failed', state: await drive.getState() };
  // Metadata reads are also preflight: no local owner has applied anything yet.
  const files = await drive.getDownloadBookkeeping();
  const context = {
    source: isTrustedExtensionPageSender(sender)
      ? ('popup-restore' as const)
      : ('folder-panel-download' as const),
    platform,
    accountScope,
    ...(request.snapshotRun
      ? {
          selection: request.selection,
          timelineHierarchyAccountScope: timelineScope,
          highlightAccountScope: highlightScope,
        }
      : {}),
  };
  const run = await captureCloudSyncSnapshotRun(request.snapshotRun, sender, context);
  try {
    const highlights =
      shouldSyncHighlights && highlightScope
        ? await pullCloudSyncHighlights({
            drive,
            accountScope: highlightScope,
            interactive,
            context,
            snapshotId: run?.snapshotId,
            remote: remoteHighlights,
          })
        : undefined;
    if (highlights && !highlights.ok) {
      if (run) await finishCloudSyncRunRow(run.snapshotId, run.operationId).catch(() => undefined);
      return {
        ...highlights,
        partial: highlights.snapshotId !== undefined,
        state: await drive.getState(),
      };
    }
    const snapshotId =
      highlights && 'snapshotId' in highlights
        ? highlights.snapshotId
        : (run?.snapshotId ??
          (await captureCloudSyncSnapshot({ context, keys: [] }).then(
            (snapshot) => snapshot.id,
            (cause: unknown) => {
              throw new Error('snapshot_failed', { cause });
            },
          )));
    if (highlights?.status === 'found' && highlightScope) await notifyHighlights(highlightScope);
    if (data?.forks?.data?.nodes && accountScope?.routeUserId)
      data.forks = {
        ...data.forks,
        data: retargetForkNodesToRoute(data.forks.data, accountScope.routeUserId),
      };
    const local = async (captured: SyncStatusStorageView) => {
      const base = { platform, accountScope, timelineScope, highlightScope, readers, captured };
      return [
        ...(selection.site ? await readSyncStatusRow({ ...base, row: platform }) : []),
        ...(selection.shared ? await readSyncStatusRow({ ...base, row: 'shared' }) : []),
        ...(
          await Promise.all(
            includedCatalogSites
              .filter((site) => site !== platform)
              .map((site) => readCatalogSyncStatusRow(site, captured)),
          )
        ).flat(),
      ];
    };
    const kindStatus = {
      ...data?.kindStatus,
      ...(highlights ? { highlights: highlights.status } : {}),
    };
    const catalogStatus = 'statuses' in catalog ? (catalog.statuses ?? {}) : {};
    const eligible = recognizedDownloadFiles(files, kindStatus, catalogStatus);
    const operationId = tracking.begin({
      sender,
      snapshotId,
      files: eligible,
      local,
      operationId: run?.operationId,
    });
    return {
      ok: true,
      data,
      snapshotId,
      operationId,
      selection: {
        site: selection.site,
        shared: selection.shared,
        conversationExtras: selection.conversationExtras,
        timelineHierarchy: selection.timelineHierarchy,
      },
      catalog: { outlines: catalog.buckets, stars: catalog.stars },
      kindStatus,
      catalogStatus,
      highlights: highlights
        ? {
            synced: highlights.status === 'found',
            count: highlights.count,
            empty: 'empty' in highlights ? highlights.empty : false,
            status: highlights.status,
          }
        : syncHighlights
          ? { synced: false, skipped: true }
          : undefined,
      state: await drive.getState(),
    };
  } catch (error) {
    if (run) await finishCloudSyncRunRow(run.snapshotId, run.operationId).catch(() => undefined);
    throw error;
  }
}
