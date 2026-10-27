import { getNativeConversationElements } from './nativeSidebarDom';
import { readCompleteNativeConversationRows } from './sidebarConversationQueries';
import { readNativeSidebarMutations } from './sidebarMutationQueries';

export interface NativeSidebarObserverCallbacks {
  isDestroyed: () => boolean;
  /** `pass` is one token per drain: every row of a drain shares it, and the drain edits no folder. */
  enhanceConversation: (row: HTMLElement, pass: object) => void;
  hasStoredConversations: () => boolean;
  onTitlesChanged: () => void | Promise<void>;
}

const NATIVE_TITLE_SYNC_DEBOUNCE_MS = 300;
const ENHANCEMENT_IDLE_BUDGET_MS = 8;
const ENHANCEMENT_IDLE_TIMEOUT_MS = 500;

/** Owns observation and budgeted enhancement work for Gemini's native conversation rows. */
export class NativeSidebarObserver {
  private conversationObserver: MutationObserver | null = null;

  // Batched mutation processing for the sidebar observer. Gemini emits a
  // burst of mutations every time the user clicks a conversation row (it
  // re-renders rows to update active state). Doing per-element setup work
  // synchronously inside the observer callback caused noticeable click
  // jank — issue #678. We now coalesce mutations to the next animation frame
  // and dedupe by element/conversationId before doing any work.
  private mutationBatchQueue: MutationRecord[] = [];

  private mutationFlushScheduled: boolean = false;

  private mutationFlushRafId: number | null = null;

  // Per-row enhancement work (drag listeners, hide-archived state) for added
  // conversations is drained from this queue during idle time instead of the
  // sidebar-open animation frame — a burst can add every Recents row at once
  // and this work is allowed to lag behind paint (issue #753).
  private enhancementQueue: Set<HTMLElement> = new Set();

  private enhancementDrainIdleId: number | null = null;

  private nativeTitleSyncTimer: number | null = null;

  constructor(private readonly callbacks: NativeSidebarObserverCallbacks) {}

  /** Pause observation for a sidebar remount without discarding already queued work. */
  disconnect(): void {
    this.conversationObserver?.disconnect();
    this.conversationObserver = null;
  }

  /** End the mounted folder runtime, including its delayed enhancement and title work. */
  stop(): void {
    this.disconnect();
    this.cancelMutationBatchFlush();
    this.mutationBatchQueue = [];
    this.cancelEnhancementDrain();
    this.clearTitleSync();
  }

  observe(sidebar: HTMLElement): void {
    this.disconnect();

    this.conversationObserver = new MutationObserver((mutations) => {
      // Coalesce mutations to the next animation frame instead of processing
      // them synchronously. Synchronous processing caused sidebar-click
      // jank — see issue #678. Flush is implemented in `flushMutationBatch`.
      for (const mutation of mutations) this.mutationBatchQueue.push(mutation);
      this.scheduleMutationBatchFlush();
    });

    this.conversationObserver.observe(sidebar, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'href', 'title'],
    });
  }

  enqueueConversations(root: ParentNode): void {
    // Full sweeps (init, reinit, recovery) go through the same budgeted
    // drain as observer bursts so a large Recents list never blocks one
    // frame for the whole sweep (issue #753).
    const conversations =
      root instanceof HTMLElement
        ? getNativeConversationElements(root)
        : readCompleteNativeConversationRows(
            () => root,
            () => root,
          );
    conversations.forEach((conv) => {
      this.enhancementQueue.add(conv as HTMLElement);
    });
    this.scheduleEnhancementDrain();
  }

  private scheduleMutationBatchFlush(): void {
    if (this.mutationFlushScheduled) return;
    this.mutationFlushScheduled = true;
    this.mutationFlushRafId = window.requestAnimationFrame(() => {
      this.mutationFlushRafId = null;
      this.mutationFlushScheduled = false;
      if (this.callbacks.isDestroyed()) {
        this.mutationBatchQueue.length = 0;
        return;
      }
      this.flushMutationBatch();
    });
  }

  private cancelMutationBatchFlush(): void {
    if (this.mutationFlushRafId !== null) {
      window.cancelAnimationFrame(this.mutationFlushRafId);
      this.mutationFlushRafId = null;
    }
    this.mutationFlushScheduled = false;
  }

  private scheduleEnhancementDrain(): void {
    if (this.enhancementQueue.size === 0) return;
    if (this.enhancementDrainIdleId !== null) return;

    const drain = (deadline?: IdleDeadline) => {
      this.enhancementDrainIdleId = null;
      if (this.callbacks.isDestroyed()) {
        this.enhancementQueue.clear();
        return;
      }
      this.drainEnhancementQueue(deadline);
    };

    if (typeof window.requestIdleCallback === 'function') {
      this.enhancementDrainIdleId = window.requestIdleCallback(drain, {
        timeout: ENHANCEMENT_IDLE_TIMEOUT_MS,
      });
    } else {
      this.enhancementDrainIdleId = window.setTimeout(() => drain(), 0);
    }
  }

  private cancelEnhancementDrain(): void {
    if (this.enhancementDrainIdleId !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.enhancementDrainIdleId);
      } else {
        window.clearTimeout(this.enhancementDrainIdleId);
      }
      this.enhancementDrainIdleId = null;
    }
    this.enhancementQueue.clear();
  }

  private drainEnhancementQueue(deadline?: IdleDeadline): void {
    const fallbackDeadline = performance.now() + ENHANCEMENT_IDLE_BUDGET_MS;
    let processed = 0;
    const pass = {};

    for (const convEl of this.enhancementQueue) {
      this.enhancementQueue.delete(convEl);
      if (!convEl.isConnected) continue; // removed while queued
      this.callbacks.enhanceConversation(convEl, pass);
      processed += 1;

      const outOfIdleTime =
        deadline && !deadline.didTimeout
          ? deadline.timeRemaining() <= 0
          : performance.now() >= fallbackDeadline;
      if (processed > 0 && outOfIdleTime) break;
    }
    this.scheduleEnhancementDrain();
  }

  private flushMutationBatch(): void {
    if (this.mutationBatchQueue.length === 0) return;
    const mutations = this.mutationBatchQueue;
    this.mutationBatchQueue = [];

    const observed = readNativeSidebarMutations(mutations);
    if (observed.titlesChanged) {
      this.scheduleNativeConversationTitleSync();
    }

    // Dedupe added conversation elements. Multiple mutations in a single
    // tick frequently touch the same row; the per-element work
    // (makeConversationDraggable, applyHideArchivedToConversation) is
    // idempotent but the upfront DOM queries are not free.
    observed.rows.forEach((convEl) => {
      if (!convEl.isConnected) return; // re-removed within the same batch
      // Drag listeners + hide-archived state are deferred to the budgeted
      // drain — both are idempotent and tolerate a few frames of latency
      // (issue #753).
      this.enhancementQueue.add(convEl);
    });
    this.scheduleEnhancementDrain();

    // Deliberately ignore removed conversation rows. Gemini virtualizes the
    // sidebar, so scrolling or re-rendering can detach one real conversation
    // row at a time. A detached DOM node is therefore not deletion evidence.
    // Native deletion is tracked from the explicit Delete action in
    // NativeConversationMenus and confirmed after the UI settles.
  }

  clearTitleSync(): void {
    if (this.nativeTitleSyncTimer === null) return;
    clearTimeout(this.nativeTitleSyncTimer);
    this.nativeTitleSyncTimer = null;
  }

  private scheduleNativeConversationTitleSync(): void {
    if (!this.callbacks.hasStoredConversations()) return;
    if (this.nativeTitleSyncTimer !== null) return;

    this.nativeTitleSyncTimer = window.setTimeout(() => {
      this.nativeTitleSyncTimer = null;
      void this.callbacks.onTitlesChanged();
    }, NATIVE_TITLE_SYNC_DEBOUNCE_MS);
  }
}
