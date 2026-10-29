/**
 * Cloud upload and download-merge of one site's folders from its page, through
 * the background messages the popup also sends. The background picks the
 * provider (Google Drive, or iCloud on Safari) and re-reads what it uploads from
 * storage, so the page never decides what lands in the cloud.
 *
 * Each site says how a run starts, saves and what else it restores; the order
 * of the steps, their notices and the stale-run checks are shared. A run drops
 * its result, and its feedback, once the account activation it started in is gone.
 */
import browser from 'webextension-polyfill';

import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { planCatalogRestore } from '@/core/services/CloudSyncRestoreKeys';
import {
  recordCloudSyncWrites,
  type StorageWriteKey,
} from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import { FOLDER_PLATFORMS, type FolderPlatform } from '@/features/folder/platforms';
import { applyFolderCloudDownload } from '@/features/folder/services/cloudDownloadApply';
import {
  pullCatalogTimeline,
  pushCatalogTimeline,
  restorePulledCatalogTimeline,
} from '@/features/timeline/catalogTimelineCloud';
import { mergeFolderData, mergePrompts } from '@/utils/merge';

import type { FolderWriteReceipt } from './storage/FolderStorageAdapter';

/** A downloaded cloud copy: the site's folder file, the shared prompts, and site-specific parts. */
export type CloudDownload = {
  folders?: unknown;
  prompts?: { items?: PromptItem[] };
} & Record<string, unknown>;

type SyncResponse =
  | {
      ok?: boolean;
      error?: string;
      highlights?: { synced?: boolean };
      data?: CloudDownload | null;
      snapshotId?: string;
    }
  | undefined;

/** The account scopes a run's messages carry, as the background reads them. */
export type CloudSyncScopes = {
  accountScope?: SyncAccountScope;
  timelineHierarchyAccountScope?: SyncAccountScope;
};

export type CloudSyncTone = 'info' | 'success' | 'error';

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
   * Persists the merged folders, with the merged prompts on a site that shares
   * them. A failure is reported here, by the site or its store.
   */
  save(
    folders: FolderData,
    prompts: PromptItem[] | undefined,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean>;
  /** Prepare an owner and its full write footprint before any download writes. */
  prepareRestore?(
    download: CloudDownload,
    prompts: PromptItem[] | undefined,
    scopes: CloudSyncScopes,
  ): Promise<{ keys: readonly StorageWriteKey[]; run(snapshotId: string): Promise<boolean> }>;
}

export interface CloudSyncSite {
  platform: FolderPlatform;
  t(key: string): string;
  notify(message: string, tone: CloudSyncTone): void;
  /** Starts a run, or `null` while the folders cannot be edited. */
  begin(): CloudSyncRun | null;
}

const EMPTY_FOLDERS: FolderData = { folders: [], folderContents: {} };

const sendRuntimeMessage = (message: { type: string; payload?: unknown }) =>
  browser.runtime.sendMessage(message);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function notifySyncError(site: CloudSyncSite, message: string): void {
  site.notify(
    site.t('syncError').replace('{error}', () => message),
    'error',
  );
}

async function readLocalPrompts(): Promise<PromptItem[]> {
  try {
    const result = await chrome.storage.local.get([StorageKeys.PROMPT_ITEMS]);
    return (result[StorageKeys.PROMPT_ITEMS] as PromptItem[] | undefined) || [];
  } catch (error) {
    console.warn('[FolderCloudSync] Could not read prompts:', error);
    return [];
  }
}

/** The cloud folders, or the notice that explains why there are none to merge. */
function readCloudFolders(
  platform: FolderPlatform,
  folders: unknown,
): { ok: true; data: FolderData } | { ok: false; key: string; tone: CloudSyncTone } {
  const format = FOLDER_PLATFORMS[platform].folderExport;
  if (!format) {
    return {
      ok: true,
      data: (folders as { data?: FolderData } | undefined)?.data || EMPTY_FOLDERS,
    };
  }
  if (!folders) return { ok: false, key: 'syncNoData', tone: 'info' };
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
 * Uploads the site's folders, and on a site that shares them the local prompts, then this
 * catalog site's timeline outlines and stars (the background syncs none for Gemini or AI Studio
 * pages; a Gemini upload carries the catalog star files itself).
 */
export async function uploadSiteFolders(site: CloudSyncSite): Promise<void> {
  const run = site.begin();
  if (!run) return;
  const { syncsSharedData } = FOLDER_PLATFORMS[site.platform];
  try {
    site.notify(site.t('uploadInProgress'), 'info');
    const scopes = (await run.scopes?.()) ?? {};
    if (!run.current()) return;
    const prompts = syncsSharedData ? await readLocalPrompts() : [];
    if (!run.current()) return;
    const response = (await browser.runtime.sendMessage({
      type: 'gv.sync.upload',
      payload: { folders: run.folders, prompts, platform: site.platform, ...scopes },
    })) as SyncResponse;
    if (!run.current()) return;
    if (!response?.ok) {
      notifySyncError(site, response?.error || 'Unknown error');
      return;
    }
    await pushCatalogTimeline(sendRuntimeMessage, {
      stars: !FOLDER_PLATFORMS[site.platform].syncsConversationExtras,
    });
    if (!run.current()) return;
    site.notify(site.t('uploadSuccess'), 'success');
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud upload failed:', error);
    notifySyncError(site, errorText(error));
  }
}

/**
 * Downloads the cloud copy and merges it into the site's folders (and shared prompts), then
 * merges this catalog site's cloud timeline outlines (through the page's outline queue) and stars.
 */
export async function syncSiteFolders(site: CloudSyncSite): Promise<void> {
  const run = site.begin();
  if (!run) return;
  const { syncsSharedData } = FOLDER_PLATFORMS[site.platform];
  try {
    site.notify(site.t('downloadInProgress'), 'info');
    const scopes = (await run.scopes?.()) ?? {};
    if (!run.current()) return;
    const response = (await browser.runtime.sendMessage({
      type: 'gv.sync.download',
      payload: { platform: site.platform, ...scopes },
    })) as SyncResponse;
    if (!run.current()) return;
    if (!response?.ok) {
      notifySyncError(site, response?.error || 'Download failed');
      return;
    }
    const download = response.data;
    const cloud = download ? readCloudFolders(site.platform, download.folders) : null;
    if (cloud && !cloud.ok && cloud.key !== 'syncNoData') {
      site.notify(site.t(cloud.key), cloud.tone);
      return;
    }
    // Plan every owner before the first write, including catalog-only downloads.
    const pulled = await pullCatalogTimeline(sendRuntimeMessage);
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
    const restoreCatalog = catalogPlan.pulled
      ? async (snapshotId: string) => {
          const restored = catalogPlan.pulled
            ? await restorePulledCatalogTimeline(sendRuntimeMessage, catalogPlan.pulled, snapshotId)
            : false;
          if (catalogPlan.refused) throw new Error('Could not restore timeline outlines');
          return restored || catalogPlan.hadOutlines;
        }
      : undefined;
    if (!download || !cloud?.ok) {
      // Outlines and stars have files of their own, so a site without a folder copy has them too.
      const result = await applyFolderCloudDownload({
        context,
        snapshotId,
        keys: catalogKeys,
        current: run.current,
        restoreCatalog,
      });
      if (!run.current() || result.status === 'cancelled') return;
      // Highlights may sync on their own when there is no folder copy yet.
      if (result.catalogRestored || response.highlights?.synced)
        site.notify(site.t('syncSuccess'), 'success');
      else site.notify(site.t('syncNoData') || 'No data in cloud', 'info');
      return;
    }
    const prompts = syncsSharedData
      ? mergePrompts(await readLocalPrompts(), download.prompts?.items || [])
      : undefined;
    if (!run.current()) return;
    const definition = FOLDER_PLATFORMS[site.platform];
    const folderStorageKey =
      run.folderStorageKey ??
      (scopes.accountScope
        ? buildScopedStorageKey(definition.folderStorageKey, scopes.accountScope.accountKey)
        : definition.folderStorageKey);
    const extraOwner = await run.prepareRestore?.(download, prompts, scopes);
    const folderKeys: StorageWriteKey[] = [
      { area: 'local', key: folderStorageKey },
      // AI Studio saves shared prompts as companions; Gemini's prepared owner declares them.
      ...(syncsSharedData &&
      !extraOwner?.keys.some((key) => key.area === 'local' && key.key === StorageKeys.PROMPT_ITEMS)
        ? [{ area: 'local' as const, key: StorageKeys.PROMPT_ITEMS }]
        : []),
    ];
    const keys = [...folderKeys, ...(extraOwner?.keys ?? []), ...catalogKeys];
    if (!run.current()) return;
    const result = await applyFolderCloudDownload({
      context,
      snapshotId,
      keys,
      current: run.current,
      // The save owner retains its pending-edit and account fences.
      saveFolders: (snapshotId) =>
        run.save(mergeFolderData(run.data(), cloud.data), prompts, (items) =>
          recordCloudSyncWrites(
            snapshotId,
            Object.entries(items).map(([key, value]) => ({
              area: 'local',
              key,
              value,
              kind: key === StorageKeys.PROMPT_ITEMS ? 'prompts' : 'folders',
            })),
          ),
        ),
      restoreExtras: extraOwner?.run,
      restoreCatalog,
    });
    if (!run.current() || result.status === 'cancelled') return;
    site.notify(site.t('downloadMergeSuccess'), 'success');
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud sync failed:', error);
    notifySyncError(site, errorText(error));
  }
}
