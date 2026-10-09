import {
  type AccountScope,
  extractRouteUserIdFromPath,
} from '@/core/services/AccountIsolationService';
import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { MAX_FOLDER_DEPTH } from '@/features/folder/constants';
import { readConversationStars } from '@/features/folder/model/conversationStars';
import {
  type ConversationSortMode,
  cloneFolderData,
  getFolderDepth,
  moveFolder,
  ownBucket,
  removeFolder,
  reorderConversations,
  setBucket,
} from '@/features/folder/model/folderData';
import { placeConversations } from '@/features/folder/model/placeConversations';
import { applyFolderOp } from '@/features/folder/owner/applyFolderOp';
import { FOLDER_SITE_POLICIES } from '@/features/folder/owner/folderOwnerPolicy';

import { TimestampService } from '../timestamp/TimestampService';
import { historyTimestampStore } from '../timestamp/historyTimestamps';
import type { FolderDataSession } from './FolderDataSession';
import {
  FolderRepository,
  type FolderStoreChange,
  folderDebug,
  folderDebugWarn,
} from './FolderRepository';
import { createConversationMembershipLookup } from './conversationMembership';
import { applyNativeTitle, indexConversationsByRouteId } from './conversationTitleSync';
import {
  conversationKeys,
  isSameConversation,
  normalizeConversationId,
  resolveConversationRouteId,
} from './folderConversationIdentity';
import {
  extractConversationIdFromElement,
  extractNativeConversationId,
  getCurrentConversationId,
} from './nativeConversationIds';
import {
  extractNativeConversationTitle,
  syncConversationTitleFromNative,
} from './nativeConversationTitles';
import { getNativeConversationElements } from './nativeSidebarDom';
import { GEMINI_FOLDER_CONFIG } from './platformFolderConfig';
import {
  type IFolderStorageAdapter,
  createFolderStorageAdapter,
} from './storage/FolderStorageAdapter';
import type { ConversationReference, DragData, Folder, FolderData } from './types';

const ACTIVITY_SEND_BUTTON_SELECTOR = [
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[data-tooltip*="Send"]',
  'button[data-tooltip*="send"]',
  '[data-send-button]',
  '.send-button',
].join(', ');
const ACTIVITY_COMPOSER_INPUT_SELECTOR = [
  'rich-textarea [contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  '.input-area textarea',
  'textarea[placeholder*="Ask"]',
].join(', ');

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
}

/** Owns Gemini folder commands, title sync and activity; persistence lives in FolderRepository. */
export class FolderStore {
  private readonly repository: FolderRepository;
  private readonly conversationMembership = createConversationMembershipLookup();
  private nativeTitleSyncInProgress = false;
  private pendingTitleUpdates = new Map<string, string>();
  private activityTimestampService: TimestampService | null = null;
  private activityTrackingPromise: Promise<void> | null = null;
  private activityTimestampUnsubscribe: (() => void) | null = null;
  private activitySendIntentHandler: ((event: Event) => void) | null = null;

  constructor(
    private readonly options: FolderStoreOptions,
    storage: IFolderStorageAdapter = createFolderStorageAdapter(),
  ) {
    this.repository = new FolderRepository(GEMINI_FOLDER_CONFIG, storage, {
      onChange: (reason) => this.options.onChange(reason),
      onRecovery: (result) => result !== 'kept' && this.options.onRecovery(result), // kept: silent
      onExternalChange: () => void this.reloadFoldersFromStorage(),
      onAccountReleased: () => this.pendingTitleUpdates.clear(),
      isEnabled: () => this.options.getContext().enabled,
    });
  }

  get data(): FolderData {
    return this.repository.data;
  }
  set data(value: FolderData) {
    this.repository.data = value;
  }
  get session(): FolderDataSession | null {
    return this.repository.session;
  }
  get canEdit(): boolean {
    return this.repository.canEdit;
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
  private get isDestroyed(): boolean {
    return this.repository.isDestroyed;
  }

  init(): Promise<void> {
    return this.repository.init();
  }

  destroy(): void {
    this.repository.destroy();
    this.teardownConversationActivityTracking();
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
  replaceData(data: FolderData): Promise<boolean> {
    return this.repository.replaceData(data);
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

  createFolder(name: string, parentId: string | null = null): Folder | null {
    if (!this.canEdit) return null;
    if (parentId !== null && getFolderDepth(this.data, parentId) >= MAX_FOLDER_DEPTH) return null;
    const maxSortIndex = this.data.folders
      .filter((folder) => folder.parentId === parentId)
      .reduce((max, folder) => Math.max(max, folder.sortIndex ?? -1), -1);
    const folder: Folder = {
      id: this.generateId(),
      name,
      parentId,
      isExpanded: true,
      sortIndex: maxSortIndex + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.folders.push(folder);
    setBucket(this.data.folderContents, folder.id, []);
    void this.saveData();
    this.options.onChange('data');
    return folder;
  }

  renameFolder(folderId: string, name: string): void {
    if (!this.canEdit) return;
    const folder = this.data.folders.find((item) => item.id === folderId);
    if (!folder || folder.name === name) return;
    folder.name = name;
    folder.updatedAt = Date.now();
    void this.saveData();
    this.options.onChange('data');
  }

  removeFolder(folderId: string): void {
    if (!this.canEdit) return;
    this.data = removeFolder(this.data, folderId);
    void this.saveData();
    this.options.onChange('data');
  }

  removeConversationsFromFolder(folderId: string, ids: ReadonlySet<string>): void {
    if (!this.canEdit) return;
    const conversations = ownBucket(this.data.folderContents, folderId);
    if (!conversations) return;
    setBucket(
      this.data.folderContents,
      folderId,
      conversations.filter((item) => !ids.has(item.conversationId)),
    );
    void this.saveData();
    this.options.onChange('data');
  }

  async setFolderInstructions(
    folderId: string,
    instructions: string | undefined,
  ): Promise<boolean> {
    if (!this.canEdit) return false;
    const data = cloneFolderData(this.data);
    const folder = data.folders.find((item) => item.id === folderId);
    if (!folder) return false;
    folder.instructions = instructions;
    folder.updatedAt = Date.now();
    return this.replaceData(data);
  }

  bufferTitleUpdate(conversation: ConversationReference, title: string): void {
    if (!this.canEdit) return;
    conversation.title = title;
    this.pendingTitleUpdates.set(conversation.conversationId, title);
  }

  flushTitleUpdates(): void {
    if (this.pendingTitleUpdates.size === 0) return;
    const session = this.repository.session;
    const activation = this.repository.activation;
    void this.saveData()
      .then((saved) => {
        if (
          saved &&
          this.repository.session === session &&
          this.repository.activation === activation
        )
          this.pendingTitleUpdates.clear();
      })
      .catch((error) =>
        console.error('[FolderStore] Failed to save pending title updates:', error),
      );
  }

  hasStoredConversations(): boolean {
    return Object.values(this.data.folderContents).some(
      (conversations) => conversations.length > 0,
    );
  }

  toggleFolder(folderId: string): void {
    if (!this.canEdit) return;
    const folder = this.data.folders.find((f) => f.id === folderId);
    if (!folder) return;

    folder.isExpanded = !folder.isExpanded;
    folder.updatedAt = Date.now();
    // Pure UI state — debounce the full persistence pipeline instead of
    // running stringify/verify/mirror/backup on every expand/collapse click.
    this.scheduleSaveData();
    this.options.onChange('data');
  }

  togglePinFolder(folderId: string): void {
    if (!this.canEdit) return;
    const folder = this.data.folders.find((f) => f.id === folderId);
    if (!folder) return;

    folder.pinned = !folder.pinned;
    folder.updatedAt = Date.now();
    this.saveData();
    this.options.onChange('data');
  }

  reorderFolder(folderId: string, targetParentId: string, insertIndex: number): void {
    if (!this.canEdit) return;
    const targetParent = targetParentId === '__root__' ? null : targetParentId;
    const nextData = moveFolder(this.data, folderId, targetParent, Date.now(), insertIndex);
    if (nextData === this.data) return;
    this.data = nextData;
    void this.saveData();
    this.options.onChange('data');
  }

  ensureConversationsInFolder(folderId: string, dragData: DragData): void {
    if (!this.canEdit) return;
    const items = dragData.conversations?.length
      ? dragData.conversations
      : dragData.conversationId
        ? [{ ...dragData, conversationId: dragData.conversationId }]
        : [];
    const records = this.withConversationStars(
      items.map((item) => this.buildDroppedConversation(item)),
    );
    this.data = placeConversations(this.data, records, {
      target: folderId,
      placement: 'append',
      keysOf: conversationKeys,
    }).data;
  }

  /** A conversation dropped from outside a folder, before placement assigns its sortIndex. */
  private buildDroppedConversation(
    item: Pick<ConversationReference, 'conversationId' | 'title' | 'isGem' | 'gemId'> & {
      url?: string;
    },
  ): ConversationReference {
    return {
      conversationId: item.conversationId,
      title: this.resolveDraggedConversationTitleForStorage(item.conversationId, item.title),
      url: item.url ?? '',
      addedAt: Date.now(),
      lastTurnAt: this.getKnownConversationLastTurnAt(item.conversationId, item.url),
      isGem: item.isGem,
      gemId: item.gemId,
    };
  }

  private resolveDraggedConversationTitleForStorage(conversationId: string, title: string): string {
    const normalizedTitle = title.trim();
    if (normalizedTitle && normalizedTitle !== 'Untitled') return normalizedTitle;

    return syncConversationTitleFromNative(conversationId) || normalizedTitle || 'Untitled';
  }

  /** A star is the conversation's: a new record of a chat starred in another folder keeps it. */
  private withConversationStars(records: ConversationReference[]): ConversationReference[] {
    const starred = readConversationStars(this.data, FOLDER_SITE_POLICIES.gemini);
    return records.map((record) =>
      !record.starred && starred(record) ? { ...record, starred: true } : record,
    );
  }

  reorderOrMoveConversations(
    conversationIds: string[],
    sourceParentId: string,
    targetParentId: string,
    insertIndex: number,
  ): void {
    if (!this.canEdit) return;
    const nextData = reorderConversations(
      this.data,
      conversationIds,
      sourceParentId,
      targetParentId,
      insertIndex,
      this.options.getContext().sortMode,
      // The groups the tree drew: a row shows starred when any copy of its chat is.
      readConversationStars(this.data, FOLDER_SITE_POLICIES.gemini),
    );
    if (nextData === this.data) return;
    this.data = nextData;
    void this.saveData();
    this.options.onChange('data');
  }

  addConversationToFolder(
    folderId: string,
    dragData: DragData & { sourceFolderId?: string },
  ): void {
    if (!this.canEdit) return;
    const conversationId = dragData.conversationId;
    if (!conversationId) return;
    const sourceFolderId =
      dragData.sourceFolderId !== folderId ? dragData.sourceFolderId : undefined;
    const { data, added } = placeConversations(
      this.data,
      this.withConversationStars([this.buildDroppedConversation({ ...dragData, conversationId })]),
      {
        target: folderId,
        placement: 'append',
        keysOf: conversationKeys,
        removeFrom: sourceFolderId ? { bucket: sourceFolderId } : undefined,
      },
    );
    if (added.length === 0) {
      folderDebug('Conversation already in folder:', conversationId);
      return;
    }

    this.data = data;
    this.saveData();
    this.options.onChange('data');
    // Folder→folder move is not a "first archive"; skip the nudge.
    if (!sourceFolderId) this.options.onArchive();
  }

  addConversationsToFolder(
    folderId: string,
    conversations: ConversationReference[],
    sourceFolderId?: string,
  ): void {
    if (!this.canEdit) return;
    folderDebug('Adding multiple conversations to folder:', {
      folderId,
      count: conversations.length,
      sourceFolderId,
    });

    const records = this.withConversationStars(
      conversations.map((conv) => ({
        ...conv,
        title: sourceFolderId
          ? conv.title
          : this.resolveDraggedConversationTitleForStorage(conv.conversationId, conv.title),
        addedAt: Date.now(),
        lastTurnAt:
          conv.lastTurnAt ?? this.getKnownConversationLastTurnAt(conv.conversationId, conv.url),
      })),
    );
    const { data, added } = placeConversations(this.data, records, {
      target: folderId,
      placement: 'append',
      keysOf: conversationKeys,
      // Ids the target already held stay in the source.
      removeFrom:
        sourceFolderId && sourceFolderId !== folderId ? { bucket: sourceFolderId } : undefined,
    });
    this.data = data;
    folderDebug(`Added ${added.length} conversations to ${folderId}`);

    this.saveData();
    this.options.onChange('data');
    // A batch from another folder is a folder→folder move, not a "first archive".
    if (added.length > 0 && !sourceFolderId) {
      this.options.onArchive();
    }
  }

  addFolderToFolder(targetFolderId: string, dragData: DragData): void {
    if (!this.canEdit) return;
    const draggedFolderId = dragData.folderId;
    if (!draggedFolderId) return;

    folderDebug('Moving folder to folder:', {
      draggedFolderId,
      targetFolderId,
    });

    const nextData = moveFolder(this.data, draggedFolderId, targetFolderId, Date.now());
    if (nextData === this.data) {
      folderDebug('Folder move rejected');
      return;
    }
    this.data = nextData;
    void this.saveData();
    this.options.onChange('data');
  }

  moveFolderToRoot(dragData: DragData): void {
    if (!this.canEdit) return;
    const draggedFolderId = dragData.folderId;
    if (!draggedFolderId) return;

    folderDebug('Moving folder to root level:', draggedFolderId);

    const nextData = moveFolder(this.data, draggedFolderId, null, Date.now());
    if (nextData === this.data) {
      folderDebug('Folder move to root rejected');
      return;
    }
    this.data = nextData;
    void this.saveData();
    this.options.onChange('data');
  }

  toggleConversationStar(folderId: string, conversationId: string): void {
    if (!this.canEdit) return;
    const conversations = this.data.folderContents[folderId];
    if (!conversations) return;

    const conv = conversations.find((c) => c.conversationId === conversationId);
    if (!conv) return;

    // Toggle starred state
    conv.starred = !conv.starred;

    // Save data
    this.saveData();

    // Refresh the folder UI to update the star icon and re-sort
    this.options.onChange('data');

    folderDebug('Toggled star for conversation:', conversationId, 'starred:', conv.starred);
  }

  setConversationStarAcrossFolders(conversationId: string, starred: boolean): void {
    if (!this.canEdit) return;
    let changed = false;
    Object.values(this.data.folderContents).forEach((conversations) => {
      conversations.forEach((conversation) => {
        if (!isSameConversation(conversationId, conversation)) return;
        if (conversation.starred === starred) return;
        conversation.starred = starred;
        changed = true;
      });
    });

    if (!changed) return;
    this.saveData();
    this.options.onChange('data');
  }

  removeConversationFromFolder(folderId: string, conversationId: string): void {
    if (!this.canEdit) return;
    const conversations = ownBucket(this.data.folderContents, folderId);
    if (!conversations) return;
    setBucket(
      this.data.folderContents,
      folderId,
      conversations.filter((c) => c.conversationId !== conversationId),
    );

    this.saveData();
    this.options.onChange('data');
  }

  changeFolderColor(folderId: string, colorId: string): void {
    if (!this.canEdit) return;
    const folder = this.data.folders.find((f) => f.id === folderId);
    if (!folder) return;

    folder.color = colorId;
    folder.updatedAt = Date.now();

    this.saveData();
    this.options.onChange('data');
  }

  moveConversationToFolder(
    sourceFolderId: string,
    targetFolderId: string,
    conv: ConversationReference,
  ): void {
    if (!this.canEdit) return;
    // The record goes after the target's last row, like a drop, and leaves the
    // source even when the target already holds it.
    this.data = placeConversations(this.data, [{ ...conv, addedAt: Date.now() }], {
      target: targetFolderId,
      placement: 'append',
      keysOf: conversationKeys,
      removeFrom: { bucket: sourceFolderId },
      removeWhenPresent: true,
    }).data;
    this.saveData();
    this.options.onChange('data');
  }

  addConversationToFolderFromNative(
    folderId: string,
    conversationId: string,
    title: string,
    url: string,
    isGem?: boolean,
    gemId?: string,
    lastTurnAt?: number,
  ): void {
    if (!this.canEdit) return;
    // Guard: ensure the target folder still exists (it may have been deleted
    // from the sidebar or another tab between selection and message send)
    const folderExists = this.data.folders.some((f) => f.id === folderId);
    if (!folderExists) return;

    const now = Date.now();
    const record: ConversationReference = {
      conversationId,
      title,
      url,
      addedAt: now,
      lastOpenedAt: now,
      lastTurnAt: lastTurnAt ?? this.getKnownConversationLastTurnAt(conversationId, url),
      isGem,
      gemId,
    };
    const { data, added } = placeConversations(this.data, this.withConversationStars([record]), {
      target: folderId,
      placement: 'top',
      keysOf: conversationKeys,
    });
    this.data = data;

    this.saveData();
    this.options.onChange('data');
    if (added.length > 0) {
      this.options.onArchive();
    }
  }

  async ensureDataLoaded(): Promise<void> {
    if (this.data.folders.length === 0) {
      await this.loadData();
    }
  }

  private applyConversationTitleUpdate(conversationId: string, newTitle: string): boolean {
    if (!this.canEdit) return false;
    const matches = Object.values(this.data.folderContents)
      .flat()
      .filter((conv) => isSameConversation(conversationId, conv));
    return applyNativeTitle(matches, newTitle, Date.now());
  }

  async syncConversationTitlesFromNative(): Promise<void> {
    if (this.nativeTitleSyncInProgress) return;
    if (!this.hasStoredConversations() || !this.canEdit) return;

    this.nativeTitleSyncInProgress = true;
    try {
      let updated = false;
      // One index per pass: O(stored + rows + matches); see indexConversationsByRouteId.
      const index = indexConversationsByRouteId(this.data.folderContents);
      const conversations = getNativeConversationElements(this.options.getContext().sidebar);

      for (const convEl of Array.from(conversations)) {
        const element = convEl as HTMLElement;
        const conversationId =
          extractNativeConversationId(element) || extractConversationIdFromElement(element);
        const matches = index.get(normalizeConversationId(conversationId) ?? '');
        if (!matches) continue;
        const title = extractNativeConversationTitle(element);
        if (!title) continue;

        updated = applyNativeTitle(matches, title, Date.now()) || updated;
      }

      if (!updated) return;

      await this.saveData();
      this.options.onChange('title');
    } finally {
      this.nativeTitleSyncInProgress = false;
    }
  }

  updateConversationTitle(conversationId: string, newTitle: string): void {
    if (!this.applyConversationTitleUpdate(conversationId, newTitle)) return;

    void this.saveData();
    // Re-render folders to show updated title
    this.options.onChange('title');
  }

  async restoreNativeTitleSync(conversationId: string, nativeTitle: string | null): Promise<void> {
    if (!this.canEdit) return;
    const title = nativeTitle?.trim() || null;
    const updatedAt = Date.now();
    let updated = false;

    for (const folderId in this.data.folderContents) {
      for (const conversation of this.data.folderContents[folderId]) {
        if (!isSameConversation(conversationId, conversation)) continue;

        if (conversation.customTitle) {
          delete conversation.customTitle;
          updated = true;
        }

        if (title && conversation.title !== title) {
          conversation.title = title;
          conversation.updatedAt = updatedAt;
          updated = true;
        }
      }
    }

    if (!updated) return;

    await this.saveData();
    this.options.onChange('title');
  }

  removeConversationFromAllFolders(conversationId: string): void {
    if (!this.canEdit) return;
    // Remove this conversation from all folders when the original conversation is deleted
    let removed = false;

    for (const folderId in this.data.folderContents) {
      const conversations = this.data.folderContents[folderId];
      const initialLength = conversations.length;

      // Filter out the deleted conversation
      setBucket(
        this.data.folderContents,
        folderId,
        conversations.filter((conv) => !isSameConversation(conversationId, conv)),
      );

      if (this.data.folderContents[folderId].length < initialLength) {
        removed = true;
        folderDebug(`Removed deleted conversation ${conversationId} from folder ${folderId}`);
      }
    }

    if (removed) {
      this.saveData();
      // Re-render folders to reflect the removal
      this.options.onChange('title');
    }
  }

  initializeConversationActivityTracking(): Promise<void> {
    if (this.activityTimestampUnsubscribe || this.activitySendIntentHandler) {
      return Promise.resolve();
    }
    if (this.activityTrackingPromise) return this.activityTrackingPromise;

    this.activityTrackingPromise = (async () => {
      try {
        if (!this.activityTimestampService) {
          this.activityTimestampService = new TimestampService();
          await this.activityTimestampService.initialize();
        }
        await historyTimestampStore.start();
        if (this.isDestroyed || !this.options.getContext().enabled) return;

        this.backfillKnownConversationActivity();
        this.activityTimestampUnsubscribe = historyTimestampStore.subscribe((cids) => {
          if (this.isDestroyed || !this.options.getContext().enabled) return;
          this.applyHistoryActivityTimestamps(cids);
        });

        this.activitySendIntentHandler = (event) => {
          if (!this.isConversationSendIntent(event)) return;
          const conversationId = getCurrentConversationId();
          if (!conversationId || !this.isConversationInFolders(conversationId)) return;

          const sentAt = Date.now();
          window.setTimeout(() => {
            if (this.isDestroyed || !this.options.getContext().enabled || event.defaultPrevented)
              return;
            this.markConversationLastTurnAt(conversationId, sentAt);
          }, 0);
        };
        document.addEventListener('click', this.activitySendIntentHandler, true);
        document.addEventListener('submit', this.activitySendIntentHandler, true);
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          folderDebugWarn('Failed to initialize conversation activity tracking:', error);
        }
      }
    })().finally(() => {
      this.activityTrackingPromise = null;
    });

    return this.activityTrackingPromise;
  }

  teardownConversationActivityTracking(): void {
    this.activityTimestampUnsubscribe?.();
    this.activityTimestampUnsubscribe = null;

    if (this.activitySendIntentHandler) {
      document.removeEventListener('click', this.activitySendIntentHandler, true);
      document.removeEventListener('submit', this.activitySendIntentHandler, true);
      this.activitySendIntentHandler = null;
    }
  }

  private isConversationSendIntent(event: Event): boolean {
    if (event.type === 'submit') {
      const form = event.target;
      return (
        form instanceof HTMLFormElement &&
        form.querySelector(ACTIVITY_COMPOSER_INPUT_SELECTOR) !== null
      );
    }

    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(ACTIVITY_SEND_BUTTON_SELECTOR);
    if (!(button instanceof HTMLElement)) return false;
    if (
      button instanceof HTMLButtonElement &&
      (button.disabled || button.getAttribute('aria-disabled') === 'true')
    ) {
      return false;
    }

    const composer = button.closest(
      'form, .text-input-field, input-area-v2, input-container, ms-prompt-input-wrapper',
    );
    return composer?.querySelector(ACTIVITY_COMPOSER_INPUT_SELECTOR) !== null;
  }

  getKnownConversationLastTurnAt(conversationId: string, url?: string): number | undefined {
    const nativeConversationId = normalizeConversationId(conversationId);
    if (!nativeConversationId) return undefined;

    // An imported record may keep a synthetic id; Gemini's history reports its route id.
    const routeId = resolveConversationRouteId(url, conversationId);
    const serverTimestamp = Math.max(
      ...[nativeConversationId, routeId].map((id) =>
        id ? (historyTimestampStore.getLatestTurnTimestamp(id) ?? 0) : 0,
      ),
    );
    const stableConversationId = buildConversationIdFromUrl(
      url || `https://gemini.google.com/app/${nativeConversationId}`,
    );
    const storedTimestamp =
      this.activityTimestampService?.getLatestTimestampForConversation(stableConversationId) ??
      undefined;
    const latest = Math.max(serverTimestamp, storedTimestamp ?? 0);
    return latest > 0 ? latest : undefined;
  }

  backfillKnownConversationActivity(): void {
    this.applyConversationActivity(
      Object.values(this.data.folderContents)
        .flat()
        .map(({ conversationId, url }) => ({
          conversationId,
          lastTurnAt: this.getKnownConversationLastTurnAt(conversationId, url) ?? 0,
        })),
    );
  }

  applyHistoryActivityTimestamps(cids: string[]): void {
    this.applyConversationActivity(
      cids.map((cid) => {
        const conversationId = normalizeConversationId(cid) ?? '';
        const lastTurnAt = conversationId
          ? historyTimestampStore.getLatestTurnTimestamp(conversationId)
          : null;
        return { conversationId, lastTurnAt: lastTurnAt ?? 0 };
      }),
    );
  }

  markConversationLastTurnAt(conversationId: string, timestamp: number): void {
    this.applyConversationActivity([{ conversationId, lastTurnAt: timestamp }]);
  }

  /** Raises `lastTurnAt` on every record each entry's id or saved route names, as the op does. */
  private applyConversationActivity(
    entries: Array<{ conversationId: string; lastTurnAt: number }>,
  ): void {
    if (!this.canEdit) return;
    const known = entries.filter((entry) => entry.conversationId && entry.lastTurnAt > 0);
    if (known.length === 0) return;
    const { data, outcome } = applyFolderOp(
      this.data,
      { kind: 'setConversationActivity', entries: known },
      FOLDER_SITE_POLICIES.gemini,
      Date.now(),
    );
    if (outcome.kind !== 'saved') return;
    this.data = data;
    this.scheduleSaveData();
    this.options.onChange('activity');
  }

  async reloadFoldersFromStorage(): Promise<void> {
    try {
      await this.loadData();
      this.backfillKnownConversationActivity();
      this.options.onChange('title');
      folderDebug('Folders reloaded from storage');
    } catch (error) {
      console.error('[FolderStore] Failed to reload folders:', error);
    }
  }

  /** `revision`: one token per pass over native rows that runs no folder edit; see the lookup. */
  isConversationInFolders(conversationId: string, revision?: object): boolean {
    return this.conversationMembership(this.data.folderContents, revision).has(conversationId);
  }

  private generateId(): string {
    return `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  markConversationAsRecentlyOpened(conversationId: string): void {
    if (!this.canEdit) return;
    const now = Date.now();
    let changed = false;

    for (const folderId in this.data.folderContents) {
      const conversations = this.data.folderContents[folderId];
      conversations.forEach((conversation) => {
        if (!isSameConversation(conversationId, conversation)) return;

        // De-duplicate near-simultaneous route/listener updates.
        if (conversation.lastOpenedAt && now - conversation.lastOpenedAt < 1000) return;

        conversation.lastOpenedAt = now;
        conversation.updatedAt = now;
        changed = true;
      });
    }

    if (!changed) return;

    // Keep the visible row stable during navigation; the saved time affects
    // the next natural render. Debounced: rapid navigation shouldn't run the
    // full save pipeline per click.
    this.scheduleSaveData();
  }

  updateConversationGem(hexId: string, gemId: string): void {
    if (!this.canEdit) return;
    // Update all instances of this conversation in folders
    let updated = false;

    for (const folderId in this.data.folderContents) {
      const conversations = this.data.folderContents[folderId];
      for (const conv of conversations) {
        // Match by hex ID in URL
        if (conv.url.includes(hexId)) {
          const oldUrl = conv.url;
          conv.isGem = true;
          conv.gemId = gemId;
          // Update URL to use /gem/ instead of /app/
          conv.url = conv.url.replace(/\/app\/([^/?]+)/, `/gem/${gemId}/$1`);
          updated = true;
          folderDebug('Updated conversation:', conv.title);
          folderDebug('Old URL:', oldUrl);
          folderDebug('New URL:', conv.url);
          folderDebug('Gem ID:', gemId);
        }
      }
    }

    if (updated) {
      this.saveData();
      // Re-render folders to show correct icon
      this.options.onChange('title');
    }
  }

  async reloadScopedDataOnAccountRouteChange(): Promise<void> {
    if (!this.accountIsolationEnabled) return;

    const routeUserId = extractRouteUserIdFromPath(window.location.pathname);
    if (routeUserId === this.accountScope?.routeUserId) return;

    const previousStorageKey = this.storageKey;
    await this.refreshAccountScope();
    if (this.storageKey === previousStorageKey) return;

    await this.loadData();
    this.backfillKnownConversationActivity();
    this.options.onChange('title');
    folderDebug('Switched account-scoped folder storage:', this.storageKey);
  }
}
