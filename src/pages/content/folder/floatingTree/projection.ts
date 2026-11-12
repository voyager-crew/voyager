import {
  EXACT_CONVERSATION_IDENTITY,
  readConversationStars,
} from '@/features/folder/model/conversationStars';
import {
  type ConversationSortMode,
  ownBucket,
  sortConversationsByPriority,
} from '@/features/folder/model/folderData';
import type { SubfolderPlacement } from '@/features/folder/model/subfolderPlacement';

import type { ConversationReference, Folder, FolderData } from '../types';
import { type TreeSiteOptions, layoutFolders } from './shared';

/** The invisible item every top-level row hangs under. No folder or conversation key equals it. */
export const ROOT_ITEM_KEY = 'r';

/**
 * Item keys encode opaque ids with a length prefix, so no id, however it is
 * spelled, can produce another item's key: `f<len>:<folderId>` for a folder,
 * `c<len>:<parentKey><len>:<conversationId>` for a conversation row, plus
 * `#<n>` for the n-th repeat of a conversation in one bucket. A separator
 * alone would not do: ids are free text and may contain any separator.
 */
export function folderKey(folderId: string): string {
  return `f${folderId.length}:${folderId}`;
}

export function conversationKey(parentKey: string, conversationId: string, occurrence = 0): string {
  const key = `c${parentKey.length}:${parentKey}${conversationId.length}:${conversationId}`;
  return occurrence > 0 ? `${key}#${occurrence}` : key;
}

export type FolderNode = {
  kind: 'folder';
  key: string;
  folder: Folder;
  /** The folder above it, or `ROOT_ITEM_KEY`. */
  parentKey: string;
  /** Nesting depth from 0 at the root. */
  depth: number;
  /** What the folder holds as the tree shows it: its conversations and shown subfolders. */
  count: number;
};

export type ConversationNode = {
  kind: 'conversation';
  key: string;
  conversation: ConversationReference;
  /** The `folderContents` bucket the row shows: a folder id or the root bucket. */
  bucketId: string;
  /** The depth of the folder holding it, -1 at the root. */
  folderDepth: number;
};

export type TreeNode = FolderNode | ConversationNode;

/**
 * One data revision laid out for display: every node by key and each node's
 * children in display order, expanded or not. It never writes to the data.
 */
export type TreeProjection = {
  readonly nodes: ReadonlyMap<string, TreeNode>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Folder nodes in display order. */
  readonly folders: readonly FolderNode[];
  readonly rootConversationCount: number;
};

export type ProjectionInput = {
  data: FolderData;
  rootBucketId: string;
  conversationSortMode: ConversationSortMode;
  /** Inside a folder: subfolders before (`'first'`, the default) or after its conversations. */
  subfolderPlacement?: SubfolderPlacement;
  site?: Pick<
    TreeSiteOptions,
    'folderOrder' | 'conversationOrder' | 'rootSection' | 'filter' | 'conversationIdentity'
  >;
};

/**
 * Lays out folders (`layoutFolders`: cycles cut, repeats dropped) and each
 * bucket's conversations: stored order, or starred first then the sort mode.
 * A row shows starred when any copy of its conversation is (`readConversationStars`).
 * A folder lists its subfolders before its own conversations, or after them
 * with `subfolderPlacement: 'last'`. The root lists its conversations first,
 * unless `rootSection` puts them after its folders under a heading.
 * A site filter reads the same cycle-cut layout, so it cannot lose a cycle.
 */
export function buildTreeProjection({
  data,
  rootBucketId,
  conversationSortMode,
  subfolderPlacement = 'first',
  site,
}: ProjectionInput): TreeProjection {
  const layout = layoutFolders(data, site?.folderOrder);
  const filter = site?.filter?.(layout);
  const shownFolders = (list: readonly Folder[]): readonly Folder[] =>
    filter ? list.filter((folder) => filter.folder(folder)) : list;
  const nodes = new Map<string, TreeNode>();
  const children = new Map<string, readonly string[]>();
  const folders: FolderNode[] = [];
  const order = (list: readonly ConversationReference[]): readonly ConversationReference[] =>
    site?.conversationOrder === 'stored'
      ? list
      : sortConversationsByPriority(list, conversationSortMode);
  const starred = readConversationStars(
    data,
    site?.conversationIdentity ?? EXACT_CONVERSATION_IDENTITY,
  );
  const withSharedStar = (conversation: ConversationReference): ConversationReference =>
    !!conversation.starred === starred(conversation)
      ? conversation
      : { ...conversation, starred: true };

  const conversationsOf = (parentKey: string, bucketId: string, folderDepth: number): string[] => {
    const seen = new Map<string, number>();
    const bucket = (ownBucket(data.folderContents, bucketId) ?? []).map(withSharedStar);
    const shown = filter
      ? bucket.filter((conversation) => filter.conversation(conversation, bucketId))
      : bucket;
    return order(shown).map((conversation) => {
      const occurrence = seen.get(conversation.conversationId) ?? 0;
      seen.set(conversation.conversationId, occurrence + 1);
      const key = conversationKey(parentKey, conversation.conversationId, occurrence);
      nodes.set(key, { kind: 'conversation', key, conversation, bucketId, folderDepth });
      return key;
    });
  };

  const addFolder = (folder: Folder, depth: number, parentKey: string): string => {
    const key = folderKey(folder.id);
    const node: FolderNode = { kind: 'folder', key, folder, parentKey, depth, count: 0 };
    nodes.set(key, node);
    folders.push(node);
    const subfolderKeys = shownFolders(layout.children.get(folder.id) ?? []).map((child) =>
      addFolder(child, depth + 1, key),
    );
    const conversationKeys = conversationsOf(key, folder.id, depth);
    node.count = subfolderKeys.length + conversationKeys.length;
    children.set(
      key,
      subfolderPlacement === 'last'
        ? [...conversationKeys, ...subfolderKeys]
        : [...subfolderKeys, ...conversationKeys],
    );
    return key;
  };

  const rootConversations = conversationsOf(ROOT_ITEM_KEY, rootBucketId, -1);
  const rootFolders = shownFolders(layout.roots).map((folder) =>
    addFolder(folder, 0, ROOT_ITEM_KEY),
  );
  children.set(
    ROOT_ITEM_KEY,
    site?.rootSection
      ? [...rootFolders, ...rootConversations]
      : [...rootConversations, ...rootFolders],
  );

  return { nodes, children, folders, rootConversationCount: rootConversations.length };
}
