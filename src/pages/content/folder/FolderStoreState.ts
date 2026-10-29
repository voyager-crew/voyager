/**
 * Gemini's folder store, persistence half: the repository on Gemini's bucket
 * and what it says about the data, its session and the bound account.
 * `FolderStore` adds the edits on top.
 */
import type { AccountContext, AccountScope } from '@/core/services/AccountIsolationService';
import type { ConversationSortMode } from '@/features/folder/model/folderData';

import type { FolderDataSession } from './FolderDataSession';
import { FolderRepository, type FolderStoreChange } from './FolderRepository';
import { createConversationMembershipLookup } from './conversationMembership';
import { GEMINI_FOLDER_CONFIG } from './platformFolderConfig';
import {
  type FolderWriteReceipt,
  type IFolderStorageAdapter,
  createFolderStorageAdapter,
} from './storage/FolderStorageAdapter';
import type { FolderData } from './types';

export type { FolderStoreChange };

export interface FolderStoreOptions {
  getContext: () => {
    sidebar: HTMLElement | null;
    sortMode: ConversationSortMode;
    enabled: boolean;
  };
  onChange: (reason: FolderStoreChange) => void;
  onArchive: () => void;
  onRecovery: (result: 'recovered' | 'lost' | 'unreadable') => void;
  /** A session was bound for `context` (`null` while isolation is off). */
  onAccountBound?: (context: AccountContext | null) => void;
  /**
   * The owner's account gate: while it is false no edit runs, so nothing this
   * page shows of another account is ever written. Open when omitted.
   */
  accountMatchesPage?: () => boolean;
  /** With isolation on, whether the page's account is known enough to bind (see the repository hook). */
  canBindAccount?: () => boolean;
}

export abstract class FolderStoreState {
  protected readonly repository: FolderRepository;
  private readonly conversationMembership = createConversationMembershipLookup();

  constructor(
    protected readonly options: FolderStoreOptions,
    storage: IFolderStorageAdapter = createFolderStorageAdapter(),
  ) {
    this.repository = new FolderRepository(GEMINI_FOLDER_CONFIG, storage, {
      onChange: (reason) => this.options.onChange(reason),
      onRecovery: (result) => result !== 'kept' && this.options.onRecovery(result), // kept: silent
      onExternalChange: () => void this.reloadFoldersFromStorage(),
      onAccountReleased: () => this.accountReleased(),
      isEnabled: () => this.options.getContext().enabled,
      onAccountBound: (context) => this.options.onAccountBound?.(context),
      canBindAccount: () => this.options.canBindAccount?.() ?? true,
    });
  }

  /** Another context wrote the active bucket, or a failed read is retried. */
  abstract reloadFoldersFromStorage(): Promise<void>;
  /** The bound account was released; runs before its `account` change. */
  protected abstract accountReleased(): void;

  get data(): FolderData {
    return this.repository.data;
  }
  set data(value: FolderData) {
    this.repository.data = value;
  }
  get session(): FolderDataSession | null {
    return this.repository.session;
  }
  /** False while the owner's account gate is closed, whatever the repository says. */
  get canEdit(): boolean {
    return this.repository.canEdit && (this.options.accountMatchesPage?.() ?? true);
  }
  get activation(): number {
    return this.repository.activation;
  }
  get storageKey(): string {
    return this.repository.storageKey;
  }
  get accountScope(): AccountScope | null {
    return this.repository.accountScope;
  }
  get accountIsolationEnabled(): boolean {
    return this.repository.accountIsolationEnabled;
  }
  protected get isDestroyed(): boolean {
    return this.repository.isDestroyed;
  }

  init(): Promise<void> {
    return this.repository.init();
  }

  setAccountIsolationEnabled(enabled: boolean): Promise<void> {
    return this.repository.setAccountIsolationEnabled(enabled);
  }

  loadData(): Promise<void> {
    return this.repository.loadData();
  }

  saveData(): Promise<boolean> {
    return this.repository.saveData();
  }

  /** Persist a draft without exposing it to edits, exports or recovery before success. */
  replaceData(data: FolderData, beforeWrite?: FolderWriteReceipt): Promise<boolean> {
    return this.repository.replaceData(data, undefined, beforeWrite);
  }

  scheduleSaveData(): void {
    this.repository.scheduleSaveData();
  }

  flushPendingSaveData(): void {
    this.repository.flushPendingSaveData();
  }

  refreshAccountScope(): Promise<void> {
    return this.repository.refreshAccountScope();
  }

  async ensureDataLoaded(): Promise<void> {
    if (this.data.folders.length === 0) {
      await this.loadData();
    }
  }

  hasStoredConversations(): boolean {
    return Object.values(this.data.folderContents).some(
      (conversations) => conversations.length > 0,
    );
  }

  /** `revision`: one token per pass over native rows that runs no folder edit; see the lookup. */
  isConversationInFolders(conversationId: string, revision?: object): boolean {
    return this.conversationMembership(this.data.folderContents, revision).has(conversationId);
  }
}
