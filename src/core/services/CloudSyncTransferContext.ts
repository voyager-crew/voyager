/**
 * Which account a cloud sync transfer belongs to and the local data it reads,
 * decided once for every surface that syncs: the popup and the panel's cloud
 * sheet. Each reaches its page through a `SyncPageLookup` (the popup through
 * `tabs`, the panel through its tab relay); everything else is shared.
 */
import {
  accountIsolationService,
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import {
  type SyncScopeRow,
  SyncScopeExcludedError,
  isSyncScopeIncluded,
  readCloudSyncScope,
} from '@/core/services/CloudSyncScope';
import { AccountUnconfirmedError } from '@/core/services/GoogleDriveIdentity';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  getFolderPlatformForHost,
  supportsAccountIsolation,
} from '@/features/folder/platforms';
import { isPromptItemArray } from '@/features/prompt/library/promptLibraryOwner';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '@/pages/content/timeline/hierarchyStorage';

export type SyncPageRequest = {
  readonly type: 'gv.account.getContext' | 'gv.sync.requestData' | 'gv.folders.reload';
};

/** One look at the page a transfer reads. */
export interface SyncPageView {
  /** The same page across looks (the popup's tab id); undefined when it has none. */
  readonly key: number | string | undefined;
  readonly url: string | undefined;
  /** Asks the page's content script; absent when the page cannot be asked. */
  readonly ask?: (request: SyncPageRequest) => Promise<unknown>;
}

export type SyncPageLookup = () => Promise<SyncPageView | undefined>;

export interface CloudSyncPayload {
  readonly platform: SyncPlatform;
  /** `all`: the site and 通用 together (the popup); `site` or `shared`: one row (the sheet). */
  readonly selection: 'all' | 'site' | 'shared';
  readonly accountScope: SyncAccountScope | null;
  readonly timelineHierarchyAccountScope: SyncAccountScope | null;
  readonly highlightAccountScope: SyncAccountScope | null;
  readonly includeHighlights: boolean;
}

export interface CloudSyncContext {
  /** The page the scopes were read from, which a restore must still be on. */
  readonly target: SyncPageView['key'];
  readonly included: { readonly site: boolean; readonly shared: boolean };
  readonly payload: CloudSyncPayload;
  readonly folderStorageKey: string;
  readonly timelineHierarchyStorageKey: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function isFolderData(value: unknown): value is FolderData {
  const data = record(value);
  return !!data && Array.isArray(data.folders) && record(data.folderContents) !== null;
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
  return record(record(value)?.conversations) !== null;
}

function parseScope(value: unknown): SyncAccountScope | undefined {
  const scope = record(value);
  return scope &&
    typeof scope.accountKey === 'string' &&
    typeof scope.accountId === 'number' &&
    (scope.routeUserId === null || typeof scope.routeUserId === 'string')
    ? { accountKey: scope.accountKey, accountId: scope.accountId, routeUserId: scope.routeUserId }
    : undefined;
}

// The timeout belongs to the lookup, including when the page replies first.
async function requestPageData(
  page: SyncPageLookup,
  type: SyncPageRequest['type'],
  timeout: number,
  platform?: SyncPlatform,
): Promise<Record<string, unknown> | undefined> {
  const matchesPlatform = (candidate: SyncPageView | undefined): boolean =>
    !platform ||
    (!!candidate?.url && getFolderPlatformForHost(new URL(candidate.url).hostname) === platform);
  const view = await page();
  if (!view?.ask || !matchesPlatform(view)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      view.ask({ type }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeout);
      }),
    ]);
    if (platform) {
      const current = await page();
      // A page can outlive its document; another platform cannot supply this bucket's base.
      if (current?.key !== view.key || !matchesPlatform(current)) return undefined;
    }
    return record(response) ?? undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePageScope(
  platform: SyncPlatform,
  respectIsolationSetting: boolean,
  page: SyncPageLookup,
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
    const view = await page();
    pageUrl = view?.url || '';
    routeUserId = platform === 'gemini' ? extractRouteUserIdFromUrl(pageUrl) : null;
    if (view?.ask) {
      try {
        // Keep context and URL from the same page lookup.
        const response = await requestPageData(async () => view, 'gv.account.getContext', 400);
        const context = response?.ok === true ? record(response.context) : null;
        if (context) {
          pageContextAvailable = true;
          if (typeof context.routeUserId === 'string') routeUserId = context.routeUserId;
          email = typeof context.email === 'string' ? context.email : null;
        }
      } catch {
        // A missing content script falls back to the URL.
      }
    }
  } catch {
    // A failed page lookup leaves no page context.
  }
  if (respectIsolationSetting && !email) {
    // The page's folders bind only an account its own control names; a `/u/<n>` slot, the
    // shared `default` bucket or the unscoped one would sync another account's folders.
    throw new AccountUnconfirmedError();
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

/** The rows of `platform` that sync now; neither is a `SyncScopeExcludedError`. */
export async function readIncludedRows(
  platform: SyncPlatform,
): Promise<{ site: boolean; shared: boolean }> {
  const scope = await readCloudSyncScope();
  const site = isSyncScopeIncluded(scope, { kind: 'site', siteId: platform });
  const shared =
    FOLDER_PLATFORMS[platform].syncsSharedData && isSyncScopeIncluded(scope, { kind: 'shared' });
  if (!site && !shared) {
    const rows: SyncScopeRow[] = [{ kind: 'site', siteId: platform }];
    if (FOLDER_PLATFORMS[platform].syncsSharedData) rows.push({ kind: 'shared' });
    throw new SyncScopeExcludedError(rows);
  }
  return { site, shared };
}

/** Captures the independently scoped folders, hierarchy and highlights before a transfer. */
export async function resolveCloudSyncContext(input: {
  readonly platform: SyncPlatform;
  readonly included: { readonly site: boolean; readonly shared: boolean };
  readonly selection: CloudSyncPayload['selection'];
  readonly includeHighlights: boolean;
  readonly page: SyncPageLookup;
}): Promise<CloudSyncContext> {
  const { platform, included, includeHighlights } = input;
  const target = await input.page();
  const captured = async () => target;
  const accountScope = await resolvePageScope(platform, true, captured);
  const extras = included.site && FOLDER_PLATFORMS[platform].syncsConversationExtras;
  const timelineHierarchyAccountScope = extras
    ? await resolvePageScope(platform, false, captured)
    : null;
  const highlightAccountScope =
    extras && includeHighlights ? await resolvePageScope(platform, false, captured) : null;
  const baseFolderStorageKey = FOLDER_PLATFORMS[platform].folderStorageKey;
  return {
    target: target?.key,
    included,
    payload: {
      platform,
      selection: input.selection,
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
 * Reads fresh page folders, then legacy/object storage. An upload takes the page's scope with its
 * folders; a restore keeps the captured scope and reports a page now on another account.
 */
export async function readLocalSyncData(
  context: CloudSyncContext,
  page: SyncPageLookup,
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
    const response = context.included.site
      ? await requestPageData(
          page,
          'gv.sync.requestData',
          purpose === 'upload' ? 500 : 2000,
          platform,
        )
      : undefined;
    if (response?.ok && isFolderData(response.data)) {
      folders = response.data;
      hasLiveFolderSnapshot = true;
      const pageScope = parseScope(response.accountScope);
      if (supportsAccountIsolation(platform) && purpose === 'restore') {
        // The download fetched the captured account's files; a page that switched accounts
        // meanwhile would merge them into, or overwrite, the other account's folders.
        accountChanged = pageScope?.accountKey !== accountScope?.accountKey;
      } else if (supportsAccountIsolation(platform) && pageScope) {
        accountScope = pageScope;
        folderStorageKey = buildScopedStorageKey(definition.folderStorageKey, pageScope.accountKey);
      }
    }
  } catch (error) {
    logger.warn('Cloud sync page read failed or was skipped', { error: String(error) });
  }

  try {
    const storageResult: Record<string, unknown> = await chrome.storage.local.get([
      ...(context.included.site ? [folderStorageKey] : []),
      // A restore leaves prompts to their owner, which reads them in its own turn.
      ...(context.included.shared && definition.syncsSharedData && purpose === 'upload'
        ? [StorageKeys.PROMPT_ITEMS]
        : []),
      ...(context.included.site && definition.syncsConversationExtras && purpose === 'restore'
        ? getTimelineHierarchyStorageKeysToRead(timelineHierarchyAccountScope?.accountKey)
        : []),
    ]);
    const storedFolders = parseStoredFolderData(storageResult[folderStorageKey]);
    // A successful empty live snapshot may be an unsaved deletion, rather than missing data.
    if (!hasLiveFolderSnapshot && storedFolders) folders = storedFolders;
    const storedPrompts = storageResult[StorageKeys.PROMPT_ITEMS];
    if (context.included.shared && definition.syncsSharedData && isPromptItemArray(storedPrompts))
      prompts = storedPrompts;
    if (context.included.site && definition.syncsConversationExtras && purpose === 'restore') {
      const resolvedHierarchy = resolveTimelineHierarchyDataForStorageScope(
        storageResult,
        timelineHierarchyAccountScope?.accountKey,
        timelineHierarchyAccountScope?.routeUserId ?? null,
      );
      if (isTimelineHierarchyData(resolvedHierarchy)) timelineHierarchy = resolvedHierarchy;
    }
  } catch (error) {
    logger.error('Cloud sync could not read local data', { error: String(error) });
  }
  return { folders, prompts, timelineHierarchy, accountScope, folderStorageKey, accountChanged };
}

/** Between apply phases: still the captured page, on the account the download was for. */
export async function isCurrentCloudRestore(
  context: CloudSyncContext,
  page: SyncPageLookup,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const view = await page();
  if (supportsAccountIsolation(context.payload.platform)) {
    if (context.target !== undefined && view?.key !== context.target) return false;
    if (
      view?.url &&
      getFolderPlatformForHost(new URL(view.url).hostname) !== context.payload.platform
    )
      return false;
  }
  if (!context.included.site) {
    if (!context.payload.accountScope) return !signal.aborted;
    const scope = await resolvePageScope(context.payload.platform, true, page).catch(
      () => undefined,
    );
    return !signal.aborted && scope?.accountKey === context.payload.accountScope.accountKey;
  }
  const response = await requestPageData(
    page,
    'gv.sync.requestData',
    2000,
    context.payload.platform,
  ).catch(() => undefined);
  return (
    !signal.aborted &&
    !(
      supportsAccountIsolation(context.payload.platform) &&
      response?.ok &&
      parseScope(response.accountScope)?.accountKey !== context.payload.accountScope?.accountKey
    )
  );
}

/** A guard answer acts only for the accounts the refusal was computed for. */
export function sameCloudSyncAccounts(before: CloudSyncPayload, after: CloudSyncPayload): boolean {
  return (
    before.accountScope?.accountKey === after.accountScope?.accountKey &&
    before.timelineHierarchyAccountScope?.accountKey ===
      after.timelineHierarchyAccountScope?.accountKey &&
    before.highlightAccountScope?.accountKey === after.highlightAccountScope?.accountKey
  );
}
