import { ownBucket } from '@/features/folder/model/folderData';
import { SiteFolderStore, type SiteFolderNotify } from '@/pages/content/folder/SiteFolderStore';
import type { IFolderStorageAdapter } from '@/pages/content/folder/storage/FolderStorageAdapter';

import { bareConversationId } from './chatgptIdentity';
import { CHATGPT_FOLDER_CONFIG } from './config';

/**
 * ChatGPT's folder bucket on the shared site store, plus the reads ChatGPT's
 * sidebar makes by bare conversation id. Its recovery backups use the
 * `chatgpt-folders` namespace in chatgpt.com's localStorage.
 */
export class ChatGptFolderStore extends SiteFolderStore {
  constructor(storage?: IFolderStorageAdapter, notify?: SiteFolderNotify) {
    super(CHATGPT_FOLDER_CONFIG, storage, notify);
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
}
