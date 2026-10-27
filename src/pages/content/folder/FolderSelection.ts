import { askConfirm } from '@/core/ui/confirm';
import type { FolderCommands } from '@/features/folder/commands/folderCommands';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { LONG_PRESS_MS, MAX_BATCH_DELETE_COUNT } from '../batchDelete/constants';
import type { FolderFeedback } from './FolderFeedback';
import type { FolderNavigation } from './FolderNavigation';
import type { FolderSidebarRuntime } from './FolderSidebarRuntime';
import type { FolderStore } from './FolderStore';
import type { TreeActions } from './floatingTree/shared';
import {
  type NativeRowSelection,
  bindNativeConversationRow,
  findConversationElement,
  setLightweightDragImage,
} from './nativeConversationDrag';
import { getNativeConversationElements } from './nativeSidebarDom';
import { isOutsideFolderSelection } from './selectionBoundaries';
import {
  SelectionToolbarHost,
  type SelectionToolbarOptions,
  flashInvalidSelection,
} from './selectionToolbar';
import { isPackagedNativeConversationRow } from './sidebarConversationQueries';
import type { ConversationReference } from './types';

export interface FolderSelectionOptions {
  store: Pick<FolderStore, 'data'>;
  commands: FolderCommands;
  /** `panel`: the folder tree's host; `sidebar`: the page's own sidebar, whose rows may join. */
  runtime: Pick<FolderSidebarRuntime, 'panel' | 'sidebar'>;
  navigation: Pick<FolderNavigation, 'highlightActiveConversation'>;
  feedback: Pick<FolderFeedback, 'showNotification'>;
  toolbar: SelectionToolbarOptions;
  /** The admitted plugin's current native selection, for dragging selected chats into folders. */
  nativeSelection?: () => NativeRowSelection | null;
  onFinishNativeDrop?: () => void;
  getContext(): {
    accountIsolationEnabled: boolean;
    isDestroyed: boolean;
  };
  /** Folder chats joined or left the selection: the tree shows them again. */
  onFolderSelectionChange(): void;
}

function debug(level: 'log' | 'warn', ...args: unknown[]): void {
  try {
    if (localStorage.getItem('gvFolderDebug') === '1') console[level]('[FolderManager]', ...args);
  } catch {
    /* Debugging must not affect interaction. */
  }
}

/** Shares selection, drag state and batch actions across native and folder rows. */
export class FolderSelection {
  private selectedConversations: Set<string> = new Set();
  private isMultiSelectMode: boolean = false;
  private multiSelectSource: 'folder' | null = null;
  private multiSelectFolderId: string | null = null;
  private longPressTimeout: number | null = null;
  /** The folder chat whose long press entered multi-select; its own release click is swallowed. */
  private longPressRow: { conversationId: string; folderId: string } | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private releaseEscape: (() => void) | null = null;
  /** Aborted when multi-select ends, which answers its open confirm with null. */
  private selectionSession = new AbortController();
  private readonly timers = new Set<number>();
  private readonly dragImages = new Set<HTMLElement>();
  private readonly toolbar: SelectionToolbarHost;
  private readonly nativeRows: NativeRowSelection;
  /** The native rows this selection made draggable, with each binding's release. */
  private readonly boundRows = new Map<HTMLElement, () => void>();
  /** Bound rows past which those Gemini dropped are released. */
  private pruneBoundRowsAt = 256;

  constructor(private readonly options: FolderSelectionOptions) {
    this.toolbar = new SelectionToolbarHost(options.toolbar);
    this.nativeRows = this.createNativeRowSelection();
  }

  private schedule(callback: () => void, delay: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.options.getContext().isDestroyed) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  private clearTimer(timer: number): void {
    window.clearTimeout(timer);
    this.timers.delete(timer);
  }

  /** Restore retained selection after the replacement panel and its rows are mounted. */
  mount(): void {
    if (this.options.getContext().isDestroyed) return;
    if (this.options.runtime.panel?.isConnected) this.removeFloatingHost();
    this.updateConversationSelectionUI();
  }

  /** Remove listeners attached to the old toolbar during a sidebar remount. */
  unmount(): void {
    this.toolbar.unmount();
  }

  removeFloatingHost(): void {
    this.toolbar.removeFloating();
  }

  reset(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    for (const image of this.dragImages) image.remove();
    this.dragImages.clear();
    if (this.longPressTimeout !== null) this.clearTimer(this.longPressTimeout);
    this.longPressTimeout = null;
    this.exitMultiSelectMode();
    this.removeFloatingHost();
  }

  createMultiSelectIndicator(): HTMLElement {
    return this.toolbar.createIndicator();
  }

  /** Lets a Gemini sidebar row join the selection and be dragged into folders. */
  makeConversationDraggable(element: HTMLElement): void {
    if (!isPackagedNativeConversationRow(element)) return;
    this.options.nativeSelection?.()?.bindRow?.(element);
    if (this.boundRows.has(element)) return;
    const release = bindNativeConversationRow(
      element,
      () => this.options.nativeSelection?.() ?? this.nativeRows,
    );
    if (!release) return;
    this.boundRows.set(element, release);
    if (this.boundRows.size < this.pruneBoundRowsAt) return;
    // Gemini replaces rows as it scrolls; a row it dropped needs no binding.
    for (const [row, releaseRow] of this.boundRows) {
      if (row.isConnected) continue;
      releaseRow();
      this.boundRows.delete(row);
    }
    this.pruneBoundRowsAt = Math.max(256, this.boundRows.size * 2);
  }

  /** Gives every native row back as it was; the folders turning off ends this selection. */
  releaseNativeRows(): void {
    for (const release of this.boundRows.values()) release();
    this.boundRows.clear();
  }

  private createNativeRowSelection(): NativeRowSelection {
    const { options } = this;
    return {
      longPressMs: LONG_PRESS_MS,
      schedule: (callback, delay) => this.schedule(callback, delay),
      clearTimer: (timer) => this.clearTimer(timer),
      isBatchDeleting: () => false,
      isMultiSelectMode: () => this.isMultiSelectMode,
      isSelected: (id) => this.selectedConversations.has(id),
      selectedIds: () => Array.from(this.selectedConversations),
      enterMultiSelect: () => {},
      toggle: (id) => this.toggleConversationSelection(id),
      selectOnly: (id) => {
        this.clearSelection();
        this.selectConversation(id);
      },
      refresh: () => this.updateConversationSelectionUI(),
      endDrag: () => {
        // If we are not in multi-select mode, clear the temporary selection
        if (this.isMultiSelectMode) return;
        this.clearSelection();
        this.cleanupSelectionArtifacts();
      },
      accountIsolationEnabled: () => options.getContext().accountIsolationEnabled,
      findConversationElement: (id) =>
        findConversationElement(id, options.runtime.panel, options.runtime.sidebar),
      setDragImage: (event, label) => this.setDragImage(event, label),
    };
  }

  private setDragImage(event: DragEvent, label: string): void {
    setLightweightDragImage(event, label, this.dragImages, (callback, delay) =>
      this.schedule(callback, delay),
    );
  }

  /** Whether multi-select still holds exactly `ids` from `source`, as when a confirm opened. */
  private holdsSelection(ids: readonly string[]): boolean {
    return (
      this.isMultiSelectMode &&
      ids.length === this.selectedConversations.size &&
      ids.every((id) => this.selectedConversations.has(id))
    );
  }

  private async batchDeleteConversations(anchor: HTMLElement): Promise<void> {
    const folderId = this.multiSelectFolderId;
    if (!folderId || this.selectedConversations.size === 0) return;
    const ids = [...this.selectedConversations];
    const answer = await askConfirm({
      message: t('folder_batch_remove_confirm').replace('{count}', String(ids.length)),
      anchor,
      tone: 'danger',
      choices: [{ id: 'remove', label: t('folder_remove_conversation_action') }],
      signal: this.selectionSession.signal,
    });
    if (answer !== 'remove' || this.options.getContext().isDestroyed) return;
    if (!this.holdsSelection(ids) || this.multiSelectFolderId !== folderId) return;

    // Remove all selected conversations from the folder
    if (!this.options.store.data.folderContents[folderId]) return;

    void this.options.commands.run({ kind: 'removeConversations', folderId, ids });

    // Exit multi-select mode and refresh
    this.exitMultiSelectMode();
    debug('log', `Batch deleted ${ids.length} conversations from folder ${folderId}`);
  }

  private clearSelection(): void {
    this.selectedConversations.clear();
  }

  private selectConversation(conversationId: string): void {
    this.selectedConversations.add(conversationId);
  }

  private toggleConversationSelection(conversationId: string): void {
    if (this.selectedConversations.has(conversationId)) {
      this.selectedConversations.delete(conversationId);

      // Auto-exit multi-select mode when all selections are cleared
      if (this.selectedConversations.size === 0 && this.isMultiSelectMode) {
        this.exitMultiSelectMode();
      }
      return;
    }
    if (this.selectedConversations.size >= MAX_BATCH_DELETE_COUNT) {
      const message = t('batch_delete_limit_reached').replace(
        '{max}',
        String(MAX_BATCH_DELETE_COUNT),
      );
      this.options.feedback.showNotification(message, 'info');
      return;
    }
    this.selectedConversations.add(conversationId);
  }

  private updateConversationSelectionUI(): void {
    // Only update UI for the source where multi-select was initiated
    if (this.multiSelectSource === 'folder') {
      this.options.onFolderSelectionChange();
    }

    // Update the selection count
    this.updateMultiSelectModeUI();
  }

  private enterMultiSelectMode(initialConversationId?: string, folderId?: string): void {
    this.options.onFinishNativeDrop?.();
    debug('log', 'Entering multi-select mode', { folderId });
    this.isMultiSelectMode = true;
    this.selectionSession.abort();
    this.selectionSession = new AbortController();
    this.multiSelectSource = 'folder';
    this.multiSelectFolderId = folderId || null;

    // Select the conversation that triggered the long-press
    if (initialConversationId) {
      this.selectConversation(initialConversationId);
    }

    this.updateMultiSelectModeUI();
    this.updateConversationSelectionUI();

    // Add visual feedback (vibration on mobile)
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    // Add click-outside listener to exit multi-select mode
    this.setupOutsideClickHandler();
    this.setupEscapeHandler();
  }

  private exitMultiSelectMode(): void {
    debug('log', 'Exiting multi-select mode');
    this.isMultiSelectMode = false;
    this.selectionSession.abort();
    this.multiSelectSource = null;
    this.multiSelectFolderId = null;
    this.removeOutsideClickHandler();
    this.removeEscapeHandler();
    // First remove the selection styles, then clear the selection set
    this.updateConversationSelectionUI();
    this.clearSelection();
    this.updateMultiSelectModeUI();
    // Force cleanup of any remaining visual artifacts
    this.cleanupSelectionArtifacts();
  }

  private setupOutsideClickHandler(): void {
    this.removeOutsideClickHandler();
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !isOutsideFolderSelection(
          target,
          this.options.runtime.sidebar,
          this.options.runtime.panel,
          this.toolbar.containsFloating(target),
        )
      ) {
        return;
      }
      debug('log', 'Click outside sidebar detected, exiting multi-select mode');
      this.exitMultiSelectMode();
    };
    this.outsideClickHandler = handler;
    // Wait a turn so the click that entered multi-select does not end it. If
    // multi-select ended meanwhile, there is no handler left to add.
    this.schedule(() => {
      if (this.outsideClickHandler) {
        document.addEventListener('click', this.outsideClickHandler, true);
      }
    }, 0);
  }

  private removeOutsideClickHandler(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler, true);
      this.outsideClickHandler = null;
    }
  }

  private setupEscapeHandler(): void {
    this.removeEscapeHandler();
    const handler = (e: Event) => {
      // A field or menu that took the Escape for itself keeps the selection.
      if (!(e instanceof KeyboardEvent) || e.key !== 'Escape') return;
      if (e.defaultPrevented || e.isComposing) return;
      this.exitMultiSelectMode();
    };
    // A shadow-root panel keeps its fields' keys from reaching the document.
    const shadow = this.options.runtime.panel?.shadowRoot;
    const targets: EventTarget[] = shadow ? [document, shadow] : [document];
    for (const target of targets) target.addEventListener('keydown', handler);
    this.releaseEscape = () => {
      for (const target of targets) target.removeEventListener('keydown', handler);
    };
  }

  private removeEscapeHandler(): void {
    this.releaseEscape?.();
    this.releaseEscape = null;
  }

  private cleanupSelectionArtifacts(): void {
    // Remove selection classes from all native conversations
    const nativeConvs = getNativeConversationElements(this.options.runtime.sidebar);
    nativeConvs.forEach((el) => {
      (el as HTMLElement).classList.remove('gv-conversation-selected');
      (el as HTMLElement).style.opacity = '1';
    });
    // Folder chats render from the selection; show them unselected.
    this.options.onFolderSelectionChange();
    // Keep the open conversation highlighted after drag-and-drop or multi-select.
    this.options.navigation.highlightActiveConversation();
  }

  private updateMultiSelectModeUI(): void {
    const source = this.multiSelectSource;
    this.toolbar.render({
      active: this.isMultiSelectMode,
      count: this.selectedConversations.size,
      source,
      onDelete: (anchor) => {
        if (source === 'folder') void this.batchDeleteConversations(anchor);
      },
      onExit: () => this.exitMultiSelectMode(),
    });
  }

  private getSelectedConversationsData(): ConversationReference[] {
    const result: ConversationReference[] = [];
    const seen = new Set<string>();
    // Collect from all folders since selection can span folders
    for (const conversations of Object.values(this.options.store.data.folderContents)) {
      for (const conv of conversations) {
        if (this.selectedConversations.has(conv.conversationId) && !seen.has(conv.conversationId)) {
          seen.add(conv.conversationId);
          result.push(conv);
        }
      }
    }
    return result;
  }

  /** The folder tree's gestures that select: long press, clicks while selecting, and drags. */
  treeActions(): Required<
    Pick<
      TreeActions,
      | 'onConversationPress'
      | 'interceptConversationClick'
      | 'onConversationDragStart'
      | 'onConversationDragEnd'
    >
  > {
    return {
      onConversationPress: (e, conversation, bucketId) =>
        this.pressFolderConversation(e, conversation.conversationId, bucketId),
      interceptConversationClick: (_e, conversation, bucketId, row) =>
        this.clickFolderConversation(conversation.conversationId, bucketId, row),
      onConversationDragStart: (e, conversation, bucketId) =>
        this.startFolderConversationDrag(
          e,
          conversation.conversationId,
          bucketId,
          conversation.title,
        ),
      onConversationDragEnd: () => this.endFolderConversationDrag(),
    };
  }

  /** Whether a folder chat shows as selected: in folder multi-select, in its scoped folder. */
  isFolderConversationSelected(conversationId: string, folderId: string): boolean {
    return (
      this.multiSelectSource === 'folder' &&
      (!this.multiSelectFolderId || this.multiSelectFolderId === folderId) &&
      this.selectedConversations.has(conversationId)
    );
  }

  /** Mouse down on a folder chat starts the long press into multi-select; `null` ends it. */
  pressFolderConversation(e: MouseEvent | null, conversationId: string, folderId: string): void {
    if (this.longPressTimeout) {
      this.clearTimer(this.longPressTimeout);
      this.longPressTimeout = null;
    }
    if (!e || e.button !== 0) return;
    this.longPressRow = null;
    this.longPressTimeout = this.schedule(() => {
      this.longPressTimeout = null;
      this.longPressRow = { conversationId, folderId };
      this.enterMultiSelectMode(conversationId, folderId);
    }, LONG_PRESS_MS);
  }

  /**
   * A click on a folder chat: the click that ends a long press, or one in
   * multi-select, which toggles the chat or refuses one from another folder.
   * Returns whether the selection took it; otherwise it navigates.
   */
  clickFolderConversation(conversationId: string, folderId: string, row: HTMLElement): boolean {
    const pressed = this.longPressRow;
    this.longPressRow = null;
    if (pressed?.conversationId === conversationId && pressed.folderId === folderId) return true;
    if (!this.isMultiSelectMode) return false;
    if (
      this.multiSelectSource === 'folder' &&
      this.multiSelectFolderId &&
      this.multiSelectFolderId !== folderId
    ) {
      flashInvalidSelection(row);
      return true;
    }
    this.toggleConversationSelection(conversationId);
    this.updateConversationSelectionUI();
    return true;
  }

  /** A folder chat drag carries every selected chat, or only itself when it is not selected. */
  startFolderConversationDrag(
    e: DragEvent,
    conversationId: string,
    folderId: string,
    title: string,
  ): void {
    e.stopPropagation();
    if (this.longPressTimeout) {
      this.clearTimer(this.longPressTimeout);
      this.longPressTimeout = null;
    }
    if (!this.selectedConversations.has(conversationId)) {
      this.clearSelection();
      this.selectConversation(conversationId);
      this.updateConversationSelectionUI();
    }
    const conversations = this.getSelectedConversationsData();
    e.dataTransfer?.setData(
      'application/json',
      JSON.stringify({ type: 'conversation', conversations, sourceFolderId: folderId }),
    );
    this.setDragImage(
      e,
      conversations.length > 1 ? `${conversations.length} conversations` : title,
    );
  }

  endFolderConversationDrag(): void {
    if (this.isMultiSelectMode) return;
    this.clearSelection();
    this.cleanupSelectionArtifacts();
  }

  /** A drop used the dragged selection. */
  finishDrop(): void {
    this.options.onFinishNativeDrop?.();
    this.exitMultiSelectMode();
  }
}
