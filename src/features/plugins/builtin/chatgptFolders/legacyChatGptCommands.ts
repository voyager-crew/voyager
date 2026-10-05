/**
 * ChatGPT's legacy `FolderCommands` façade (DESIGN-v2 §8.5) over
 * `ChatGptFolderStore`: every edit runs the shared `applyFolderOp` on the
 * current data and commits its result, so outcomes come from the op. Edits
 * ChatGPT folders have no UI for are refused.
 */
import {
  type EditOutcome,
  type FailReason,
  type FolderCommands,
  NOOP,
  type OpOf,
  type FolderEditBody,
  type OrdinaryOpBody,
  failed,
  legacyOutcome,
} from '@/features/folder/commands/folderCommands';
import { cloneFolderData, ownBucket } from '@/features/folder/model/folderData';
import { applyFolderOp } from '@/features/folder/owner/applyFolderOp';
import { rejected } from '@/features/folder/owner/folderOps';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';

import type { ChatGptFolderChange, ChatGptFolderStore } from './ChatGptFolderStore';
import { importChatGptFolders } from './transfer';

type Kind = FolderEditBody['kind'];
type Handler<K extends Kind> = (body: OpOf<K>) => EditOutcome | Promise<EditOutcome>;

const unsupported = () => rejected('unsupported');

/** ChatGPT's folder ids, `folder_<ms>_<rand9>`; the id a tree proposes is not used. */
function newFolderId(now: number): string {
  return `folder_${now}_${Math.random().toString(36).slice(2, 11)}`;
}

type ApplyOptions = {
  /** What the commit stamps when it is only a time. */
  change?: ChatGptFolderChange;
  /** The failure reported while the bucket has not loaded. */
  notReady?: FailReason;
  now?: number;
};

export function createLegacyChatGptCommands(store: ChatGptFolderStore): FolderCommands {
  const recordIn = (bucket: string, id: string) =>
    ownBucket(store.data.folderContents, bucket)?.find((c) => c.conversationId === id);

  /** Runs a shared owner op on the current data and commits what it computed. */
  const applyOp = (body: OrdinaryOpBody, options: ApplyOptions = {}): EditOutcome => {
    if (!store.ready) return failed(options.notReady ?? 'read_only');
    const policy = FOLDER_SITE_POLICIES.chatgpt;
    const { data, outcome } = applyFolderOp(store.data, body, policy, options.now ?? Date.now());
    if (outcome.kind !== 'saved') return outcome;
    return store.apply(data, options.change) ? legacyOutcome(true) : NOOP;
  };

  /** Moves only rows still in `from`; one that is gone (moved in another tab) refuses them all. */
  const moveConversations = (ids: string[], from: string, target: string): EditOutcome => {
    if (!ids.every((id) => recordIn(from, id))) return rejected('source_missing');
    return applyOp({ kind: 'moveConversations', ids, from, target, via: 'tree-drag' });
  };

  const handlers: { [K in Kind]: Handler<K> } = {
    createFolder: ({ name, parentId }) => {
      const now = Date.now();
      return applyOp({ kind: 'createFolder', folderId: newFolderId(now), name, parentId }, { now });
    },
    renameFolder: (body) => applyOp(body),
    removeFolder: (body) => applyOp(body),
    // ChatGPT has always stored a cleared colour as 'default'; keep its records in that shape.
    setFolderColor: ({ folderId, color }) =>
      applyOp({ kind: 'setFolderColor', folderId, color: color ?? 'default' }),
    setFolderPinned: (body) => applyOp(body),
    setFolderExpanded: (body) => applyOp(body),
    addConversations: (body) => applyOp(body, { notReady: 'not_loaded' }),
    moveConversations: ({ ids, from, target }) => moveConversations(ids, from, target),
    moveFolder: (body) => applyOp(body),
    // Only the tree's own rows drag here, so a drop always names the folder it left.
    dropConversations: ({ target, payload, index }) => {
      const from = payload.sourceFolderId;
      const ids = payload.conversations?.length
        ? payload.conversations.map((record) => record.conversationId)
        : payload.conversationId
          ? [payload.conversationId]
          : [];
      if (!from || ids.length === 0) return rejected('source_missing');
      if (index !== undefined) {
        if (!ids.every((id) => recordIn(from, id))) return rejected('source_missing');
        return applyOp({
          kind: 'reorderConversations',
          ids,
          from,
          target,
          index,
          sortMode: 'manual',
        });
      }
      return from === target ? NOOP : moveConversations(ids, from, target);
    },
    removeConversations: (body) => applyOp(body),
    setConversationStarred: (body) => applyOp(body),
    syncNativeTitles: (body) => applyOp(body),
    placeAIStudioPrompt: () => rejected('unsupported'),
    saveCurrentData: () => rejected('unsupported'),
    ensureDefaultAIStudioFolder: () => rejected('unsupported'),
    bufferNativeTitle: unsupported,
    flushNativeTitles: unsupported,
    syncNativeSidebarTitles: unsupported,
    setFolderInstructions: unsupported,
    reorderConversations: unsupported,
    removeConversationEverywhere: unsupported,
    renameConversation: unsupported,
    restoreNativeTitle: (body) => applyOp(body),
    setConversationGem: unsupported,
    markConversationOpened: (body) => applyOp(body, { change: 'opened' }),
    setConversationActivity: (body) => applyOp(body, { change: 'activity' }),
  };

  async function importFile(payload: unknown): Promise<EditOutcome> {
    if (!store.ready) return failed('not_loaded');
    const outcome = await importChatGptFolders(payload, cloneFolderData(store.data));
    if (!outcome.ok) {
      if (outcome.reason === 'failed') return failed('storage_error', outcome.message ?? '');
      const messageKey =
        outcome.reason === 'wrong-site'
          ? 'folder_import_wrong_site'
          : 'folder_import_invalid_format';
      return { kind: 'rejected', reason: 'invalid_payload', messageKey };
    }
    if (!(await store.replaceData(outcome.data))) return failed('storage_error');
    return { kind: 'saved', stats: outcome.stats };
  }

  return {
    status: () => (store.ready ? 'ready' : 'read_only'),
    view: () => store.data,
    run: (body) => {
      const handler = handlers[body.kind] as Handler<Kind>;
      return Promise.resolve(handler(body as never));
    },
    // Merge only, as the panel's import does today; ChatGPT has no backups or Drive merge.
    runBulk: (body) =>
      body.kind === 'importFile' && body.strategy === 'merge'
        ? importFile(body.payload)
        : Promise.resolve(unsupported()),
    flush: () => Promise.resolve(),
  };
}
