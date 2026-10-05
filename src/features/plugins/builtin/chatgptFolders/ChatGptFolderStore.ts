import { MAX_FOLDER_DEPTH } from '@/features/folder/constants';
import { readConversationStars } from '@/features/folder/model/conversationStars';
import {
  getFolderDepth,
  moveFolder,
  ownBucket,
  removeFolder,
  reorderConversations,
  setBucket,
} from '@/features/folder/model/folderData';
import {
  type ConversationPlacement,
  placeConversations,
} from '@/features/folder/model/placeConversations';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';
import { FolderRepository } from '@/pages/content/folder/FolderRepository';
import { applyNativeTitle } from '@/pages/content/folder/conversationTitleSync';
import { getFolderRecoveryNotice } from '@/pages/content/folder/folderRecoveryNotice';
import { AIStudioFolderStorageAdapter } from '@/pages/content/folder/storage/AIStudioFolderStorageAdapter';
import type { IFolderStorageAdapter } from '@/pages/content/folder/storage/FolderStorageAdapter';
import type { ConversationReference, Folder, FolderData } from '@/pages/content/folder/types';
import { getTranslationSync } from '@/utils/i18n';

import { bareConversationId } from './chatgptIdentity';
import { CHATGPT_FOLDER_CONFIG } from './config';

/** What filing a conversation did. `missing`: the folder was deleted (say, in another tab). */
export type AddOutcome = 'added' | 'present' | 'missing' | 'closed';
/** What a drag move did. `missing`: what it moved or its target is gone. */
export type MoveOutcome = 'moved' | 'unchanged' | 'missing' | 'closed';

/**
 * What a change to the folders was. `opened`: only the time a conversation was
 * opened, which the recent order reads; `activity`: only when one was last
 * sent to, which the Activity view reads. Nothing else in the data moved.
 */
export type ChatGptFolderChange = 'data' | 'opened' | 'activity';

/** Shows a storage notice: a recovered, kept, lost or unreadable load, or a failed save. */
export type ChatGptFolderNotify = (message: string, tone: 'warning' | 'error') => void;

/**
 * ChatGPT folder commands over the shared FolderRepository, which owns load,
 * recovery, serialized saves and cross-tab reloads. The adapter writes only
 * `chrome.storage.local` (despite its name), never chatgpt.com's localStorage.
 */
export class ChatGptFolderStore {
  private readonly repository: FolderRepository;
  private readonly listeners = new Set<(change: ChatGptFolderChange) => void>();
  private readonly syncMessageListener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): true | undefined => {
    if ((message as { type?: unknown } | null)?.type !== 'gv.sync.requestData') return undefined;
    // Failed saves leave memory newer than disk; cloud merges must include those edits.
    sendResponse(this.ready ? { ok: true, data: this.data } : { ok: false });
    return true;
  };

  constructor(
    storage: IFolderStorageAdapter = new AIStudioFolderStorageAdapter(),
    notify: ChatGptFolderNotify = () => {},
  ) {
    this.repository = new FolderRepository(CHATGPT_FOLDER_CONFIG, storage, {
      // Each edit here emits as it commits. Its save's echo would announce an
      // open's stamp as a data change, which lays the tree out again.
      onChange: (reason) => {
        if (reason !== 'saved') this.emit('data');
      },
      // A lost or unreadable bucket must not look like an empty one.
      onRecovery: (result) => {
        const notice = getFolderRecoveryNotice(result);
        notify(notice.message, notice.tone);
        this.emit('data');
      },
      onExternalChange: () => void this.repository.loadData(),
      onAccountReleased: () => {},
      isEnabled: () => true,
      onSaveFailed: () => notify(getTranslationSync('folder_save_error'), 'error'),
    });
  }

  get data(): FolderData {
    return this.repository.data;
  }
  get ready(): boolean {
    return this.repository.canEdit;
  }

  async init(): Promise<void> {
    await this.repository.init();
    if (!this.repository.isDestroyed)
      chrome.runtime.onMessage.addListener(this.syncMessageListener);
  }
  destroy(): void {
    chrome.runtime.onMessage.removeListener(this.syncMessageListener);
    this.listeners.clear();
    this.repository.destroy();
  }
  subscribe(listener: (change: ChatGptFolderChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createFolder(name: string, parentId: string | null): void {
    if (parentId !== null && getFolderDepth(this.data, parentId) >= MAX_FOLDER_DEPTH) return;
    const siblings = this.data.folders.filter((folder) => folder.parentId === parentId);
    const now = Date.now();
    const folder: Folder = {
      id: `folder_${now}_${Math.random().toString(36).slice(2, 11)}`,
      name,
      parentId,
      isExpanded: true,
      sortIndex: siblings.reduce((max, f) => Math.max(max, f.sortIndex ?? -1), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.commit(() => {
      this.data.folders.push(folder);
      setBucket(this.data.folderContents, folder.id, []);
    });
  }
  renameFolder(folderId: string, name: string): void {
    this.editFolder(folderId, (folder) => (folder.name = name));
  }
  setFolderColor(folderId: string, color: string): void {
    this.editFolder(folderId, (folder) => (folder.color = color));
  }
  toggleFolderPinned(folderId: string): void {
    this.editFolder(folderId, (folder) => (folder.pinned = !folder.pinned));
  }
  toggleFolderExpanded(folderId: string): void {
    this.editFolder(folderId, (folder) => (folder.isExpanded = !folder.isExpanded));
  }
  removeFolder(folderId: string): void {
    this.commit(() => (this.repository.data = removeFolder(this.data, folderId)));
  }
  /**
   * Nests `folderId` under `parentId` (`null`: the root), at `index` among its
   * unpinned siblings or after them. Only creation is capped by depth, as on Gemini.
   */
  moveFolder(folderId: string, parentId: string | null, index?: number): MoveOutcome {
    if (!this.ready) return 'closed';
    const exists = (id: string) => this.data.folders.some((folder) => folder.id === id);
    if (!exists(folderId) || (parentId !== null && !exists(parentId))) return 'missing';
    return this.replaceIfChanged(moveFolder(this.data, folderId, parentId, Date.now(), index));
  }

  removeConversation(folderId: string, conversationId: string): void {
    const bucket = ownBucket(this.data.folderContents, folderId);
    if (!bucket) return;
    this.commit(() => {
      setBucket(
        this.data.folderContents,
        folderId,
        bucket.filter((c) => c.conversationId !== conversationId),
      );
    });
  }
  moveConversation(conversationId: string, fromFolderId: string, toFolderId: string): void {
    const conversation = ownBucket(this.data.folderContents, fromFolderId)?.find(
      (c) => c.conversationId === conversationId,
    );
    if (!conversation || !this.hasBucketOwner(toFolderId)) return;
    this.commit(() => {
      this.repository.data = placeConversations(this.data, [conversation], {
        target: toFolderId,
        placement: 'append',
        removeFrom: { bucket: fromFolderId },
        removeWhenPresent: true,
      }).data;
    });
  }
  /**
   * Moves `ids` from `from` to `index` in `target` (the same bucket reorders),
   * within their starred group as the tree shows it, as Gemini's manual order does.
   */
  reorderConversations(ids: string[], from: string, target: string, index: number): MoveOutcome {
    if (!this.ready) return 'closed';
    if (!this.hasBucketOwner(target)) return 'missing';
    const starred = readConversationStars(this.data, FOLDER_SITE_POLICIES.chatgpt);
    return this.replaceIfChanged(
      reorderConversations(this.data, ids, from, target, index, 'manual', starred),
    );
  }
  /**
   * Files `conversation` into `target` at `placement`. A picker or menu may still
   * offer a folder another tab has deleted; filing into it would leave an orphan
   * bucket that no tree shows, so that is refused.
   */
  addConversation(
    target: string,
    conversation: ConversationReference,
    placement: ConversationPlacement,
  ): AddOutcome {
    if (!this.ready) return 'closed';
    if (!this.hasBucketOwner(target)) return 'missing';
    const placed = placeConversations(this.data, [conversation], { target, placement });
    if (placed.added.length === 0) return 'present';
    this.commit(() => (this.repository.data = placed.data));
    return 'added';
  }

  /** Bare ids of every filed conversation, for one pass over the sidebar. */
  filedIds(): Set<string> {
    const ids = new Set<string>();
    for (const conversation of this.references())
      ids.add(bareConversationId(conversation.conversationId));
    return ids;
  }
  /**
   * One entry per filed reference, keyed by bucket and stored conversation id,
   * with the conversation's bare id. A key that was not here before is a new
   * reference (an add, a move or an import); a reload of the same data keeps
   * every key.
   */
  filings(): Map<string, string> {
    const filings = new Map<string, string>();
    const contents = this.data.folderContents;
    for (const bucketId of Object.keys(contents)) {
      for (const conversation of ownBucket(contents, bucketId) ?? []) {
        const key = `${bucketId}\u0000${conversation.conversationId}`;
        filings.set(key, bareConversationId(conversation.conversationId));
      }
    }
    return filings;
  }

  /**
   * Gives filed references ChatGPT's current titles, keyed by bare id. A user's
   * own title is kept. Saves only when a title actually changes.
   */
  applyNativeTitles(titles: ReadonlyMap<string, string>): boolean {
    if (!this.ready || titles.size === 0) return false;
    const changed = new Map<string, ConversationReference[]>();
    for (const conversation of this.references()) {
      const title = titles.get(bareConversationId(conversation.conversationId))?.trim();
      if (!title || conversation.customTitle || conversation.title === title) continue;
      const matches = changed.get(title);
      if (matches) matches.push(conversation);
      else changed.set(title, [conversation]);
    }
    if (changed.size === 0) return false;
    const now = Date.now();
    this.commit(() => {
      for (const [title, conversations] of changed) applyNativeTitle(conversations, title, now);
    });
    return true;
  }

  /**
   * Commits `next`, a snapshot computed from `data` (a shared owner op's result).
   * `change` says what it stamps, if only a time. Returns whether it changed.
   */
  apply(next: FolderData, change: ChatGptFolderChange = 'data'): boolean {
    if (!this.ready || next === this.data) return false;
    this.commit(() => (this.repository.data = next), change);
    return true;
  }

  /** Persists a whole new snapshot (an import); edits are closed until it settles. */
  replaceData(data: FolderData): Promise<boolean> {
    return this.repository.replaceData(data);
  }

  /** Whether `bucketId` is the root bucket or a folder that still exists. */
  private hasBucketOwner(bucketId: string): boolean {
    return (
      bucketId === CHATGPT_FOLDER_CONFIG.rootBucketId ||
      this.data.folders.some((folder) => folder.id === bucketId)
    );
  }

  private *references(): Generator<ConversationReference> {
    const contents = this.data.folderContents;
    for (const folderId of Object.keys(contents)) {
      const bucket = ownBucket(contents, folderId);
      if (bucket) yield* bucket;
    }
  }
  private editFolder(folderId: string, edit: (folder: Folder) => void): void {
    const folder = this.data.folders.find((candidate) => candidate.id === folderId);
    if (!folder) return;
    this.commit(() => {
      edit(folder);
      folder.updatedAt = Date.now();
    });
  }
  private replaceIfChanged(next: FolderData): MoveOutcome {
    return this.apply(next) ? 'moved' : 'unchanged';
  }
  private commit(mutate: () => void, change: ChatGptFolderChange = 'data'): void {
    if (!this.ready) return;
    mutate();
    void this.repository.saveData();
    this.emit(change);
  }
  private emit(change: ChatGptFolderChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
