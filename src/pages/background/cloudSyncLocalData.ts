/** Strict local upload reads and the existing account-route projections. */
import {
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { PromptItem, SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { sanitizePluginState, type PluginStateMap } from '@/features/plugins/storage/pluginState';
import type { StarredMessagesData } from '@/features/savedLibrary/starTypes';
import {
  type TimelineHierarchyData,
  normalizeTimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';
import type { ForkNode, ForkNodesData } from '@/pages/content/fork/forkTypes';
import {
  filterTimelineHierarchyByRouteScope,
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
} from '@/pages/content/timeline/hierarchyStorage';

import { normalizeLocalPromptsForSync } from './localPromptSyncData';

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

export async function loadAuthoritativeSyncPayload(
  platform: SyncPlatform,
  accountScope: SyncAccountScope | null,
  selection?: { site: boolean; shared: boolean },
): Promise<{ folders: FolderData; prompts: PromptItem[] }> {
  const definition = FOLDER_PLATFORMS[platform];
  const baseFolderStorageKey = definition.folderStorageKey;
  const folderStorageKey = accountScope
    ? buildScopedStorageKey(baseFolderStorageKey, accountScope.accountKey)
    : baseFolderStorageKey;
  const stored = await chrome.storage.local.get<Record<string, unknown>>([
    ...(selection?.site !== false ? [folderStorageKey] : []),
    ...(definition.syncsSharedData && selection?.shared !== false
      ? [StorageKeys.PROMPT_ITEMS]
      : []),
  ]);
  const folders =
    selection?.site === false
      ? { folders: [], folderContents: {} }
      : parseStoredFolderData(stored[folderStorageKey]);
  if (!folders) {
    throw new Error('Local folder data is unavailable or invalid');
  }

  if (!definition.syncsSharedData || selection?.shared === false) return { folders, prompts: [] };
  return { folders, prompts: normalizeLocalPromptsForSync(stored[StorageKeys.PROMPT_ITEMS]) };
}

function matchesRouteScope(url: string, routeUserId: string | null): boolean {
  if (!routeUserId) return true;
  const routeFromUrl = extractRouteUserIdFromUrl(url);
  return routeFromUrl === null || routeFromUrl === routeUserId;
}

export function filterStarredByRouteScope(
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

export function filterForkNodesByRouteScope(
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
export function retargetForkNodesToRoute(data: ForkNodesData, routeUserId: string): ForkNodesData {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the same primary/legacy hierarchy as before, without a corrupt-to-empty fallback. */
export async function loadTimelineHierarchyForSync(
  scope: SyncAccountScope | null,
  captured?: Record<string, unknown>,
): Promise<TimelineHierarchyData> {
  const values =
    captured ??
    (await chrome.storage.local.get<Record<string, unknown>>(
      getTimelineHierarchyStorageKeysToRead(scope?.accountKey),
    ));
  const primaryKey = getTimelineHierarchyStorageKey(scope?.accountKey);
  const selectedKey = Object.prototype.hasOwnProperty.call(values, primaryKey)
    ? primaryKey
    : StorageKeys.TIMELINE_HIERARCHY;
  const raw: unknown = values[selectedKey];
  // A failed or unrecognized read cannot become an empty whole-file upload.
  if (raw === undefined) return { conversations: {} };
  if (!isRecord(raw) || !isRecord(raw.conversations)) throw new Error('Upload failed');
  const data = normalizeTimelineHierarchyData(raw);
  if (Object.keys(raw.conversations).length > 0 && Object.keys(data.conversations).length === 0) {
    throw new Error('Upload failed');
  }
  return scope ? filterTimelineHierarchyByRouteScope(data, scope.routeUserId) : data;
}

/** Only a genuinely missing plugin map may stand for an empty local upload. */
export async function readPluginStateForSync(
  captured?: Record<string, unknown>,
): Promise<PluginStateMap> {
  const result =
    captured ??
    (await chrome.storage.local.get<Record<string, unknown>>({ [StorageKeys.PLUGINS_STATE]: {} }));
  const raw: unknown = result[StorageKeys.PLUGINS_STATE];
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new Error('Upload failed');
  const state = sanitizePluginState(raw);
  // Repair individual entries/settings; refuse only a non-empty map that becomes empty.
  if (Object.keys(raw).length > 0 && Object.keys(state).length === 0)
    throw new Error('Upload failed');
  return state;
}
