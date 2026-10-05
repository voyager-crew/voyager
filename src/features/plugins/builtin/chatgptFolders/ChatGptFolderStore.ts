import { ownBucket } from '@/features/folder/model/folderData';
import { FolderRepository } from '@/pages/content/folder/FolderRepository';
import { getFolderRecoveryNotice } from '@/pages/content/folder/folderRecoveryNotice';
import { AIStudioFolderStorageAdapter } from '@/pages/content/folder/storage/AIStudioFolderStorageAdapter';
import type { IFolderStorageAdapter } from '@/pages/content/folder/storage/FolderStorageAdapter';
import { createSyncMessageListener } from '@/pages/content/folder/syncMessageListener';
import type { ConversationReference, FolderData } from '@/pages/content/folder/types';
import { getTranslationSync } from '@/utils/i18n';

import { bareConversationId } from './chatgptIdentity';
import { CHATGPT_FOLDER_CONFIG } from './config';

/**
 * What a change to the folders was. `opened`: only the time a conversation was
 * opened, which the recent order reads; `activity`: only when one was last
 * sent to, which the Activity view reads. Nothing else in the data moved.
 */
export type ChatGptFolderChange = 'data' | 'opened' | 'activity';

/** Shows a storage notice: a recovered, kept, lost or unreadable load, or a failed save. */
export type ChatGptFolderNotify = (message: string, tone: 'warning' | 'error') => void;

/**
 * ChatGPT's folder data over the shared FolderRepository, which owns load,
 * recovery, serialized saves and cross-tab reloads. Edits are shared owner ops
 * that `createLegacyChatGptCommands` computes and commits through `apply`. The
 * adapter writes the folder data only to `chrome.storage.local` (despite its
 * name). The repository's recovery backups do go to chatgpt.com's localStorage,
 * under the `chatgpt-folders` backup namespace.
 */
export class ChatGptFolderStore {
  private readonly repository: FolderRepository;
  private readonly listeners = new Set<(change: ChatGptFolderChange) => void>();
  // Failed saves leave memory newer than disk; cloud merges must include those edits.
  private readonly syncMessageListener = createSyncMessageListener({
    canEdit: () => this.ready,
    data: () => this.data,
  });

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
   * Commits `next`, a snapshot computed from `data` (a shared owner op's result).
   * `change` says what it stamps, if only a time. Returns whether it changed.
   */
  apply(next: FolderData, change: ChatGptFolderChange = 'data'): boolean {
    if (!this.ready || next === this.data) return false;
    this.repository.data = next;
    void this.repository.saveData();
    this.emit(change);
    return true;
  }

  /** Persists a whole new snapshot (an import); edits are closed until it settles. */
  replaceData(data: FolderData): Promise<boolean> {
    return this.repository.replaceData(data);
  }

  private *references(): Generator<ConversationReference> {
    const contents = this.data.folderContents;
    for (const folderId of Object.keys(contents)) {
      const bucket = ownBucket(contents, folderId);
      if (bucket) yield* bucket;
    }
  }
  private emit(change: ChatGptFolderChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
