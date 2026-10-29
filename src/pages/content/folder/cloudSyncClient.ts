/**
 * Cloud upload and download-merge of one site's folders from its page, through
 * the background messages the popup also sends. The background picks the
 * provider (Google Drive, or iCloud on Safari) and re-reads what it uploads from
 * storage, so the page never decides what lands in the cloud.
 *
 * Each site says how a run starts, saves and what else it restores; the order
 * of the steps, their notices and the stale-run checks are shared. A run drops
 * its result, and its feedback, once the account activation it started in is gone.
 *
 * An upload the background refuses (it would shrink a cloud file, or replace
 * one this build cannot read) asks first; a download's result offers Undo.
 * Results are shown after the completion handshake, with reasons, never raw text.
 */
import browser from 'webextension-polyfill';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import type { CloudApplyDownload } from '@/core/services/CloudSyncApplyPlan';
import { completeCloudSyncDownload } from '@/core/services/CloudSyncDownloadCompletion';
import { planCatalogRestore } from '@/core/services/CloudSyncRestoreKeys';
import {
  readCloudSyncScope,
  isSyncScopeIncluded,
  type SyncScopeRow,
} from '@/core/services/CloudSyncScope';
import {
  recordCloudSyncWrites,
  type StorageWriteKey,
} from '@/core/services/CloudSyncSnapshotService';
import {
  type CloudSyncNotice,
  downloadFailureNotice,
  reasonLines,
  uploadFailureNotice,
  withStatusRecordWarning,
} from '@/core/services/cloudSyncNotices';
import { canUndoCloudSync } from '@/core/services/cloudSyncUndoOffer';
import type { FolderData } from '@/core/types/folder';
import type { SyncAccountScope } from '@/core/types/sync';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import { askUploadGuard } from '@/core/ui/cloudSyncGuardConfirm';
import type { ToastHandle, ToastInput, ToastTone } from '@/core/ui/toast/types';
import { FOLDER_PLATFORMS, type FolderPlatform } from '@/features/folder/platforms';
import {
  applyFolderCloudDownload,
  FolderCloudApplyError,
} from '@/features/folder/services/cloudDownloadApply';
import {
  pullCatalogTimeline,
  restorePulledCatalogTimeline,
  type PulledCatalogTimeline,
} from '@/features/timeline/catalogTimelineCloud';
import { mergeFolderData } from '@/utils/merge';

import { folderApplyFailure, showCloudResult } from './cloudSyncClientNotices';
import type { FolderWriteReceipt } from './storage/FolderStorageAdapter';

/** A downloaded cloud copy: the site's folder file and site-specific parts. */
export type CloudDownload = {
  folders?: unknown;
  kindStatus?: CloudApplyDownload['kindStatus'];
} & Record<string, unknown>;

type SyncResponse =
  | {
      ok?: boolean;
      error?: string;
      highlights?: { synced?: boolean };
      data?: CloudDownload | null;
      snapshotId?: string;
      operationId?: string;
      kindStatus?: CloudApplyDownload['kindStatus'];
      catalog?: PulledCatalogTimeline | null;
      refusedFiles?: UploadGuardRefusedFile[];
      /** Binds a forced retry to the refusal it answers. */
      guardToken?: string;
      excludedRows?: SyncScopeRow[];
      partial?: boolean;
    }
  | undefined;

/** The account scopes a run's messages carry, as the background reads them. */
export type CloudSyncScopes = {
  accountScope?: SyncAccountScope;
  timelineHierarchyAccountScope?: SyncAccountScope;
};

export type CloudSyncTone = ToastTone;

export interface CloudSyncRun {
  /** False once the account activation, or the page view, the run started in is gone. */
  current(): boolean;
  /** What an upload sends, captured when the run started. */
  readonly folders: FolderData;
  /** The owner's captured bucket, including an account suffix where applicable. */
  readonly folderStorageKey?: string;
  /** The folders as they are now; a download merges into these. */
  data(): FolderData;
  /** The scopes to send; resolved after the run's first notice. */
  scopes?(): Promise<CloudSyncScopes>;
  /**
   * Persists merged folders. The unused prompts argument keeps the existing
   * owner callback contract; cloud downloads never supply shared companions.
   */
  save(folders: FolderData, prompts: undefined, beforeWrite?: FolderWriteReceipt): Promise<boolean>;
  /** Prepare an owner and its full write footprint before any download writes. */
  prepareRestore?(
    download: CloudDownload,
    prompts: undefined,
    scopes: CloudSyncScopes,
  ): Promise<{ keys: readonly StorageWriteKey[]; run(snapshotId: string): Promise<boolean> }>;
}

export interface CloudSyncSite {
  platform: FolderPlatform;
  t(key: string): string;
  notify(message: string, tone: CloudSyncTone): void;
  /**
   * A full notice on the transfer channel (title, action, timing), whose
   * handle goes quiet once a later notice takes the channel. `null` when the
   * site showed the message alone. Without it, a result offers no Undo.
   */
  notice?(input: Omit<ToastInput, 'channel' | 'onActivate'>): ToastHandle | null;
  /** Starts a run, or `null` while the folders cannot be edited. */
  begin(): CloudSyncRun | null;
}

const EMPTY_FOLDERS: FolderData = { folders: [], folderContents: {} };

const sendRuntimeMessage = (message: { type: string; payload?: unknown }) =>
  browser.runtime.sendMessage(message);

/** A site turned off in what syncs says so, instead of doing nothing. */
function notifyExcluded(site: CloudSyncSite): void {
  const [line] = reasonLines(site.t, 'sync_scope_excluded', [
    { kind: 'site', siteId: site.platform },
  ]);
  site.notify(line, 'info');
}

/** The cloud folders, or the notice that explains why there are none to merge. */
function readCloudFolders(
  platform: FolderPlatform,
  folders: unknown,
): { ok: true; data: FolderData } | { ok: false; key: string; tone: CloudSyncTone } {
  const format = FOLDER_PLATFORMS[platform].folderExport;
  if (!folders) return { ok: false, key: 'syncNoData', tone: 'info' };
  if (!format) {
    return {
      ok: true,
      data: (folders as { data?: FolderData } | undefined)?.data || EMPTY_FOLDERS,
    };
  }
  // A copy holding another site's conversations is refused whole.
  const read = format.read(folders, 'merge');
  if (read.ok) return { ok: true, data: read.payload.data };
  return {
    ok: false,
    key: read.reason === 'wrong-site' ? 'folder_import_wrong_site' : 'folder_import_invalid_format',
    tone: 'error',
  };
}

/**
 * Uploads this site's folders and timeline data as one background operation.
 * All catalog reads and guards finish before that operation writes any cloud file.
 */
export async function uploadSiteFolders(site: CloudSyncSite): Promise<void> {
  const run = site.begin();
  if (!run) return;
  try {
    const scope = await readCloudSyncScope();
    if (!run.current()) return;
    if (!isSyncScopeIncluded(scope, { kind: 'site', siteId: site.platform })) {
      notifyExcluded(site);
      return;
    }
    site.notify(site.t('uploadInProgress'), 'info');
    const scopes = (await run.scopes?.()) ?? {};
    if (!run.current()) return;
    const payload = { folders: run.folders, platform: site.platform, selection: 'site', ...scopes };
    let response = (await browser.runtime.sendMessage({
      type: 'gv.sync.upload',
      payload,
    })) as SyncResponse;
    if (!run.current()) return;
    // A token that no longer matches (another account, other files) brings a new refusal: ask again.
    while (response?.error === 'upload_guard_refused' && response.refusedFiles?.length) {
      // The menu item that asked has closed, so the confirm sits centred.
      const answer = await askUploadGuard({
        t: site.t,
        platform: site.platform,
        refusedFiles: response.refusedFiles,
        allowMerge: true,
      });
      if (!answer) return;
      if (!run.current()) {
        showCloudResult(site, uploadFailureNotice(site.t, 'account_changed'));
        return;
      }
      if (answer === 'merge') {
        await syncSiteFolders(site);
        return;
      }
      site.notify(site.t('uploadInProgress'), 'info');
      // The refused payload, so the retry keeps the scope the refusal was computed for.
      response = (await browser.runtime.sendMessage({
        type: 'gv.sync.upload',
        payload: {
          ...payload,
          force: true,
          ...(response.guardToken ? { guardToken: response.guardToken } : {}),
        },
      })) as SyncResponse;
      if (!run.current()) return;
    }
    if (response?.ok) {
      showCloudResult(site, { tone: 'ok', headline: site.t('uploadSuccess'), lines: [] });
      return;
    }
    console.error('[FolderCloudSync] Cloud upload failed:', response?.error);
    showCloudResult(
      site,
      uploadFailureNotice(site.t, response?.error ?? null, {
        excludedRows: response?.excludedRows,
        partial: response?.partial,
      }),
    );
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud upload failed:', error);
    showCloudResult(site, uploadFailureNotice(site.t, error));
  }
}

/**
 * Downloads the cloud copy and merges it into the site's folders, then
 * merges this catalog site's cloud timeline outlines (through the page's outline queue) and stars.
 */
export async function syncSiteFolders(site: CloudSyncSite): Promise<void> {
  const run = site.begin();
  if (!run) return;
  let operationId: string | undefined;
  let completed = false;
  // Shown after the completion handshake; `undoFor` is the download's snapshot.
  let outcome: { notice: CloudSyncNotice; undoFor?: string } | { info: string } | null = null;
  let catalogPlanned = false;
  try {
    const scope = await readCloudSyncScope();
    if (!run.current()) return;
    if (!isSyncScopeIncluded(scope, { kind: 'site', siteId: site.platform })) {
      notifyExcluded(site);
      return;
    }
    site.notify(site.t('downloadInProgress'), 'info');
    const scopes = (await run.scopes?.()) ?? {};
    if (!run.current()) return;
    const response = (await browser.runtime.sendMessage({
      type: 'gv.sync.download',
      payload: { platform: site.platform, selection: 'site', ...scopes },
    })) as SyncResponse;
    operationId = response?.operationId;
    if (!run.current()) return;
    if (!response?.ok) {
      console.error('[FolderCloudSync] Cloud download failed:', response?.error);
      outcome = {
        notice: downloadFailureNotice(site.t, {
          cause: response?.error ?? null,
          excludedRows: response?.excludedRows,
        }),
        undoFor: response?.snapshotId,
      };
      return;
    }
    const download: CloudDownload | null | undefined = response.data
      ? { ...response.data, kindStatus: response.kindStatus ?? response.data.kindStatus }
      : response.data;
    const cloud = download
      ? readCloudFolders(
          site.platform,
          download.kindStatus?.folders === 'unrecognized' ||
            download.kindStatus?.folders === 'missing'
            ? null
            : download.folders,
        )
      : null;
    if (cloud && !cloud.ok && cloud.key !== 'syncNoData') {
      site.notify(site.t(cloud.key), cloud.tone);
      return;
    }
    // Plan every owner before the first write, including catalog-only downloads.
    const pulled =
      response.catalog !== undefined
        ? response.catalog
        : await pullCatalogTimeline((message) =>
            sendRuntimeMessage({
              ...message,
              payload: { interactive: true, selection: 'site', platform: site.platform },
            }),
          );
    if (!run.current()) return;
    const catalogPlan = await planCatalogRestore(pulled);
    const catalogKeys = catalogPlan.keys;
    if (!run.current()) return;
    const snapshotId =
      response.snapshotId ??
      (typeof download?.snapshotId === 'string' ? download.snapshotId : undefined);
    const context = {
      source: 'folder-panel-download' as const,
      platform: site.platform,
      accountScope: scopes.accountScope ?? null,
    };
    catalogPlanned = !!catalogPlan.pulled;
    const restoreCatalog = catalogPlan.pulled
      ? async (snapshotId: string) => {
          const restored = catalogPlan.pulled
            ? await restorePulledCatalogTimeline(sendRuntimeMessage, catalogPlan.pulled, snapshotId)
            : false;
          if (catalogPlan.refused) throw new Error('Could not restore timeline outlines');
          return restored || catalogPlan.hadOutlines;
        }
      : undefined;
    const extraOwner = download
      ? await run.prepareRestore?.(download, undefined, scopes)
      : undefined;
    if (!run.current()) return;
    if (!download || !cloud?.ok) {
      // Outlines and stars have files of their own, so a site without a folder copy has them too.
      const result = await applyFolderCloudDownload({
        context,
        snapshotId,
        keys: [...(extraOwner?.keys ?? []), ...catalogKeys],
        current: run.current,
        restoreExtras: extraOwner?.run,
        restoreCatalog,
      });
      if (!run.current() || result.status === 'cancelled') return;
      completed = true;
      // Highlights may sync on their own when there is no folder copy yet.
      outcome =
        result.catalogRestored || response.highlights?.synced || extraOwner?.keys.length
          ? {
              notice: { tone: 'ok', headline: site.t('syncSuccess'), lines: [] },
              undoFor: result.snapshotId,
            }
          : { info: site.t('syncNoData') || 'No data in cloud' };
      return;
    }
    const definition = FOLDER_PLATFORMS[site.platform];
    const folderStorageKey =
      run.folderStorageKey ??
      (scopes.accountScope
        ? buildScopedStorageKey(definition.folderStorageKey, scopes.accountScope.accountKey)
        : definition.folderStorageKey);
    const folderKeys: StorageWriteKey[] = [{ area: 'local', key: folderStorageKey }];
    const keys = [...folderKeys, ...(extraOwner?.keys ?? []), ...catalogKeys];
    if (!run.current()) return;
    const result = await applyFolderCloudDownload({
      context,
      snapshotId,
      keys,
      current: run.current,
      // The save owner retains its pending-edit and account fences.
      saveFolders: (snapshotId) =>
        run.save(mergeFolderData(run.data(), cloud.data), undefined, (items) =>
          recordCloudSyncWrites(
            snapshotId,
            Object.entries(items).map(([key, value]) => ({
              area: 'local',
              key,
              value,
              kind: 'folders',
            })),
          ),
        ),
      restoreExtras: extraOwner?.run,
      restoreCatalog,
    });
    if (!run.current() || result.status === 'cancelled') return;
    completed = true;
    outcome = {
      notice: { tone: 'ok', headline: site.t('downloadMergeSuccess'), lines: [] },
      undoFor: result.snapshotId,
    };
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud sync failed:', error);
    outcome =
      error instanceof FolderCloudApplyError
        ? {
            notice: downloadFailureNotice(
              site.t,
              folderApplyFailure(error, { catalog: catalogPlanned }),
            ),
            undoFor: error.snapshotId,
          }
        : { notice: downloadFailureNotice(site.t, { cause: error }) };
  } finally {
    try {
      await completeCloudSyncDownload(sendRuntimeMessage, operationId, completed);
    } catch (error) {
      console.error('[FolderCloudSync] Cloud sync completion failed:', error);
      // The data landed: its result and Undo stay, with a line that the status was not recorded.
      if (outcome && 'notice' in outcome && completed)
        outcome = { ...outcome, notice: withStatusRecordWarning(site.t, outcome.notice) };
      else if (!outcome && run.current())
        outcome = { notice: downloadFailureNotice(site.t, { cause: error }) };
    }
    if (outcome && run.current()) {
      if ('info' in outcome) site.notify(outcome.info, 'info');
      else {
        const undoFor = (await canUndoCloudSync(outcome.undoFor)) ? outcome.undoFor : undefined;
        if (run.current()) showCloudResult(site, outcome.notice, undoFor);
      }
    }
  }
}
