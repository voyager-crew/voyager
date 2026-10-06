import { useCallback } from 'react';

import {
  accountIsolationService,
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type {
  PluginStateExportPayload,
  PromptItem,
  SettingsExportPayload,
  SyncAccountScope,
  SyncPlatform,
} from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  getFolderPlatformForHost,
  supportsAccountIsolation,
} from '@/features/folder/platforms';
import { createRuntimePromptLibraryClient } from '@/features/prompt/library/promptLibraryMessages';
import { isPromptItemArray } from '@/features/prompt/library/promptLibraryOwner';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import {
  pullCatalogTimeline,
  restorePulledCatalogTimeline,
} from '@/features/timeline/catalogTimelineCloud';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import { ForkNodesService } from '@/pages/content/fork/ForkNodesService';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '@/pages/content/timeline/hierarchyStorage';

import { mergeFolderData, mergeTimelineHierarchy } from '../../../utils/merge';
import { applyCloudRestore, CloudRestoreError, type CloudRestoreMode } from './cloudRestore';

function isFolderData(value: unknown): value is FolderData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as { folders?: unknown; folderContents?: unknown };
  return (
    Array.isArray(data.folders) &&
    typeof data.folderContents === 'object' &&
    data.folderContents !== null
  );
}

function parseStoredFolderData(value: unknown): FolderData | null {
  if (isFolderData(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isFolderData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTimelineHierarchyData(value: unknown): value is TimelineHierarchyData {
  if (typeof value !== 'object' || value === null) return false;
  if (!('conversations' in value)) return false;
  const conversations = (value as { conversations: unknown }).conversations;
  return typeof conversations === 'object' && conversations !== null;
}

type TargetTab = () => Promise<chrome.tabs.Tab | undefined>;

export interface CloudDownloadData {
  folders?: { data?: FolderData };
  prompts?: { items?: PromptItem[] };
  settings?: SettingsExportPayload;
  plugins?: PluginStateExportPayload;
  starred?: unknown;
  starredAccountHash?: string;
  stars?: unknown;
  forks?: unknown;
  timelineHierarchy?: { data?: TimelineHierarchyData };
}

interface CloudSyncContext {
  payload: {
    platform: SyncPlatform;
    accountScope: SyncAccountScope | null;
    timelineHierarchyAccountScope: SyncAccountScope | null;
    highlightAccountScope: SyncAccountScope | null;
    includeHighlights: boolean;
  };
  folderStorageKey: string;
  timelineHierarchyStorageKey: string;
}

// The timeout belongs to the lookup, including when the tab replies first.
async function requestTabData<T>(
  getTargetTab: TargetTab,
  type: string,
  timeout: number,
  platform?: SyncPlatform,
): Promise<T | undefined> {
  const matchesPlatform = (candidate: chrome.tabs.Tab | undefined): boolean =>
    !platform ||
    (!!candidate?.url && getFolderPlatformForHost(new URL(candidate.url).hostname) === platform);
  const tab = await getTargetTab();
  if (!tab?.id || !matchesPlatform(tab)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = (await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeout);
      }),
    ])) as T;
    if (platform) {
      const current = await getTargetTab();
      // Options can outlive their source document; another platform cannot supply this bucket's base.
      if (current?.id !== tab.id || !matchesPlatform(current)) return undefined;
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePageScope(
  platform: SyncPlatform,
  respectIsolationSetting: boolean,
  getTargetTab: TargetTab,
): Promise<SyncAccountScope | null> {
  if (!supportsAccountIsolation(platform)) return null;
  if (respectIsolationSetting) {
    const isolationEnabled = await accountIsolationService.isIsolationEnabled({ platform });
    if (!isolationEnabled) return null;
  }

  let pageUrl = '';
  let routeUserId: string | null = null;
  let email: string | null = null;
  let pageContextAvailable = false;
  try {
    const tab = await getTargetTab();
    pageUrl = tab?.url || '';
    routeUserId = platform === 'gemini' ? extractRouteUserIdFromUrl(pageUrl) : null;
    if (tab?.id) {
      try {
        // Keep context and URL from the same tab lookup.
        const response = await requestTabData<{
          ok?: boolean;
          context?: { routeUserId?: string | null; email?: string | null };
        }>(async () => tab, 'gv.account.getContext', 400);
        if (response?.ok && response.context) {
          pageContextAvailable = true;
          routeUserId = response.context.routeUserId ?? routeUserId;
          email = response.context.email ?? null;
        }
      } catch {
        // A missing content script falls back to the URL.
      }
    }
  } catch {
    // A failed tab query leaves no page context.
  }
  if (!routeUserId && !email && !pageContextAvailable) return null;

  const resolved = await accountIsolationService.resolveAccountScope({
    pageUrl,
    routeUserId,
    email,
  });
  return {
    accountKey: resolved.accountKey,
    accountId: resolved.accountId,
    routeUserId: resolved.routeUserId,
  };
}

/** Capture the independently scoped folders, hierarchy and highlights before sync. */
async function resolveCloudSyncContext(
  platform: SyncPlatform,
  includeHighlights: boolean,
  getTargetTab: TargetTab,
): Promise<CloudSyncContext> {
  const accountScope = await resolvePageScope(platform, true, getTargetTab);
  const extras = FOLDER_PLATFORMS[platform].syncsConversationExtras;
  const timelineHierarchyAccountScope = extras
    ? await resolvePageScope(platform, false, getTargetTab)
    : null;
  const highlightAccountScope =
    extras && includeHighlights ? await resolvePageScope(platform, false, getTargetTab) : null;
  const baseFolderStorageKey = FOLDER_PLATFORMS[platform].folderStorageKey;
  return {
    payload: {
      platform,
      accountScope,
      timelineHierarchyAccountScope,
      highlightAccountScope,
      includeHighlights: extras && includeHighlights,
    },
    folderStorageKey: accountScope
      ? buildScopedStorageKey(baseFolderStorageKey, accountScope.accountKey)
      : baseFolderStorageKey,
    timelineHierarchyStorageKey: extras
      ? getTimelineHierarchyStorageKey(timelineHierarchyAccountScope?.accountKey)
      : StorageKeys.TIMELINE_HIERARCHY,
  };
}

/** Read fresh tab folders, then legacy/object storage, keeping the tab's scope override. */
async function readLocalSyncData(
  context: CloudSyncContext,
  getTargetTab: TargetTab,
  purpose: 'upload' | 'restore',
) {
  const { platform, timelineHierarchyAccountScope } = context.payload;
  const definition = FOLDER_PLATFORMS[platform];
  let accountScope = context.payload.accountScope;
  let folderStorageKey = context.folderStorageKey;
  let folders: FolderData = { folders: [], folderContents: {} };
  let hasLiveFolderSnapshot = false;
  let prompts: PromptItem[] = [];
  let timelineHierarchy: TimelineHierarchyData = { conversations: {} };
  try {
    const response = await requestTabData<{
      ok?: boolean;
      data?: FolderData;
      accountScope?: SyncAccountScope;
    } | null>(getTargetTab, 'gv.sync.requestData', purpose === 'upload' ? 500 : 2000, platform);
    if (response?.ok && response.data) {
      folders = response.data;
      hasLiveFolderSnapshot = true;
      if (supportsAccountIsolation(platform) && response.accountScope) {
        accountScope = response.accountScope;
        folderStorageKey = buildScopedStorageKey(
          FOLDER_PLATFORMS[platform].folderStorageKey,
          accountScope.accountKey,
        );
      }
    }
  } catch (error) {
    console.warn('[CloudSyncSettings] Tab fetch failed/skipped:', error);
  }

  try {
    const storageResult = await chrome.storage.local.get([
      folderStorageKey,
      // A restore leaves prompts to their owner, which reads them in its own turn.
      ...(definition.syncsSharedData && purpose === 'upload' ? [StorageKeys.PROMPT_ITEMS] : []),
      ...(definition.syncsConversationExtras && purpose === 'restore'
        ? getTimelineHierarchyStorageKeysToRead(timelineHierarchyAccountScope?.accountKey)
        : []),
    ]);
    const storedFolders = parseStoredFolderData(storageResult[folderStorageKey]);
    // A successful empty live snapshot may be an unsaved deletion, rather than missing data.
    if (!hasLiveFolderSnapshot && storedFolders) folders = storedFolders;
    const storedPrompts = storageResult[StorageKeys.PROMPT_ITEMS];
    if (definition.syncsSharedData && isPromptItemArray(storedPrompts)) prompts = storedPrompts;
    if (definition.syncsConversationExtras && purpose === 'restore') {
      const resolvedHierarchy = resolveTimelineHierarchyDataForStorageScope(
        storageResult as Record<string, unknown>,
        timelineHierarchyAccountScope?.accountKey,
        timelineHierarchyAccountScope?.routeUserId ?? null,
      );
      if (isTimelineHierarchyData(resolvedHierarchy)) timelineHierarchy = resolvedHierarchy;
    }
  } catch (error) {
    console.error('[CloudSyncSettings] Error loading local data:', error);
  }
  return { folders, prompts, timelineHierarchy, accountScope, folderStorageKey };
}

/** Merge/overwrite, apply the ordered restore, then notify the page only after success. */
async function restoreCloudDownload(
  context: CloudSyncContext,
  getTargetTab: TargetTab,
  data: CloudDownloadData,
  mode: CloudRestoreMode,
  highlightsRestored: boolean,
): Promise<{ foldersMissing: boolean; nameConflicts: number }> {
  const definition = FOLDER_PLATFORMS[context.payload.platform];
  // Pulled before the local read, so the folder merge is not computed from an older read, and
  // before any write, so a failed pull is reported with the other unrestored parts.
  let restoreOutlines: (() => Promise<boolean>) | undefined;
  try {
    const pulled = await pullCatalogTimeline((message) => chrome.runtime.sendMessage(message));
    if (pulled) restoreOutlines = () => restorePulledCatalogTimeline(pulled);
  } catch (error) {
    restoreOutlines = () => Promise.reject(error);
  }
  const local = await readLocalSyncData(context, getTargetTab, 'restore');
  let rawFolders = data.folders?.data;
  if (definition.folderExport && data.folders) {
    const validated = definition.folderExport.read(data.folders, mode);
    if (!validated.ok) {
      throw new CloudRestoreError(
        [],
        ['folders'],
        new Error('Invalid ChatGPT folder backup'),
        validated.reason === 'wrong-site'
          ? 'folder_import_wrong_site'
          : 'folder_import_invalid_format',
      );
    }
    rawFolders = validated.payload.data;
  }
  const hasCloudFolderData = isFolderData(rawFolders);
  const cloudFolders = isFolderData(rawFolders) ? rawFolders : { folders: [], folderContents: {} };
  const cloudPrompts = definition.syncsSharedData ? data.prompts?.items || [] : [];
  const cloudHierarchy = data.timelineHierarchy?.data || { conversations: {} };
  const shouldOverwrite = mode === 'overwrite';
  const nextFolders = shouldOverwrite ? cloudFolders : mergeFolderData(local.folders, cloudFolders);
  const nextHierarchy = shouldOverwrite
    ? cloudHierarchy
    : mergeTimelineHierarchy(local.timelineHierarchy, cloudHierarchy);
  const storageUpdate: Record<string, unknown> = { [local.folderStorageKey]: nextFolders };
  if (definition.syncsConversationExtras) {
    storageUpdate[context.timelineHierarchyStorageKey] = nextHierarchy;
  }
  let nameConflicts = 0;
  await applyCloudRestore({
    mode,
    highlightsRestored,
    plugins:
      definition.syncsSharedData && data.plugins?.format === 'gemini-voyager.plugins.v1'
        ? data.plugins.data
        : undefined,
    settings: definition.syncsSharedData ? data.settings?.data : undefined,
    storageUpdate,
    // AI Studio uploads the shared prompts too. The owner merges them with the library as
    // stored at that moment, so a prompt another tab saves meanwhile is kept.
    restorePrompts: definition.syncsSharedData
      ? async () => {
          const result = await createRuntimePromptLibraryClient().apply({
            kind: 'restore',
            mode,
            items: cloudPrompts,
          });
          nameConflicts = result.nameConflicts;
          return true;
        }
      : undefined,
    foldersMissing: !hasCloudFolderData,
    // Both restore modes merge stars so this tab cannot erase other sites or accounts.
    mergeStarred:
      definition.syncsConversationExtras &&
      [data.starred, data.stars].some((value) => value !== null && typeof value === 'object')
        ? async () =>
            (
              await StarredMessagesService.mergeSync(
                { v1: data.starred, v2: data.stars, v1AccountHash: data.starredAccountHash },
                context.payload.accountScope,
              )
            ).status === 'merged'
        : undefined,
    // Forks only add, like stars, so a restore never drops forks made on this device.
    mergeForks:
      definition.syncsConversationExtras && data.forks && typeof data.forks === 'object'
        ? async () => (await ForkNodesService.mergeCloud(data.forks)) === 'merged'
        : undefined,
    restoreOutlines,
  });
  try {
    const tab = await getTargetTab();
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'gv.folders.reload' });
  } catch (error) {
    console.warn('[CloudSyncSettings] Could not notify content script:', error);
  }
  return { foldersMissing: !hasCloudFolderData, nameConflicts };
}

/** Capture each operation's scope; the download's restore keeps that captured context. */
export function useCloudSyncTransfer(
  platform: SyncPlatform,
  includeHighlights: boolean,
  getTargetTab: TargetTab,
) {
  const prepareUpload = useCallback(async () => {
    const context = await resolveCloudSyncContext(platform, includeHighlights, getTargetTab);
    const local = await readLocalSyncData(context, getTargetTab, 'upload');
    // The background re-reads authoritative storage; retain the popup message contract.
    return {
      ...context.payload,
      accountScope: local.accountScope,
      folders: local.folders,
      prompts: local.prompts,
    };
  }, [platform, includeHighlights, getTargetTab]);

  const prepareDownload = useCallback(async () => {
    const context = await resolveCloudSyncContext(platform, includeHighlights, getTargetTab);
    return {
      payload: context.payload,
      restore: (data: CloudDownloadData, mode: CloudRestoreMode, highlightsRestored: boolean) =>
        restoreCloudDownload(context, getTargetTab, data, mode, highlightsRestored),
    };
  }, [platform, includeHighlights, getTargetTab]);

  return { prepareUpload, prepareDownload };
}
