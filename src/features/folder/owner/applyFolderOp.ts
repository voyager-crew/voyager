import type { ConversationReference, Folder, FolderData } from '@/core/types/folder';
import { MAX_FOLDER_DEPTH } from '@/features/folder/constants';
import { readConversationStars } from '@/features/folder/model/conversationStars';
import {
  getFolderAndDescendants,
  getFolderDepth,
  moveFolder,
  ownBucket,
  removeFolder,
  reorderConversations,
  setBucket,
} from '@/features/folder/model/folderData';
import { placeConversations } from '@/features/folder/model/placeConversations';
import { applyNativeTitle } from '@/pages/content/folder/conversationTitleSync';

import { type ConversationSeed, type FolderOpBody, type OpOutcome, rejected } from './folderOps';
import type { AddVia, FolderSitePolicy } from './folderOwnerPolicy';

export interface AppliedOp {
  data: FolderData;
  outcome: OpOutcome;
}

const saved = (data: FolderData): AppliedOp => ({ data, outcome: { kind: 'saved' } });
const unchanged = (data: FolderData, reason: 'noop' | 'present' = 'noop'): AppliedOp => ({
  data,
  outcome: { kind: 'unchanged', reason },
});
const reject = (data: FolderData, reason: Parameters<typeof rejected>[0]): AppliedOp => ({
  data,
  outcome: rejected(reason),
});

const findFolder = (data: FolderData, id: string): Folder | undefined =>
  data.folders.find((folder) => folder.id === id);

const bucketExists = (data: FolderData, id: string, policy: FolderSitePolicy): boolean =>
  id === policy.rootBucketId || findFolder(data, id) !== undefined;

const countRecords = (data: FolderData): number =>
  Object.keys(data.folderContents).reduce(
    (total, id) => total + (ownBucket(data.folderContents, id)?.length ?? 0),
    0,
  );

/** Whether a stored record is the conversation an op names, by the site's identity. */
function matcher(policy: FolderSitePolicy, id: string): (c: ConversationReference) => boolean {
  const key = policy.idKey(id);
  return (conversation) => key !== null && policy.keysOf(conversation).includes(key);
}

/** The first folder record with `folderId`, rewritten by `edit`; `null` from `edit` is a no-op. */
function editFolder(
  data: FolderData,
  folderId: string,
  now: number,
  edit: (folder: Folder) => Folder | null,
): AppliedOp {
  const index = data.folders.findIndex((folder) => folder.id === folderId);
  if (index < 0) return reject(data, 'folder_missing');
  const next = edit(data.folders[index]);
  if (!next) return unchanged(data);
  const folders = data.folders.slice();
  folders[index] = { ...next, updatedAt: now };
  return saved({ ...data, folders });
}

/**
 * Rewrites the selected records of `bucketIds` (every bucket when omitted).
 * `edit` returns the new record, or `null` when the record already matches.
 * Untouched buckets and records keep their identity; the input is never mutated.
 */
function editRecords(
  data: FolderData,
  select: (conversation: ConversationReference) => boolean,
  edit: (conversation: ConversationReference) => ConversationReference | null,
  bucketIds: readonly string[] = Object.keys(data.folderContents),
): AppliedOp & { matched: boolean } {
  let folderContents: Record<string, ConversationReference[]> | null = null;
  let matched = false;
  for (const bucketId of bucketIds) {
    const bucket = ownBucket(data.folderContents, bucketId);
    if (!bucket) continue;
    let nextBucket: ConversationReference[] | null = null;
    for (let index = 0; index < bucket.length; index++) {
      if (!select(bucket[index])) continue;
      matched = true;
      const next = edit(bucket[index]);
      if (!next) continue;
      nextBucket ??= bucket.slice();
      nextBucket[index] = next;
    }
    if (!nextBucket) continue;
    folderContents ??= { ...data.folderContents };
    setBucket(folderContents, bucketId, nextBucket);
  }
  return folderContents
    ? { ...saved({ ...data, folderContents }), matched }
    : { ...unchanged(data), matched };
}

/**
 * The record a seed files: AI Studio moves the stored record if any bucket holds it.
 * A new record takes the conversation's star from its other copies (`starred`).
 */
function recordForSeed(
  data: FolderData,
  seed: ConversationSeed,
  via: AddVia,
  policy: FolderSitePolicy,
  now: number,
  starred: (conversation: ConversationReference) => boolean,
): ConversationReference {
  if (policy.singleBucket) {
    for (const bucketId of Object.keys(data.folderContents)) {
      const stored = ownBucket(data.folderContents, bucketId)?.find(
        (conversation) => conversation.conversationId === seed.conversationId,
      );
      if (stored) return stored;
    }
  }
  const opened = via === 'native-menu' || via === 'project';
  const record: ConversationReference = {
    conversationId: seed.conversationId,
    title: seed.title,
    url: seed.url,
    addedAt: now,
    ...(opened ? { lastOpenedAt: now } : {}),
    ...(seed.lastTurnAt !== undefined ? { lastTurnAt: seed.lastTurnAt } : {}),
    ...(seed.isGem !== undefined ? { isGem: seed.isGem } : {}),
    ...(seed.gemId !== undefined ? { gemId: seed.gemId } : {}),
  };
  // A star is the conversation's: a copy filed unstarred would lose it once the
  // starred copy is removed.
  return starred(record) ? { ...record, starred: true } : record;
}

function placeSeeds(
  data: FolderData,
  target: string,
  seeds: readonly ConversationSeed[],
  via: AddVia,
  policy: FolderSitePolicy,
  now: number,
): FolderData {
  const starred = readConversationStars(data, policy);
  const records = seeds.map((seed) => recordForSeed(data, seed, via, policy, now, starred));
  return placeConversations(
    data,
    records,
    policy.singleBucket
      ? { target, placement: 'keep', removeFrom: 'everywhere', removeWhenPresent: true }
      : { target, placement: policy.addPlacement(via), keysOf: policy.keysOf },
  ).data;
}

/**
 * Applies one op to fresh data. Pure: `data` is never mutated, and the same
 * function computes the owner's commit and the client's optimistic view.
 */
export function applyFolderOp(
  data: FolderData,
  body: FolderOpBody,
  policy: FolderSitePolicy,
  now: number,
): AppliedOp {
  switch (body.kind) {
    case 'createFolder': {
      if (findFolder(data, body.folderId)) return unchanged(data, 'present');
      if (!body.name.trim()) return reject(data, 'name_invalid');
      if (body.parentId !== null) {
        if (!findFolder(data, body.parentId)) return reject(data, 'folder_missing');
        if (getFolderDepth(data, body.parentId) >= MAX_FOLDER_DEPTH) {
          return reject(data, 'depth_limit');
        }
      }
      const sortIndex =
        data.folders
          .filter((folder) => folder.parentId === body.parentId)
          .reduce((max, folder) => Math.max(max, folder.sortIndex ?? -1), -1) + 1;
      const folderContents = { ...data.folderContents };
      setBucket(folderContents, body.folderId, ownBucket(folderContents, body.folderId) ?? []);
      const folder: Folder = {
        id: body.folderId,
        name: body.name,
        parentId: body.parentId,
        isExpanded: true,
        sortIndex,
        createdAt: now,
        updatedAt: now,
      };
      return saved({ folders: [...data.folders, folder], folderContents });
    }
    case 'renameFolder':
      if (!body.name.trim()) return reject(data, 'name_invalid');
      return editFolder(data, body.folderId, now, (folder) =>
        folder.name === body.name ? null : { ...folder, name: body.name },
      );
    case 'removeFolder': {
      const next = removeFolder(data, body.folderId);
      return next === data ? unchanged(data) : saved(next);
    }
    case 'moveFolder': {
      if (!findFolder(data, body.folderId)) return reject(data, 'folder_missing');
      if (body.parentId !== null) {
        if (!findFolder(data, body.parentId)) return reject(data, 'target_missing');
        if (getFolderAndDescendants(data, body.folderId).includes(body.parentId)) {
          return reject(data, 'cycle');
        }
      }
      const next = moveFolder(data, body.folderId, body.parentId, now, body.index);
      return next === data ? unchanged(data) : saved(next);
    }
    case 'setFolderColor':
      return editFolder(data, body.folderId, now, (folder) => {
        if (body.color !== null) {
          return folder.color === body.color ? null : { ...folder, color: body.color };
        }
        if (folder.color === undefined) return null;
        const { color: _removed, ...rest } = folder;
        return rest;
      });
    case 'setFolderPinned':
      return editFolder(data, body.folderId, now, (folder) =>
        !!folder.pinned === body.pinned ? null : { ...folder, pinned: body.pinned },
      );
    case 'setFolderExpanded':
      return editFolder(data, body.folderId, now, (folder) =>
        folder.isExpanded === body.expanded ? null : { ...folder, isExpanded: body.expanded },
      );
    case 'setFolderInstructions':
      return editFolder(data, body.folderId, now, (folder) => {
        if (body.instructions !== null) {
          return folder.instructions === body.instructions
            ? null
            : { ...folder, instructions: body.instructions };
        }
        if (folder.instructions === undefined) return null;
        const { instructions: _removed, ...rest } = folder;
        return rest;
      });
    case 'addConversations': {
      if (!bucketExists(data, body.target, policy)) return reject(data, 'target_missing');
      const next = placeSeeds(data, body.target, body.seeds, body.via, policy, now);
      const before = ownBucket(data.folderContents, body.target)?.length ?? 0;
      const grew = (ownBucket(next.folderContents, body.target)?.length ?? 0) > before;
      return grew || countRecords(next) !== countRecords(data)
        ? saved(next)
        : unchanged(data, 'present');
    }
    case 'moveConversations': {
      if (!bucketExists(data, body.target, policy)) return reject(data, 'target_missing');
      const source = ownBucket(data.folderContents, body.from) ?? [];
      const fresh = body.ids.flatMap((id) => source.find(matcher(policy, id)) ?? []);
      if (fresh.length === 0) return reject(data, 'source_missing');
      if (body.index !== undefined) {
        const ids = fresh.map((conversation) => conversation.conversationId);
        const next = reorderConversations(
          data,
          ids,
          body.from,
          body.target,
          body.index,
          body.sortMode ?? 'manual',
          readConversationStars(data, policy),
        );
        return next === data ? unchanged(data) : saved(next);
      }
      if (body.from === body.target) return unchanged(data);
      const records = policy.resetAddedAtOnMove
        ? fresh.map((conversation) => ({ ...conversation, addedAt: now }))
        : fresh;
      return saved(
        placeConversations(data, records, {
          target: body.target,
          placement: policy.singleBucket ? 'keep' : 'append',
          keysOf: policy.keysOf,
          removeFrom: policy.singleBucket ? 'everywhere' : { bucket: body.from },
          removeWhenPresent: true,
        }).data,
      );
    }
    case 'reorderConversations': {
      if (!bucketExists(data, body.target, policy)) return reject(data, 'target_missing');
      const ensured =
        body.from === null && body.ensure
          ? placeSeeds(data, body.target, body.ensure, 'outside-drop', policy, now)
          : data;
      const from = body.from ?? body.target;
      const source = ownBucket(ensured.folderContents, from) ?? [];
      const ids = body.ids.filter((id) => source.some((c) => c.conversationId === id));
      if (ids.length === 0) return ensured === data ? unchanged(data) : saved(ensured);
      const starred = readConversationStars(ensured, policy);
      return saved(
        reorderConversations(ensured, ids, from, body.target, body.index, body.sortMode, starred),
      );
    }
    case 'removeConversations': {
      const bucket = ownBucket(data.folderContents, body.folderId);
      const remaining = bucket?.filter((c) => !body.ids.includes(c.conversationId));
      if (!bucket || !remaining || remaining.length === bucket.length) return unchanged(data);
      const folderContents = { ...data.folderContents };
      setBucket(folderContents, body.folderId, remaining);
      return saved({ ...data, folderContents });
    }
    case 'removeConversationEverywhere': {
      const matches = matcher(policy, body.conversationId);
      let folderContents: Record<string, ConversationReference[]> | null = null;
      for (const bucketId of Object.keys(data.folderContents)) {
        const bucket = ownBucket(data.folderContents, bucketId);
        if (!bucket?.some(matches)) continue;
        folderContents ??= { ...data.folderContents };
        setBucket(
          folderContents,
          bucketId,
          bucket.filter((c) => !matches(c)),
        );
      }
      return folderContents ? saved({ ...data, folderContents }) : unchanged(data);
    }
    case 'setConversationStarred': {
      const everywhere = body.scope === 'everywhere';
      const result = editRecords(
        data,
        everywhere
          ? matcher(policy, body.conversationId)
          : (c) => c.conversationId === body.conversationId,
        (c) => (!!c.starred === body.starred ? null : { ...c, starred: body.starred }),
        body.scope === 'everywhere' ? undefined : [body.scope.folderId],
      );
      return result.matched ? result : reject(data, 'conversation_missing');
    }
    case 'renameConversation': {
      const result = editRecords(
        data,
        (c) => c.conversationId === body.conversationId,
        (c) => (c.title === body.title ? null : { ...c, title: body.title }),
        [body.folderId],
      );
      return result.matched ? result : reject(data, 'conversation_missing');
    }
    case 'syncNativeTitles': {
      const titleByKey = new Map<string, string>();
      for (const entry of body.entries) {
        const key = policy.idKey(entry.conversationId);
        if (key !== null) titleByKey.set(key, entry.title);
      }
      const titleOf = (c: ConversationReference): string | undefined =>
        policy
          .keysOf(c)
          .map((key) => titleByKey.get(key))
          .find((title) => title !== undefined);
      return editRecords(
        data,
        (c) => titleOf(c) !== undefined,
        (c) => {
          const copy = { ...c };
          return applyNativeTitle([copy], titleOf(c) as string, now) ? copy : null;
        },
      );
    }
    case 'restoreNativeTitle': {
      const title = body.nativeTitle?.trim() || null;
      return editRecords(data, matcher(policy, body.conversationId), (c) => {
        const retitle = title !== null && c.title !== title;
        if (!c.customTitle && !retitle) return null;
        const { customTitle: _removed, ...next } = c;
        return retitle ? { ...next, title, updatedAt: now } : next;
      });
    }
    case 'setConversationGem':
      return editRecords(
        data,
        (c) => c.url.includes(body.hexId),
        (c) => {
          const url = c.url.replace(/\/app\/([^/?]+)/, `/gem/${body.gemId}/$1`);
          return c.isGem === true && c.gemId === body.gemId && c.url === url
            ? null
            : { ...c, isGem: true, gemId: body.gemId, url };
        },
      );
    case 'markConversationOpened':
      return editRecords(data, matcher(policy, body.conversationId), (c) =>
        // De-duplicates near-simultaneous route updates and never moves the time back.
        c.lastOpenedAt && body.at - c.lastOpenedAt < 1000
          ? null
          : { ...c, lastOpenedAt: body.at, updatedAt: body.at },
      );
    case 'setConversationActivity': {
      const latestByKey = new Map<string, number>();
      for (const entry of body.entries) {
        const key = policy.idKey(entry.conversationId);
        if (key !== null) {
          latestByKey.set(key, Math.max(latestByKey.get(key) ?? 0, entry.lastTurnAt));
        }
      }
      const latestOf = (c: ConversationReference): number =>
        Math.max(0, ...policy.keysOf(c).map((key) => latestByKey.get(key) ?? 0));
      return editRecords(
        data,
        (c) => latestOf(c) > 0,
        (c) => (latestOf(c) > (c.lastTurnAt ?? 0) ? { ...c, lastTurnAt: latestOf(c) } : null),
      );
    }
    case 'importFile':
    case 'restoreBackup':
    case 'cloudMerge':
      // Bulk ops need backups and merge stats; the owner applies them from P3 on.
      return reject(data, 'invalid_payload');
  }
}
