/**
 * The legacy `FolderCommands` façade (DESIGN-v2 §8.5) over a `SiteFolderStore`:
 * every edit runs the shared `applyFolderOp` on the current data and commits
 * its result, so outcomes come from the op. Edits a site's folders have no UI
 * for are refused, as is every bulk operation the site does not supply.
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
import { ownBucket } from '@/features/folder/model/folderData';
import { applyFolderOp } from '@/features/folder/owner/applyFolderOp';
import { rejected } from '@/features/folder/owner/folderOps';
import type { FolderSitePolicy } from '@/features/folder/owner/folderOwnerPolicy';

import type { SiteFolderChange, SiteFolderStore } from './SiteFolderStore';

type Kind = FolderEditBody['kind'];
type Handler<K extends Kind> = (body: OpOf<K>) => EditOutcome | Promise<EditOutcome>;
export type SiteFolderHandlers = { [K in Kind]: Handler<K> };

const unsupported = () => rejected('unsupported');

type ApplyOptions = {
  /** What the commit stamps when it is only a time. */
  change?: SiteFolderChange;
  /** The failure reported while the bucket has not loaded. */
  notReady?: FailReason;
  now?: number;
};

/** Runs a shared owner op on the store's current data and commits what it computed. */
export type SiteFolderApply = (body: OrdinaryOpBody, options?: ApplyOptions) => EditOutcome;

export type SiteFolderCommandsOptions = {
  store: SiteFolderStore;
  policy: FolderSitePolicy;
  /** The site's id for a new folder; the id a tree proposes is not used. */
  newFolderId: (now: number) => string;
  /** The site's own handling of an edit, given the shared op runner. */
  overrides?: (applyOp: SiteFolderApply) => Partial<SiteFolderHandlers>;
  runBulk?: FolderCommands['runBulk'];
};

export function createSiteFolderCommands({
  store,
  policy,
  newFolderId,
  overrides,
  runBulk = () => Promise.resolve(unsupported()),
}: SiteFolderCommandsOptions): FolderCommands {
  const recordIn = (bucket: string, id: string) =>
    ownBucket(store.data.folderContents, bucket)?.find((c) => c.conversationId === id);

  const applyOp: SiteFolderApply = (body, options = {}) => {
    if (!store.ready) return failed(options.notReady ?? 'read_only');
    const { data, outcome } = applyFolderOp(store.data, body, policy, options.now ?? Date.now());
    if (outcome.kind !== 'saved') return outcome;
    return store.apply(data, options.change) ? legacyOutcome(true) : NOOP;
  };

  /** Moves only rows still in `from`; one that is gone (moved in another tab) refuses them all. */
  const moveConversations = (ids: string[], from: string, target: string): EditOutcome => {
    if (!ids.every((id) => recordIn(from, id))) return rejected('source_missing');
    return applyOp({ kind: 'moveConversations', ids, from, target, via: 'tree-drag' });
  };

  const handlers: SiteFolderHandlers = {
    createFolder: ({ name, parentId }) => {
      const now = Date.now();
      return applyOp({ kind: 'createFolder', folderId: newFolderId(now), name, parentId }, { now });
    },
    renameFolder: (body) => applyOp(body),
    removeFolder: (body) => applyOp(body),
    setFolderColor: (body) => applyOp(body),
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
    placeAIStudioPrompt: unsupported,
    saveCurrentData: unsupported,
    ensureDefaultAIStudioFolder: unsupported,
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
    ...overrides?.(applyOp),
  };

  return {
    status: () => (store.ready ? 'ready' : 'read_only'),
    view: () => store.data,
    run: (body) => {
      const handler = handlers[body.kind] as Handler<Kind>;
      return Promise.resolve(handler(body as never));
    },
    runBulk,
    flush: () => Promise.resolve(),
  };
}
