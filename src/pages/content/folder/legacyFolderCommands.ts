/**
 * Gemini's legacy `FolderCommands` façade (DESIGN-v2 §8.5): each op calls the
 * `FolderStore` method that does that edit today, synchronously, so the store's
 * change hook and every re-render run in the same tick as before. Outcomes map
 * the store's result; `set*` ops toggle only when the stored value differs.
 */
import type { ConversationReference } from '@/core/types/folder';
import {
  type EditOutcome,
  type FolderCommands,
  NOOP,
  type OpOf,
  type FolderEditBody,
  failed,
  legacyOutcome,
} from '@/features/folder/commands/folderCommands';
import { ownBucket } from '@/features/folder/model/folderData';
import { type ConversationSeed, rejected } from '@/features/folder/owner/folderOps';

import type { FolderStore } from './FolderStore';
import { resolveConversationRouteId } from './folderConversationIdentity';
import type { DragData } from './types';

type Kind = FolderEditBody['kind'];
type Handlers = { [K in Kind]: (body: OpOf<K>) => EditOutcome | Promise<EditOutcome> };

const ROOT_PARENT = '__root__';
const asDragData = (seeds: ConversationSeed[]): DragData => ({
  type: 'conversation',
  title: seeds[0]?.title ?? '',
  conversations: seeds.map((seed) => ({ ...seed, addedAt: Date.now() })),
});

export function createLegacyFolderCommands(store: FolderStore): FolderCommands {
  const folderOf = (id: string) => store.data.folders.find((folder) => folder.id === id);
  const recordIn = (bucket: string, id: string): ConversationReference | undefined =>
    ownBucket(store.data.folderContents, bucket)?.find((c) => c.conversationId === id);
  /** Runs a void store edit and reports what the legacy store can say about it. */
  const edit = (apply: () => void): EditOutcome => {
    const editable = store.canEdit;
    apply();
    return legacyOutcome(editable);
  };
  const addFromNative = (target: string, s: ConversationSeed) =>
    store.addConversationToFolderFromNative(
      target,
      s.conversationId,
      s.title,
      s.url,
      s.isGem,
      s.gemId,
      s.lastTurnAt,
    );
  const toggleIf = (differs: boolean | undefined, toggle: () => void): EditOutcome => {
    if (differs === undefined)
      return store.canEdit ? rejected('folder_missing') : failed('read_only');
    return differs ? edit(toggle) : NOOP;
  };

  const handlers: Handlers = {
    placeAIStudioPrompt: () => rejected('unsupported'),
    saveCurrentData: () => rejected('unsupported'),
    ensureDefaultAIStudioFolder: () => rejected('unsupported'),
    dropConversations: ({ target, payload, index }) =>
      edit(() => {
        if (index !== undefined) {
          if (!payload.sourceFolderId) store.ensureConversationsInFolder(target, payload);
          const ids = payload.conversations?.length
            ? payload.conversations.map((record) => record.conversationId)
            : payload.conversationId
              ? [payload.conversationId]
              : [];
          store.reorderOrMoveConversations(ids, payload.sourceFolderId ?? target, target, index);
        } else if (payload.conversations?.length) {
          store.addConversationsToFolder(target, payload.conversations, payload.sourceFolderId);
        } else {
          store.addConversationToFolder(target, payload);
        }
      }),
    bufferNativeTitle: ({ folderId, index, title }) =>
      edit(() => {
        const record = ownBucket(store.data.folderContents, folderId)?.[index];
        if (record) store.bufferTitleUpdate(record, title);
      }),
    flushNativeTitles: () => edit(() => store.flushTitleUpdates()),
    syncNativeSidebarTitles: async () => {
      const editable = store.canEdit;
      await store.syncConversationTitlesFromNative();
      return legacyOutcome(editable);
    },
    createFolder: ({ name, parentId }) => {
      // The legacy store picks its own id; `folderId` is honoured from P4 on.
      if (store.createFolder(name, parentId)) return legacyOutcome(true);
      return store.canEdit ? rejected('depth_limit') : failed('read_only');
    },
    renameFolder: ({ folderId, name }) => edit(() => store.renameFolder(folderId, name)),
    removeFolder: ({ folderId }) => edit(() => store.removeFolder(folderId)),
    moveFolder: ({ folderId, parentId, index }) =>
      edit(() => {
        if (index !== undefined) store.reorderFolder(folderId, parentId ?? ROOT_PARENT, index);
        else if (parentId === null) store.moveFolderToRoot({ type: 'folder', folderId, title: '' });
        else store.addFolderToFolder(parentId, { type: 'folder', folderId, title: '' });
      }),
    setFolderColor: ({ folderId, color }) =>
      edit(() => store.changeFolderColor(folderId, color ?? 'default')),
    setFolderPinned: ({ folderId, pinned }) => {
      const folder = folderOf(folderId);
      return toggleIf(folder && !!folder.pinned !== pinned, () => store.togglePinFolder(folderId));
    },
    setFolderExpanded: ({ folderId, expanded }) => {
      const folder = folderOf(folderId);
      return toggleIf(folder && !!folder.isExpanded !== expanded, () =>
        store.toggleFolder(folderId),
      );
    },
    setFolderInstructions: async ({ folderId, instructions }) => {
      const editable = store.canEdit;
      const exists = !!folderOf(folderId);
      if (await store.setFolderInstructions(folderId, instructions ?? undefined)) {
        return { kind: 'saved' };
      }
      if (!editable) return failed('read_only');
      return exists ? failed('storage_error') : rejected('folder_missing');
    },
    addConversations: ({ target, seeds, via }) => {
      // An outside drop does not check its target today (FolderSelection); the others do.
      if (via === 'outside-drop') {
        const records = asDragData(seeds).conversations ?? [];
        return edit(() => store.addConversationsToFolder(target, records));
      }
      if (!folderOf(target))
        return store.canEdit ? rejected('target_missing') : failed('read_only');
      return edit(() => seeds.forEach((seed) => addFromNative(target, seed)));
    },
    moveConversations: ({ ids, from, target, via, index }) => {
      if (index !== undefined) {
        return edit(() => store.reorderOrMoveConversations(ids, from, target, index));
      }
      const records = ids.map((id) => recordIn(from, id));
      if (!records.every((record) => record !== undefined)) return rejected('source_missing');
      if (via === 'tree-drag') {
        return edit(() => store.addConversationsToFolder(target, records, from));
      }
      return edit(() => records.forEach((c) => store.moveConversationToFolder(from, target, c)));
    },
    reorderConversations: ({ ids, from, target, index, ensure }) =>
      edit(() => {
        if (ensure?.length) store.ensureConversationsInFolder(target, asDragData(ensure));
        store.reorderOrMoveConversations(ids, from ?? target, target, index);
      }),
    removeConversations: ({ folderId, ids }) =>
      edit(() =>
        ids.length === 1
          ? store.removeConversationFromFolder(folderId, ids[0])
          : store.removeConversationsFromFolder(folderId, new Set(ids)),
      ),
    removeConversationEverywhere: ({ conversationId }) =>
      edit(() => store.removeConversationFromAllFolders(conversationId)),
    setConversationStarred: ({ conversationId, starred, scope }) => {
      if (scope === 'everywhere') {
        // An imported record keeps a synthetic id beside its chat's real `/app/` route,
        // which every copy answers to; the synthetic id names only itself.
        const record = Object.values(store.data.folderContents)
          .flat()
          .find((c) => c.conversationId === conversationId);
        const routeId = resolveConversationRouteId(record?.url, conversationId) ?? conversationId;
        return edit(() => store.setConversationStarAcrossFolders(routeId, starred));
      }
      const record = recordIn(scope.folderId, conversationId);
      return toggleIf(record && !!record.starred !== starred, () =>
        store.toggleConversationStar(scope.folderId, conversationId),
      );
    },
    // The tree buffers several titles and flushes once; one op flushes its own.
    renameConversation: ({ folderId, conversationId, title }) => {
      const record = recordIn(folderId, conversationId);
      if (!record) return rejected('conversation_missing');
      return edit(() => {
        store.bufferTitleUpdate(record, title);
        store.flushTitleUpdates();
      });
    },
    syncNativeTitles: ({ entries }) =>
      edit(() => entries.forEach((e) => store.updateConversationTitle(e.conversationId, e.title))),
    restoreNativeTitle: async ({ conversationId, nativeTitle }) => {
      const editable = store.canEdit;
      await store.restoreNativeTitleSync(conversationId, nativeTitle);
      return legacyOutcome(editable);
    },
    setConversationGem: ({ hexId, gemId }) => edit(() => store.updateConversationGem(hexId, gemId)),
    markConversationOpened: ({ conversationId }) =>
      edit(() => store.markConversationAsRecentlyOpened(conversationId)),
    setConversationActivity: ({ entries }) =>
      edit(() =>
        entries.forEach((e) => store.markConversationLastTurnAt(e.conversationId, e.lastTurnAt)),
      ),
  };

  return {
    status: () => (store.canEdit ? 'ready' : 'read_only'),
    view: () => store.data,
    run: (body) => {
      const handler = handlers[body.kind] as (b: FolderEditBody) => ReturnType<Handlers[Kind]>;
      return Promise.resolve(handler(body));
    },
    // Parsing, backup and feedback stay with the transfer controller; only its prepared write moves.
    runBulk: async (body) => {
      if (body.kind !== 'commitPreparedData') return failed('not_loaded');
      return (await store.replaceData(body.data, body.beforeWrite))
        ? { kind: 'saved' }
        : failed('storage_error');
    },
    flush: () => {
      store.flushPendingSaveData();
      return Promise.resolve();
    },
  };
}
