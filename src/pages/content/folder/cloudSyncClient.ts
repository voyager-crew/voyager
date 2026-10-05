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

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope } from '@/core/types/sync';
import { FOLDER_PLATFORMS, type FolderPlatform } from '@/features/folder/platforms';
import { mergeFolderData, mergePrompts } from '@/utils/merge';

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
  /** The folders as they are now; a download merges into these. */
  data(): FolderData;
  /** The scopes to send; resolved after the run's first notice. */
  scopes?(): Promise<CloudSyncScopes>;
  /**
   * Persists the merged folders, with the merged prompts on a site that shares
   * them. A failure is reported here, by the site or its store.
   */
  save(folders: FolderData, prompts: PromptItem[] | undefined): Promise<boolean>;
  /** Restores the rest of the download once folders saved; false when it stopped (and said why). */
  afterSave?(
    download: CloudDownload,
    prompts: PromptItem[] | undefined,
    scopes: CloudSyncScopes,
  ): Promise<boolean>;
}

export interface CloudSyncSite {
  platform: FolderPlatform;
  t(key: string): string;
  notify(message: string, tone: CloudSyncTone): void;
  /** Starts a run, or `null` while the folders cannot be edited. */
  begin(): CloudSyncRun | null;
}

const EMPTY_FOLDERS: FolderData = { folders: [], folderContents: {} };

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

/** Uploads the site's folders, and on a site that shares them the local prompts. */
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
    if (response?.ok) site.notify(site.t('uploadSuccess'), 'success');
    else notifySyncError(site, response?.error || 'Unknown error');
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud upload failed:', error);
    notifySyncError(site, errorText(error));
  }
}

/** Downloads the cloud copy and merges it into the site's folders (and shared prompts). */
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
    if (!download) {
      // Highlights may sync on their own when there is no folder copy yet.
      if (response.highlights?.synced) site.notify(site.t('syncSuccess'), 'success');
      else site.notify(site.t('syncNoData') || 'No data in cloud', 'info');
      return;
    }
    const cloud = readCloudFolders(site.platform, download.folders);
    if (!cloud.ok) {
      site.notify(site.t(cloud.key), cloud.tone);
      return;
    }
    const prompts = syncsSharedData
      ? mergePrompts(await readLocalPrompts(), download.prompts?.items || [])
      : undefined;
    if (!run.current()) return;
    // Merge against the folders as they are now, not as they were when the sync started.
    const saved = await run.save(mergeFolderData(run.data(), cloud.data), prompts);
    if (!run.current() || !saved) return;
    if (run.afterSave && !(await run.afterSave(download, prompts, scopes))) return;
    if (!run.current()) return;
    site.notify(site.t('downloadMergeSuccess'), 'success');
  } catch (error) {
    if (!run.current()) return;
    console.error('[FolderCloudSync] Cloud sync failed:', error);
    notifySyncError(site, errorText(error));
  }
}
