import {
  accountIsolationService,
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import { highlightDriveSyncCoordinator } from '@/core/services/HighlightDriveSyncCoordinator';
import { logger } from '@/core/services/LoggerService';
import { exportBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import { getHighlightAccountHash } from '@/core/services/highlightAnnotationData';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type {
  PromptItem,
  SyncAccountScope,
  SyncMode,
  SyncPlatform,
  SyncProvider,
} from '@/core/types/sync';
import { getPromptNameConflictIds } from '@/core/utils/promptName';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import { FOLDER_PLATFORMS, supportsAccountIsolation } from '@/features/folder/platforms';
import { loadPluginState } from '@/features/plugins/storage/pluginState';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarredMessagesData } from '@/features/savedLibrary/starTypes';
import type { ForkNode, ForkNodesData } from '@/pages/content/fork/forkTypes';
import {
  filterTimelineHierarchyByRouteScope,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '@/pages/content/timeline/hierarchyStorage';

import {
  handleCatalogTimelineSyncMessage,
  isCatalogTimelineSyncMessage,
} from './catalogTimelineSyncMessages';
import { isHighlightCloudSyncRequested, notifyHighlightChanged } from './highlightMessages';
import { mergeCloudPrompts, mergeCloudPromptsForUpload } from './promptDriveMerge';
import { promptLibraryOwner } from './queueOwners';
import {
  isTrustedSharedDataSyncSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
} from './runtimeMessageRouting';

function isSyncAccountScope(value: unknown): value is SyncAccountScope {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as Record<string, unknown>;
  return (
    typeof scope.accountKey === 'string' &&
    typeof scope.accountId === 'number' &&
    Number.isFinite(scope.accountId) &&
    (typeof scope.routeUserId === 'string' || scope.routeUserId === null)
  );
}

async function resolveAccountScopeForMessage(
  sender: chrome.runtime.MessageSender,
  platform: SyncPlatform,
  explicitScope?: SyncAccountScope,
): Promise<SyncAccountScope | null> {
  if (!supportsAccountIsolation(platform)) return null;
  const enabled = await accountIsolationService.isIsolationEnabled({
    platform,
    pageUrl: sender.tab?.url ?? null,
  });
  if (!enabled) return null;
  if (explicitScope) return explicitScope;

  const resolved = await accountIsolationService.resolveAccountScope({
    pageUrl: sender.tab?.url ?? null,
  });
  return toSyncAccountScope(resolved);
}

function parseStoredFolderData(value: unknown): FolderData | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Record<string, unknown>;
  if (
    !Array.isArray(data.folders) ||
    !data.folderContents ||
    typeof data.folderContents !== 'object'
  ) {
    return null;
  }
  if (!Object.values(data.folderContents).every((contents) => Array.isArray(contents))) return null;
  return parsed as FolderData;
}

function isPromptItemArray(value: unknown): value is PromptItem[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const prompt = item as Record<string, unknown>;
      return (
        typeof prompt.id === 'string' &&
        typeof prompt.text === 'string' &&
        Array.isArray(prompt.tags) &&
        prompt.tags.every((tag) => typeof tag === 'string') &&
        typeof prompt.createdAt === 'number' &&
        Number.isFinite(prompt.createdAt) &&
        (prompt.updatedAt === undefined ||
          (typeof prompt.updatedAt === 'number' && Number.isFinite(prompt.updatedAt))) &&
        (prompt.name === undefined || typeof prompt.name === 'string')
      );
    })
  );
}

async function loadAuthoritativeSyncPayload(
  platform: SyncPlatform,
  accountScope: SyncAccountScope | null,
): Promise<{ folders: FolderData; prompts: PromptItem[] }> {
  const definition = FOLDER_PLATFORMS[platform];
  const baseFolderStorageKey = definition.folderStorageKey;
  const folderStorageKey = accountScope
    ? buildScopedStorageKey(baseFolderStorageKey, accountScope.accountKey)
    : baseFolderStorageKey;
  const stored = await chrome.storage.local.get([
    folderStorageKey,
    ...(definition.syncsSharedData ? [StorageKeys.PROMPT_ITEMS] : []),
  ]);
  const folders = parseStoredFolderData(stored[folderStorageKey]);
  if (!folders) {
    throw new Error('Local folder data is unavailable or invalid');
  }

  if (!definition.syncsSharedData) return { folders, prompts: [] };
  const rawPrompts = stored[StorageKeys.PROMPT_ITEMS];
  if (rawPrompts !== undefined && !isPromptItemArray(rawPrompts)) {
    throw new Error('Local prompt data is invalid');
  }
  return { folders, prompts: rawPrompts ?? [] };
}

function matchesRouteScope(url: string, routeUserId: string | null): boolean {
  if (!routeUserId) return true;
  const routeFromUrl = extractRouteUserIdFromUrl(url);
  return routeFromUrl === null || routeFromUrl === routeUserId;
}

function filterStarredByRouteScope(
  data: StarredMessagesData,
  routeUserId: string | null,
): StarredMessagesData {
  if (!routeUserId) return data;

  const filteredEntries = Object.entries(data.messages).map(([conversationId, messages]) => {
    const filteredMessages = messages.filter((message) =>
      matchesRouteScope(message.conversationUrl, routeUserId),
    );
    return [conversationId, filteredMessages] as const;
  });

  const filteredMessages = Object.fromEntries(
    filteredEntries.filter((entry) => entry[1].length > 0),
  );
  return { messages: filteredMessages };
}

function filterForkNodesByRouteScope(
  data: ForkNodesData,
  routeUserId: string | null,
): ForkNodesData {
  if (!routeUserId) return data;

  const filteredNodes: Record<string, ForkNode[]> = {};
  for (const [conversationId, nodes] of Object.entries(data.nodes)) {
    const filtered = nodes.filter((node) => matchesRouteScope(node.conversationUrl, routeUserId));
    if (filtered.length > 0) {
      filteredNodes[conversationId] = filtered;
    }
  }

  const filteredGroups: Record<string, string[]> = {};
  for (const nodes of Object.values(filteredNodes)) {
    for (const node of nodes) {
      if (!filteredGroups[node.forkGroupId]) {
        filteredGroups[node.forkGroupId] = [];
      }
      const key = `${node.conversationId}:${node.turnId}`;
      if (!filteredGroups[node.forkGroupId].includes(key)) {
        filteredGroups[node.forkGroupId].push(key);
      }
    }
  }

  return {
    nodes: filteredNodes,
    groups: filteredGroups,
  };
}

/**
 * Point a scoped fork file at this device's `/u/<index>/` for the account it was read for:
 * the same account can sit at another index on each device. A file whose forks span several
 * routes was uploaded unfiltered, so its routes cannot be attributed and stay as stored.
 */
function retargetForkNodesToRoute(data: ForkNodesData, routeUserId: string): ForkNodesData {
  const routeOf = (node: ForkNode) =>
    typeof node?.conversationUrl === 'string'
      ? extractRouteUserIdFromUrl(node.conversationUrl)
      : null;
  const lists = Object.values(data.nodes).filter((nodes) => Array.isArray(nodes));
  const routes = new Set(lists.flatMap((nodes) => nodes.map(routeOf)).filter((r) => r !== null));
  if (routes.size !== 1 || routes.has(routeUserId)) return data;

  const retarget = (node: ForkNode): ForkNode => {
    if (routeOf(node) === null) return node;
    const url = new URL(node.conversationUrl);
    url.pathname = url.pathname.replace(/^\/u\/\d+\//, `/u/${routeUserId}/`);
    return { ...node, conversationUrl: url.toString() };
  };
  return {
    ...data,
    nodes: Object.fromEntries(
      Object.entries(data.nodes).map(([id, nodes]) => [
        id,
        Array.isArray(nodes) ? nodes.map(retarget) : nodes,
      ]),
    ),
  };
}

type SyncPayload = {
  interactive?: boolean;
  platform?: unknown;
  accountScope?: unknown;
  timelineHierarchyAccountScope?: unknown;
  highlightAccountScope?: unknown;
  includeHighlights?: boolean;
  mode?: SyncMode;
  provider?: SyncProvider;
};
export function createCloudSyncMessageHandler(readers: {
  getAllStarredMessages(): Promise<StarredMessagesData>;
  getAllForkNodes(): Promise<ForkNodesData>;
  starStore?: StarStore;
}) {
  async function handle(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> {
    const payload = message.payload as SyncPayload | undefined;
    if (isCatalogTimelineSyncMessage(message.type)) {
      return handleCatalogTimelineSyncMessage(message.type, payload, sender, readers.starStore);
    }
    switch (message.type) {
      case 'gv.sync.authenticate': {
        const interactive = payload?.interactive !== false;
        const success = await googleDriveSyncService.authenticate(interactive);
        return { ok: success, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.signOut': {
        await googleDriveSyncService.signOut();
        return { ok: true, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.upload': {
        const {
          interactive,
          platform: rawPlatform,
          accountScope: rawScope,
          timelineHierarchyAccountScope: rawTimelineHierarchyScope,
          highlightAccountScope: rawHighlightScope,
          includeHighlights,
        } = payload as {
          interactive?: boolean;
          platform?: unknown;
          accountScope?: unknown;
          timelineHierarchyAccountScope?: unknown;
          highlightAccountScope?: unknown;
          includeHighlights?: boolean;
        };
        const platform = parseSyncPlatform(rawPlatform);
        if (!platform || !isTrustedSyncMessageSender(sender, platform)) {
          return { ok: false, error: 'untrusted_sender' };
        }
        const { syncsSharedData, syncsConversationExtras } = FOLDER_PLATFORMS[platform];
        const syncHighlights =
          syncsSharedData &&
          (await isHighlightCloudSyncRequested(platform, includeHighlights === true));
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const { folders, prompts } = await loadAuthoritativeSyncPayload(platform, accountScope);
        const timelineHierarchyAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawTimelineHierarchyScope)
            ? rawTimelineHierarchyScope
            : null;
        const highlightAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawHighlightScope)
            ? rawHighlightScope
            : (timelineHierarchyAccountScope ?? (isSyncAccountScope(rawScope) ? rawScope : null));
        const shouldSyncHighlights = syncHighlights && highlightAccountScope !== null;
        // Also get the conversation extras (stars, forks, timeline hierarchy) from local storage
        const starredDataRaw = syncsConversationExtras
          ? await readers.getAllStarredMessages()
          : null;
        const forksDataRaw = syncsConversationExtras ? await readers.getAllForkNodes() : null;
        const timelineHierarchyRaw = syncsConversationExtras
          ? await chrome.storage.local.get(
              getTimelineHierarchyStorageKeysToRead(timelineHierarchyAccountScope?.accountKey),
            )
          : null;
        const starredData =
          starredDataRaw && accountScope
            ? filterStarredByRouteScope(starredDataRaw, accountScope.routeUserId)
            : starredDataRaw;
        const forksData =
          forksDataRaw && accountScope
            ? filterForkNodesByRouteScope(forksDataRaw, accountScope.routeUserId)
            : forksDataRaw;
        const timelineHierarchyDataRaw =
          syncsConversationExtras && timelineHierarchyRaw
            ? resolveTimelineHierarchyDataForStorageScope(
                timelineHierarchyRaw as Record<string, unknown>,
                timelineHierarchyAccountScope?.accountKey,
                timelineHierarchyAccountScope?.routeUserId ?? null,
              )
            : null;
        const timelineHierarchyData =
          timelineHierarchyDataRaw && timelineHierarchyAccountScope
            ? filterTimelineHierarchyByRouteScope(
                timelineHierarchyDataRaw,
                timelineHierarchyAccountScope.routeUserId,
              )
            : timelineHierarchyDataRaw;
        const settingsPayload = syncsSharedData ? await exportBackupableSyncSettings() : null;
        const pluginState = syncsSharedData ? await loadPluginState() : null;
        const success = await googleDriveSyncService.upload(
          folders,
          prompts,
          starredData,
          interactive !== false,
          platform,
          forksData,
          timelineHierarchyData,
          accountScope,
          timelineHierarchyAccountScope,
          settingsPayload?.data ?? null,
          pluginState,
          ...(readers.starStore ? ([readers.starStore] as const) : []),
        );
        if (success && shouldSyncHighlights && highlightAccountScope) {
          const highlightResult = await highlightDriveSyncCoordinator.push(
            highlightAccountScope,
            interactive !== false,
          );
          if (!highlightResult.ok) {
            return {
              ok: false,
              error: highlightResult.error ?? 'Highlight upload failed',
              partial: true,
              state: await googleDriveSyncService.getState(),
            };
          }
          await notifyHighlightChanged({
            platform: 'gemini',
            accountHash: getHighlightAccountHash({
              ...highlightAccountScope,
              platform: 'gemini',
            }),
          });
        }
        return {
          ok: success,
          highlights: syncHighlights
            ? { synced: success && shouldSyncHighlights, skipped: !shouldSyncHighlights }
            : undefined,
          state: await googleDriveSyncService.getState(),
        };
      }
      case 'gv.sync.download': {
        const interactive = payload?.interactive !== false;
        const platform = parseSyncPlatform(payload?.platform);
        // Downloads hand cloud data back to the sender, so they need the same sender as uploads.
        if (!platform || !isTrustedSyncMessageSender(sender, platform)) {
          return { ok: false, error: 'unsupported_sync_platform' };
        }
        const { syncsSharedData, syncsConversationExtras } = FOLDER_PLATFORMS[platform];
        const syncHighlights =
          syncsSharedData &&
          (await isHighlightCloudSyncRequested(platform, payload?.includeHighlights === true));
        const rawScope = payload?.accountScope;
        const rawTimelineHierarchyScope = payload?.timelineHierarchyAccountScope;
        const rawHighlightScope = payload?.highlightAccountScope;
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const timelineHierarchyAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawTimelineHierarchyScope)
            ? rawTimelineHierarchyScope
            : null;
        const highlightAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawHighlightScope)
            ? rawHighlightScope
            : (timelineHierarchyAccountScope ?? (isSyncAccountScope(rawScope) ? rawScope : null));
        const shouldSyncHighlights = syncHighlights && highlightAccountScope !== null;
        const data = await googleDriveSyncService.download(
          interactive,
          platform,
          accountScope,
          timelineHierarchyAccountScope,
        );
        if (!data) {
          const state = await googleDriveSyncService.getState();
          if (state.error) return { ok: false, error: state.error, state };
        }
        const routeUserId = accountScope?.routeUserId;
        if (data?.forks?.data?.nodes && routeUserId) {
          data.forks = {
            ...data.forks,
            data: retargetForkNodesToRoute(data.forks.data, routeUserId),
          };
        }
        let highlightSyncResult: { synced: boolean; count: number; empty: boolean } | undefined;
        if (shouldSyncHighlights && highlightAccountScope) {
          const highlightResult = await highlightDriveSyncCoordinator.pull(
            highlightAccountScope,
            interactive,
          );
          if (!highlightResult.ok) {
            return {
              ok: false,
              error: highlightResult.error ?? 'Highlight download failed',
              partial: data !== null,
              state: await googleDriveSyncService.getState(),
            };
          }
          await notifyHighlightChanged({
            platform: 'gemini',
            accountHash: getHighlightAccountHash({
              ...highlightAccountScope,
              platform: 'gemini',
            }),
          });
          highlightSyncResult = {
            synced: true,
            count: highlightResult.count,
            empty: highlightResult.empty === true,
          };
        }
        // NOTE: We intentionally do NOT save to storage here.
        // The caller (Popup) is responsible for merging with local data and saving.
        // This prevents data loss from overwriting local changes.
        logger.info(`[Background] Downloaded data for ${platform}, returning to caller for merge`);
        return {
          ok: true,
          data,
          highlights:
            highlightSyncResult ??
            (syncHighlights ? { synced: false, skipped: !shouldSyncHighlights } : undefined),
          state: await googleDriveSyncService.getState(),
        };
      }
      // Prompts-only cloud merge, run END-TO-END in the background so the
      // operation survives the extension popup closing when the Google
      // account picker steals focus during interactive auth. Merging in the
      // popup meant a first-time account selection abandoned the merge and
      // the user had to click again.
      case 'gv.sync.pullPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          'gemini',
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const cloudPayload = await googleDriveSyncService.downloadPromptsOnly(
          accountScope,
          interactive !== false,
        );
        const outcome = await mergeCloudPrompts(promptLibraryOwner, cloudPayload);
        return { ...outcome, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.pushPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          'gemini',
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        // Merge cloud into local first so both sides converge to the union.
        const cloudPayload = await googleDriveSyncService.downloadPromptsOnly(
          accountScope,
          interactive !== false,
        );
        const localPrompts = await mergeCloudPromptsForUpload(promptLibraryOwner, cloudPayload);
        if (!localPrompts) {
          return { ok: false, state: await googleDriveSyncService.getState() };
        }
        const uploaded = await googleDriveSyncService.uploadPromptsOnly(
          localPrompts,
          accountScope,
          interactive !== false,
        );
        return {
          ok: uploaded,
          count: localPrompts.length,
          nameConflicts: getPromptNameConflictIds(localPrompts).size,
          state: await googleDriveSyncService.getState(),
        };
      }
      case 'gv.sync.getState': {
        return { ok: true, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.setMode': {
        const mode = payload?.mode as SyncMode;
        if (mode) {
          await googleDriveSyncService.setMode(mode);
        }
        return { ok: true, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.setProvider': {
        const provider = payload?.provider as SyncProvider;
        if (provider === 'googleDrive' || provider === 'icloud') {
          await googleDriveSyncService.setProvider(provider);
        }
        return { ok: true, state: await googleDriveSyncService.getState() };
      }
    }
  }
  return (
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> | null =>
    message.type.startsWith('gv.sync.') ? handle(message, sender) : null;
}
