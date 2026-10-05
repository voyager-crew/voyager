import { ownBucket } from '@/features/folder/model/folderData';
import { getTranslationSync } from '@/utils/i18n';

import { FolderRepository } from './FolderRepository';
import { getFolderRecoveryNotice } from './folderRecoveryNotice';
import type { PlatformFolderConfig } from './platformFolderConfig';
import { AIStudioFolderStorageAdapter } from './storage/AIStudioFolderStorageAdapter';
import type { IFolderStorageAdapter } from './storage/FolderStorageAdapter';
import { createSyncMessageListener } from './syncMessageListener';
import type { ConversationReference, FolderData } from './types';

/**
 * What a change to the folders was. `opened`: only the time a conversation was
 * opened, which the recent order reads; `activity`: only when one was last
 * sent to, which the Activity view reads. Nothing else in the data moved.
 */
export type SiteFolderChange = 'data' | 'opened' | 'activity';

/** Shows a storage notice: a recovered, kept, lost or unreadable load, or a failed save. */
export type SiteFolderNotify = (message: string, tone: 'warning' | 'error') => void;

/**
 * One site's folder data over the shared FolderRepository, which owns load,
 * recovery, serialized saves and cross-tab reloads. Edits are shared owner ops
 * that `createSiteFolderCommands` computes and commits through `apply`; the
 * popup's cloud sync reads the folders through the store's message listener.
 * The default adapter writes the folder data only to `chrome.storage.local`
 * (despite its name); the repository's recovery backups go to the page's
 * localStorage, under the config's backup namespace.
 */
export class SiteFolderStore {
  private readonly repository: FolderRepository;
  private readonly listeners = new Set<(change: SiteFolderChange) => void>();
  // Failed saves leave memory newer than disk; cloud merges must include those edits.
  private readonly syncMessageListener = createSyncMessageListener({
    canEdit: () => this.ready,
    data: () => this.data,
  });

  constructor(
    config: PlatformFolderConfig,
    storage: IFolderStorageAdapter = new AIStudioFolderStorageAdapter(),
    notify: SiteFolderNotify = () => {},
  ) {
    this.repository = new FolderRepository(config, storage, {
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
  subscribe(listener: (change: SiteFolderChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Commits `next`, a snapshot computed from `data` (a shared owner op's result).
   * `change` says what it stamps, if only a time. Returns whether it changed.
   */
  apply(next: FolderData, change: SiteFolderChange = 'data'): boolean {
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

  /** Every filed reference, bucket by bucket. */
  protected *references(): Generator<ConversationReference> {
    const contents = this.data.folderContents;
    for (const folderId of Object.keys(contents)) {
      const bucket = ownBucket(contents, folderId);
      if (bucket) yield* bucket;
    }
  }
  private emit(change: SiteFolderChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
