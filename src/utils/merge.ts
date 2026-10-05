import type { PromptItem } from '@/core/types/sync';
import { getPromptNameConflictIds } from '@/core/utils/promptName';
import { isNewerPromptCopy } from '@/core/utils/promptRevision';
import { setBucket } from '@/features/folder/model/folderData';
import type {
  TimelineHierarchyConversationData,
  TimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';
import type { ForkNode, ForkNodesData } from '@/pages/content/fork/forkTypes';

type MergeableFolder = {
  readonly id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
};

type MergeableConversationReference = {
  readonly conversationId: string;
  starred?: boolean;
  lastTurnAt?: number;
};

type MergeableFolderData<
  TFolder extends MergeableFolder,
  TConversation extends MergeableConversationReference,
> = {
  folders: TFolder[];
  folderContents: Record<string, TConversation[]>;
};

/**
 * Merges local and cloud folder data.
 */
export function mergeFolderData<
  TFolder extends MergeableFolder,
  TConversation extends MergeableConversationReference,
>(
  local: MergeableFolderData<TFolder, TConversation>,
  cloud: MergeableFolderData<TFolder, TConversation>,
): MergeableFolderData<TFolder, TConversation> {
  const localFoldersById = new Map(local.folders.map((folder) => [folder.id, folder]));
  const localPaths = buildFolderPathIndex(local.folders);
  const cloudPaths = buildFolderPathIndex(cloud.folders);
  const localUniquePathToId = getUniquePathToId(localPaths);
  const cloudUniquePathToId = getUniquePathToId(cloudPaths);
  const cloudToMergedId = new Map<string, string>();

  cloud.folders.forEach((cloudFolder) => {
    let targetId = cloudFolder.id;

    if (!localFoldersById.has(cloudFolder.id)) {
      const cloudPath = cloudPaths.pathById.get(cloudFolder.id);
      const uniqueCloudId = cloudPath ? cloudUniquePathToId.get(cloudPath) : undefined;
      const uniqueLocalId = cloudPath ? localUniquePathToId.get(cloudPath) : undefined;

      if (uniqueCloudId === cloudFolder.id && uniqueLocalId) {
        targetId = uniqueLocalId;
      }
    }

    cloudToMergedId.set(cloudFolder.id, targetId);
  });

  const mergedFoldersById = new Map<string, TFolder>();
  const folderOrder: string[] = [];

  local.folders.forEach((folder) => {
    mergedFoldersById.set(folder.id, folder);
    folderOrder.push(folder.id);
  });

  cloud.folders.forEach((cloudFolder) => {
    const targetId = cloudToMergedId.get(cloudFolder.id) ?? cloudFolder.id;
    const existing = mergedFoldersById.get(targetId);
    const parentId = remapParentId(cloudFolder.parentId, cloudToMergedId);
    const cloudCandidate = cloneFolderWithIds(cloudFolder, targetId, parentId);

    if (!existing) {
      mergedFoldersById.set(targetId, cloudCandidate);
      folderOrder.push(targetId);
      return;
    }

    const cloudTime = cloudCandidate.updatedAt || cloudCandidate.createdAt || 0;
    const localTime = existing.updatedAt || existing.createdAt || 0;
    if (cloudTime > localTime) {
      mergedFoldersById.set(targetId, cloudCandidate);
    }
  });

  const mergedContents = new Map<string, Map<string, TConversation>>();

  const addConversations = (
    folderId: string,
    conversations: TConversation[],
    source: 'local' | 'cloud',
  ) => {
    if (!mergedContents.has(folderId)) {
      mergedContents.set(folderId, new Map());
    }

    const conversationMap = mergedContents.get(folderId);
    if (!conversationMap) return;

    conversations.forEach((conversation) => {
      const existing = conversationMap.get(conversation.conversationId);
      if (!existing || source === 'local') {
        conversationMap.set(conversation.conversationId, conversation);
        return;
      }

      conversationMap.set(conversation.conversationId, {
        ...existing,
        ...conversation,
        starred: conversation.starred ?? existing.starred,
        lastTurnAt: Math.max(existing.lastTurnAt ?? 0, conversation.lastTurnAt ?? 0) || undefined,
      } as TConversation);
    });
  };

  Object.entries(local.folderContents).forEach(([folderId, conversations]) => {
    addConversations(folderId, conversations, 'local');
  });

  Object.entries(cloud.folderContents).forEach(([folderId, conversations]) => {
    addConversations(cloudToMergedId.get(folderId) ?? folderId, conversations, 'cloud');
  });

  // Own-property writes: a folder stored as `__proto__` would otherwise set
  // the result's prototype and lose its bucket.
  const folderContents: Record<string, TConversation[]> = {};
  folderOrder.forEach((folderId) => {
    setBucket(folderContents, folderId, Array.from(mergedContents.get(folderId)?.values() ?? []));
  });

  mergedContents.forEach((conversationMap, folderId) => {
    if (!Object.hasOwn(folderContents, folderId)) {
      setBucket(folderContents, folderId, Array.from(conversationMap.values()));
    }
  });

  return {
    folders: folderOrder.map((folderId) => mergedFoldersById.get(folderId)).filter(isDefined),
    folderContents,
  };
}

function cloneFolderWithIds<TFolder extends MergeableFolder>(
  folder: TFolder,
  id: string,
  parentId: string | null,
): TFolder {
  return {
    ...folder,
    id,
    parentId,
  } as TFolder;
}

function remapParentId(parentId: string | null, idMap: Map<string, string>): string | null {
  if (!parentId) return null;
  return idMap.get(parentId) ?? parentId;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function getUniquePathToId(paths: {
  pathById: Map<string, string>;
  idsByPath: Map<string, string[]>;
}): Map<string, string> {
  const uniquePathToId = new Map<string, string>();
  paths.idsByPath.forEach((ids, path) => {
    if (ids.length === 1) {
      uniquePathToId.set(path, ids[0]);
    }
  });
  return uniquePathToId;
}

/**
 * Each folder's name path from its root, joined by `\u001f`. A folder under a
 * parent cycle, a missing parent or a blank name has none. The last record of a
 * repeated id wins the id lookup.
 */
export function buildFolderPathIndex<TFolder extends MergeableFolder>(
  folders: TFolder[],
): {
  pathById: Map<string, string>;
  idsByPath: Map<string, string[]>;
} {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const resolveIndexedPath = createFolderPathResolver(foldersById);
  const pathById = new Map<string, string>();
  const idsByPath = new Map<string, string[]>();

  folders.forEach((folder) => {
    // An earlier record of a repeated id is not the one its children resolve
    // to, so it walks its own parents.
    const path =
      foldersById.get(folder.id) === folder
        ? resolveIndexedPath(folder.id)
        : resolveFolderPath(folder, foldersById);
    if (!path) return;

    pathById.set(folder.id, path);
    const ids = idsByPath.get(path) ?? [];
    ids.push(folder.id);
    idsByPath.set(path, ids);
  });

  return { pathById, idsByPath };
}

/**
 * `resolveFolderPath` for the records `foldersById` holds. It remembers every
 * folder's path, so a deep legacy tree walks each parent link once instead of
 * once per descendant. A path is the parent's path plus the folder's name, and
 * none when the parent has none: an ancestor in a cycle, missing or blank.
 */
function createFolderPathResolver<TFolder extends MergeableFolder>(
  foldersById: Map<string, TFolder>,
): (id: string) => string | null {
  const paths = new Map<string, string | null>();
  return (id) => {
    const chain: TFolder[] = [];
    const onChain = new Set<string>();
    let above: string | null = null;
    let reachedRoot = false;
    let current = foldersById.get(id);
    while (current) {
      if (paths.has(current.id)) {
        above = paths.get(current.id) ?? null;
        break;
      }
      if (onChain.has(current.id)) break; // a cycle: no folder that reaches it has a path
      onChain.add(current.id);
      chain.push(current);
      if (!current.name.trim()) break;
      if (!current.parentId) {
        reachedRoot = true;
        break;
      }
      current = foldersById.get(current.parentId);
    }
    for (let index = chain.length - 1; index >= 0; index--) {
      const name = chain[index].name.trim();
      let path: string | null = null;
      if (name && reachedRoot && index === chain.length - 1) path = name;
      else if (name && above !== null) path = `${above}\u001f${name}`;
      paths.set(chain[index].id, path);
      above = path;
    }
    return paths.get(id) ?? null;
  };
}

function resolveFolderPath<TFolder extends MergeableFolder>(
  folder: TFolder,
  foldersById: Map<string, TFolder>,
): string | null {
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: TFolder | undefined = folder;

  while (current) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);

    const name = current.name.trim();
    if (!name) return null;
    segments.unshift(name);

    if (!current.parentId) {
      return segments.join('\u001f');
    }

    current = foldersById.get(current.parentId);
    if (!current) return null;
  }

  return null;
}

/**
 * Merges local and cloud prompts.
 */
export function mergePrompts(local: PromptItem[], cloud: PromptItem[]): PromptItem[] {
  return mergePromptsWithStats(local, cloud).items;
}

export interface PromptMergeResult {
  items: PromptItem[];
  nameConflicts: number;
}

/**
 * Preserves every prompt even when names conflict. Newer same-ID content wins
 * (`isNewerPromptCopy`: the later edit, then a content tie-break every device
 * agrees on), while a local name and pin survive a legacy cloud record that omits the field;
 * an explicit `pinnedAt: null` unpins.
 * Duplicate-name groups are reported so callers can show a non-blocking
 * warning and slash completion can disable the ambiguous names.
 */
export function mergePromptsWithStats(local: PromptItem[], cloud: PromptItem[]): PromptMergeResult {
  const itemMap = new Map<string, PromptItem>(local.map((item) => [item.id, item]));

  for (const cloudItem of cloud) {
    const localItem = itemMap.get(cloudItem.id);
    if (!localItem) {
      itemMap.set(cloudItem.id, cloudItem);
      continue;
    }

    if (!isNewerPromptCopy(cloudItem, localItem)) continue;

    let winner = cloudItem.name === undefined ? { ...cloudItem, name: localItem.name } : cloudItem;
    if (cloudItem.pinnedAt === undefined && localItem.pinnedAt !== undefined) {
      winner = { ...winner, pinnedAt: localItem.pinnedAt };
    }
    itemMap.set(cloudItem.id, winner);
  }

  const items = Array.from(itemMap.values());
  return { items, nameConflicts: getPromptNameConflictIds(items).size };
}

/**
 * Merges local and cloud fork nodes.
 * Uses forkGroupId + turnId as the unique key within each conversation.
 * Prefers the node with the newer createdAt timestamp when duplicates exist.
 */
export function mergeForkNodes(local: ForkNodesData, cloud: ForkNodesData): ForkNodesData {
  const localNodes = local?.nodes || {};
  const cloudNodes = cloud?.nodes || {};

  const allConversationIds = new Set([...Object.keys(localNodes), ...Object.keys(cloudNodes)]);

  const mergedNodes: Record<string, ForkNode[]> = {};

  allConversationIds.forEach((conversationId) => {
    const localConvoNodes = localNodes[conversationId] || [];
    const cloudConvoNodes = cloudNodes[conversationId] || [];

    // Use "forkGroupId:turnId" as unique key
    const nodeMap = new Map<string, ForkNode>();

    // Add cloud nodes first
    cloudConvoNodes.forEach((node) => {
      const key = `${node.forkGroupId}:${node.turnId}`;
      nodeMap.set(key, node);
    });

    // Merge local nodes - prefer newer createdAt
    localConvoNodes.forEach((localNode) => {
      const key = `${localNode.forkGroupId}:${localNode.turnId}`;
      const existing = nodeMap.get(key);
      if (!existing) {
        nodeMap.set(key, localNode);
      } else if (localNode.createdAt >= existing.createdAt) {
        nodeMap.set(key, localNode);
      }
    });

    const mergedArray = Array.from(nodeMap.values());
    if (mergedArray.length > 0) {
      mergedNodes[conversationId] = mergedArray;
    }
  });

  // Rebuild groups index from merged nodes
  const mergedGroups: Record<string, string[]> = {};
  for (const [conversationId, nodes] of Object.entries(mergedNodes)) {
    for (const node of nodes) {
      if (!mergedGroups[node.forkGroupId]) {
        mergedGroups[node.forkGroupId] = [];
      }
      const groupKey = `${conversationId}:${node.turnId}`;
      if (!mergedGroups[node.forkGroupId].includes(groupKey)) {
        mergedGroups[node.forkGroupId].push(groupKey);
      }
    }
  }

  return { nodes: mergedNodes, groups: mergedGroups };
}

/**
 * Merges local and cloud timeline hierarchy data.
 * Uses conversationId as the unit of conflict resolution and keeps the newer conversation snapshot.
 */
export function mergeTimelineHierarchy(
  local: TimelineHierarchyData,
  cloud: TimelineHierarchyData,
): TimelineHierarchyData {
  const localConversations = local?.conversations || {};
  const cloudConversations = cloud?.conversations || {};

  const allConversationIds = new Set([
    ...Object.keys(localConversations),
    ...Object.keys(cloudConversations),
  ]);

  const conversations: Record<string, TimelineHierarchyConversationData> = {};

  allConversationIds.forEach((conversationId) => {
    const localConversation = localConversations[conversationId];
    const cloudConversation = cloudConversations[conversationId];

    if (!localConversation && cloudConversation) {
      conversations[conversationId] = cloudConversation;
      return;
    }

    if (localConversation && !cloudConversation) {
      conversations[conversationId] = localConversation;
      return;
    }

    if (!localConversation || !cloudConversation) {
      return;
    }

    conversations[conversationId] =
      (localConversation.updatedAt || 0) >= (cloudConversation.updatedAt || 0)
        ? localConversation
        : cloudConversation;
  });

  return { conversations };
}
