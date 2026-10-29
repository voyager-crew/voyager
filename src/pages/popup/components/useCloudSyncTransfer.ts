import { useCallback, useEffect, useMemo } from 'react';

import {
  accountIsolationService,
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import {
  applyPopupCatalogDownload,
  applyPopupCloudDownload,
  type CloudDownloadData,
} from '@/core/services/CloudSyncDownloadService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  getFolderPlatformForHost,
  supportsAccountIsolation,
} from '@/features/folder/platforms';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import { isPromptItemArray } from '@/features/prompt/library/promptLibraryOwner';
import { pullCatalogTimeline } from '@/features/timeline/catalogTimelineCloud';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '@/pages/content/timeline/hierarchyStorage';

import type { CloudRestoreMode } from './cloudRestore';

export type { CloudDownloadData } from '@/core/services/CloudSyncDownloadService';

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

interface CloudSyncContext {
  targetTabId: number | undefined;
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
  if (respectIsolationSetting && !email) {
    // The page's folders bind only an account its own control names; a `/u/<n>` slot, the
    // shared `default` bucket or the unscoped one would sync another account's folders.
    throw new Error('The page has not shown which account is signed in yet');
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
  const targetTab = await getTargetTab();
  const capturedTarget = async () => targetTab;
  const accountScope = await resolvePageScope(platform, true, capturedTarget);
  const extras = FOLDER_PLATFORMS[platform].syncsConversationExtras;
  const timelineHierarchyAccountScope = extras
    ? await resolvePageScope(platform, false, capturedTarget)
    : null;
  const highlightAccountScope =
    extras && includeHighlights ? await resolvePageScope(platform, false, capturedTarget) : null;
  const baseFolderStorageKey = FOLDER_PLATFORMS[platform].folderStorageKey;
  return {
    targetTabId: targetTab?.id,
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

/**
 * Read fresh tab folders, then legacy/object storage. An upload takes the tab's scope with its
 * folders; a restore keeps the captured scope and reports a tab now on another account.
 */
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
  let accountChanged = false;
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
      if (supportsAccountIsolation(platform) && purpose === 'restore') {
        // The download fetched the captured account's files; a tab that switched accounts
        // meanwhile would merge them into, or overwrite, the other account's folders.
        accountChanged = response.accountScope?.accountKey !== accountScope?.accountKey;
      } else if (supportsAccountIsolation(platform) && response.accountScope) {
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
  return { folders, prompts, timelineHierarchy, accountScope, folderStorageKey, accountChanged };
}

async function isCurrentCloudRestore(
  context: CloudSyncContext,
  getTargetTab: TargetTab,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const tab = await getTargetTab();
  if (supportsAccountIsolation(context.payload.platform)) {
    if (context.targetTabId !== undefined && tab?.id !== context.targetTabId) return false;
    if (
      tab?.url &&
      getFolderPlatformForHost(new URL(tab.url).hostname) !== context.payload.platform
    )
      return false;
  }
  const response = await requestTabData<{ ok?: boolean; accountScope?: SyncAccountScope }>(
    getTargetTab,
    'gv.sync.requestData',
    2000,
    context.payload.platform,
  ).catch(() => undefined);
  return (
    !signal.aborted &&
    !(
      supportsAccountIsolation(context.payload.platform) &&
      response?.ok &&
      response.accountScope?.accountKey !== context.payload.accountScope?.accountKey
    )
  );
}

/** Plan every owner before writing; account and popup lifetime are checked between phases. */
async function restoreCloudDownload(
  context: CloudSyncContext,
  getTargetTab: TargetTab,
  data: CloudDownloadData,
  mode: CloudRestoreMode,
  highlightsRestored: boolean,
  signal: AbortSignal,
) {
  const send = (message: { type: string; payload?: unknown }) =>
    chrome.runtime.sendMessage(message);
  const catalog = await pullCatalogTimeline(send).then(
    (value) => ({ status: 'pulled' as const, value }),
    (error) => ({ status: 'failed' as const, error }),
  );
  const local = await readLocalSyncData(context, getTargetTab, 'restore');
  const current = () => isCurrentCloudRestore(context, getTargetTab, signal);
  const result = await applyPopupCloudDownload({
    context,
    local,
    data,
    mode,
    highlightsRestored,
    catalog,
    send,
    current,
    signal,
  });
  if (!signal.aborted) {
    try {
      const tab = await getTargetTab();
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'gv.folders.reload' });
    } catch (error) {
      console.warn('[CloudSyncSettings] Could not notify content script:', error);
    }
  }
  return result;
}

/** Capture each operation's scope; the download's restore keeps that captured context. */
export function useCloudSyncTransfer(
  platform: SyncPlatform,
  includeHighlights: boolean,
  getTargetTab: TargetTab,
) {
  const lifetime = useMemo(
    () => ({
      controller: new AbortController(),
      platform,
      includeHighlights,
      getTargetTab,
    }),
    [platform, includeHighlights, getTargetTab],
  );
  useEffect(() => {
    const machine = startMachine<{ status: 'mounted' }, { type: 'unused' }>(
      {
        id: `popup-cloud-transfer:${lifetime.platform}`,
        transition: (state) => state,
        effects: {
          mounted: (stay) => {
            stay.scope.effect(() => () => lifetime.controller.abort());
          },
        },
      },
      { status: 'mounted' },
    );
    return () => {
      void machine.stop();
    };
  }, [lifetime]);
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
      restore: (
        data: CloudDownloadData,
        mode: CloudRestoreMode,
        highlightsRestored: boolean,
        snapshotId?: string,
      ) =>
        restoreCloudDownload(
          context,
          getTargetTab,
          snapshotId ? { ...data, snapshotId } : data,
          mode,
          highlightsRestored,
          lifetime.controller.signal,
        ),
      /** Restores only the catalog outlines and stars, for a cloud without this site's files. */
      restoreCatalogTimeline: async (snapshotId?: string) => {
        const send = (message: { type: string; payload?: unknown }) =>
          chrome.runtime.sendMessage(message);
        const pulled = await pullCatalogTimeline(send);
        return applyPopupCatalogDownload({
          send,
          catalog: pulled,
          snapshotId,
          current: () => isCurrentCloudRestore(context, getTargetTab, lifetime.controller.signal),
          signal: lifetime.controller.signal,
          snapshot: {
            source: 'popup-restore',
            platform,
            accountScope: context.payload.accountScope,
          },
        });
      },
    };
  }, [platform, includeHighlights, getTargetTab, lifetime]);

  return { prepareUpload, prepareDownload };
}
