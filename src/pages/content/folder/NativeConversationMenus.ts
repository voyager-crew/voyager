import { getTranslationSyncUnsafe } from '@/utils/i18n';

import {
  MENU_PANEL_SELECTOR as CONVERSATION_MENU_PANEL_SELECTOR,
  type ConversationMenuContext,
  getConversationMenuContext,
  injectConversationMenuMoveToFolderButton,
} from '../export/conversationMenuInjection';
import { normalizeConversationId } from './folderConversationIdentity';
import {
  type NativeConversationInfo,
  extractConversationInfoFromPage,
} from './nativeConversationTitles';
import {
  type NativeDeleteScope,
  NativeDeleteTracker,
  getNativeDeleteMenuContext,
} from './nativeDeleteTracker';
import {
  NATIVE_ACTION_TIMING,
  clickBackdropToCloseMenu,
  clickMoreButton,
  confirmDeleteIfNeeded,
  menuDebug as debug,
  delay,
  waitForDeleteButtonAndClick,
  waitForRenameButtonAndClick,
} from './nativeMenuActions';
import {
  type NativeSidebarReadContext,
  findConversationElementForTrigger,
  findNativeConversationElement,
  readNativeConversationInfo,
} from './nativeSidebarDom';

export interface NativeConversationMenuCallbacks {
  getContext: () => NativeSidebarReadContext & { storageKey: string };
  /** `trigger` is the ⋮ button the menu opened from, which outlives the menu. */
  onMoveToFolder: (info: NativeConversationInfo, trigger: HTMLElement | null) => void;
  onConfirmedDelete: (id: string) => void;
}

interface NativeDeleteAction extends NativeDeleteScope {
  signal: AbortSignal;
}

// Native menu contents render asynchronously after their panel appears.
const MOVE_MENU_INJECTION_RETRY_LIMIT = 8;
const MOVE_MENU_INJECTION_RETRY_DELAY_MS = 80;
const CONVERSATION_MENU_TRIGGER_SELECTOR =
  '[data-test-id="actions-menu-button"], [data-test-id="conversation-actions-menu-icon-button"]';

/**
 * Cheap gate before the matches/querySelectorAll/closest triple: menu panels
 * only ever live inside a CDK overlay (or are a <gem-menu> themselves), while
 * the overwhelming majority of body mutations are sidebar/chat re-renders that
 * can't contain one. Missed edge cases are covered by the click-tracking
 * fallback in startTracking.
 */
function mayHostMenuPanel(node: HTMLElement): boolean {
  const className = typeof node.className === 'string' ? node.className : '';
  return (
    node.tagName === 'GEM-MENU' ||
    className.includes('mat-mdc-menu-panel') ||
    className.includes('cdk-overlay') ||
    node.parentElement?.closest('.cdk-overlay-container') != null
  );
}

/** The conversation menu panels an added node is, contains, or sits inside. */
function collectAddedMenuPanels(node: HTMLElement): Set<HTMLElement> {
  const panels = new Set<HTMLElement>();
  if (node.matches(CONVERSATION_MENU_PANEL_SELECTOR)) panels.add(node);
  node
    .querySelectorAll<HTMLElement>(CONVERSATION_MENU_PANEL_SELECTOR)
    .forEach((panel) => panels.add(panel));
  const closest = node.closest(CONVERSATION_MENU_PANEL_SELECTOR) as HTMLElement | null;
  if (closest) panels.add(closest);
  return panels;
}

function wasInjectedConversationMenu(node: HTMLElement): boolean {
  return !!(
    (node.matches?.(CONVERSATION_MENU_PANEL_SELECTOR) &&
      node.querySelector('.gv-move-to-folder-btn')) ||
    node.querySelector?.(`${CONVERSATION_MENU_PANEL_SELECTOR} .gv-move-to-folder-btn`) ||
    (node.querySelector?.(CONVERSATION_MENU_PANEL_SELECTOR) &&
      node.querySelector('.gv-move-to-folder-btn'))
  );
}

function parseMenuTriggerPanelIds(trigger: HTMLElement): string[] {
  const raw = `${trigger.getAttribute('aria-controls') || ''} ${
    trigger.getAttribute('aria-owns') || ''
  }`;
  return raw
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Owns native menu interaction and explicit deletion tracking across sidebar remounts. */
export class NativeConversationMenus {
  private nativeMenuObserver: MutationObserver | null = null;

  // Capture-phase listener that injects "Move to folder" when a conversation ⋮
  // menu trigger is clicked (belt-and-suspenders alongside nativeMenuObserver).
  private moveMenuTriggerHandler: ((event: Event) => void) | null = null;

  private moveMenuKeydownHandler: ((event: Event) => void) | null = null;

  // Tracks the last input modality so menu-close focus handling stays a11y-safe:
  // pointer dismissals drop trigger focus, keyboard dismissals preserve it.
  private lastInputModality: 'pointer' | 'keyboard' = 'pointer';

  private menuTimers = new Set<number>();
  private activeDeletes = new Set<AbortController>();
  private readonly deleteTracker: NativeDeleteTracker;

  constructor(private readonly callbacks: NativeConversationMenuCallbacks) {
    this.deleteTracker = new NativeDeleteTracker({
      getContext: () => this.callbacks.getContext(),
      onConfirmedDelete: (id) => this.callbacks.onConfirmedDelete(id),
    });
  }

  /** Sidebar-only remount: retain document tracking and pending delete confirmations. */
  disconnectPanels(): void {
    this.nativeMenuObserver?.disconnect();
    this.nativeMenuObserver = null;
  }

  /** Full mounted-runtime teardown also cancels active programmatic deletions. */
  stop(): void {
    for (const controller of this.activeDeletes) controller.abort();
    this.activeDeletes.clear();
    this.disconnectPanels();
    this.teardownMoveMenuTriggerListener();
    this.deleteTracker.stop();
    this.menuTimers.forEach((timerId) => window.clearTimeout(timerId));
    this.menuTimers.clear();
  }

  private scheduleMenuTask(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.menuTimers.delete(timer);
      callback();
    }, delay);
    this.menuTimers.add(timer);
  }

  // Detect a freshly-opened conversation ⋮ menu and inject our "Move to folder"
  // item. Google's "lr26" UI overhaul replaced the old `.mat-mdc-menu-panel`
  // (rendered into `.cdk-overlay-container`) with a `<gem-menu>` element and
  // re-creates the overlay container, which silently broke the previous
  // observer. This mirrors the proven, robust export-button observer: it
  // watches `document.body`, matches both panel variants, and retries while
  // the menu items stream in asynchronously.
  observePanels(): void {
    this.disconnectPanels();

    const observer = new MutationObserver((mutations) => {
      if (this.callbacks.getContext().isDestroyed) return;
      for (const mutation of mutations) this.handlePanelMutation(mutation);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    this.nativeMenuObserver = observer;

    // Catch any menu already open at setup time.
    document
      .querySelectorAll<HTMLElement>(CONVERSATION_MENU_PANEL_SELECTOR)
      .forEach((panel) => this.scheduleInjection(panel));
  }

  private handlePanelMutation(mutation: MutationRecord): void {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement) || !mayHostMenuPanel(node)) return;
      collectAddedMenuPanels(node).forEach((panel) => this.scheduleInjection(panel));
    });

    // When a conversation menu we injected into closes, mat-menu restores
    // focus to the ⋮ trigger, which keeps the row visually selected via
    // :focus-within. Drop that focus on pointer-driven dismissals so the
    // row reverts. See releaseTriggerFocusAfterPointerClose for guards.
    mutation.removedNodes.forEach((node) => {
      if (node instanceof HTMLElement && wasInjectedConversationMenu(node)) {
        this.releaseTriggerFocusAfterPointerClose();
      }
    });
  }

  private scheduleInjection(panel: HTMLElement): void {
    this.scheduleMenuTask(() => this.tryInjectMoveToFolderOnPanel(panel), 30);
  }

  // Inject the "Move to folder" item into a native conversation menu panel,
  // retrying while the menu content renders. Conversation info is resolved
  // lazily on click (from the menu trigger or the open page) so a transient
  // extraction miss never prevents the item from appearing.
  private tryInjectMoveToFolderOnPanel(
    panel: HTMLElement,
    retriesLeft: number = MOVE_MENU_INJECTION_RETRY_LIMIT,
  ): void {
    if (this.callbacks.getContext().isDestroyed || !panel.isConnected) return;

    if (!getConversationMenuContext(panel)) return;

    const label = getTranslationSyncUnsafe('conversation_move_to_folder');
    const injected = injectConversationMenuMoveToFolderButton(panel, {
      label,
      tooltip: label,
      onClick: () => {
        // Gemini can link the expanded trigger after the panel is injected.
        const context = getConversationMenuContext(panel);
        const info = context ? this.resolveConversationInfoForMenu(context) : null;
        if (info) {
          this.callbacks.onMoveToFolder(info, context?.trigger ?? null);
        } else {
          debug('warn', 'Move to folder: could not resolve conversation info on click');
        }
      },
    });

    if (!injected && retriesLeft > 0) {
      this.scheduleMenuTask(
        () => this.tryInjectMoveToFolderOnPanel(panel, retriesLeft - 1),
        MOVE_MENU_INJECTION_RETRY_DELAY_MS,
      );
    }
  }

  // Resolve the conversation a menu belongs to. Sidebar menus map back to their
  // list item via the trigger; the top-bar ⋮ menu maps to the open page.
  private resolveConversationInfoForMenu(
    context: ConversationMenuContext,
  ): { id: string; title: string; url: string } | null {
    const sidebarInfo = context.trigger ? this.resolveSidebarMenuInfo(context.trigger) : null;
    if (sidebarInfo) return sidebarInfo;

    // Top-bar menus map to the current page. A sidebar resolution miss must
    // stay unresolved rather than accidentally targeting the open page.
    if (context.menuType === 'top') {
      const pageInfo = extractConversationInfoFromPage();
      if (pageInfo) {
        debug('log', 'resolveConversationInfoForMenu(page):', pageInfo);
        return pageInfo;
      }
    }
    return null;
  }

  private resolveSidebarMenuInfo(
    trigger: HTMLElement,
  ): { id: string; title: string; url: string } | null {
    const conversationEl = findConversationElementForTrigger(trigger);
    if (!conversationEl) return null;
    const { accountIsolationEnabled } = this.callbacks.getContext();
    const info = readNativeConversationInfo(conversationEl, accountIsolationEnabled);
    if (info) debug('log', 'resolveConversationInfoForMenu(sidebar):', info);
    return info;
  }

  // Belt-and-suspenders alongside nativeMenuObserver: when a conversation ⋮
  // trigger is clicked, resolve the panel it controls (via aria-controls/owns)
  // and retry injection while the menu renders. This covers cases where the
  // panel is re-used / re-rendered without a fresh childList mutation.
  startTracking(): void {
    if (this.moveMenuTriggerHandler) return; // already wired (idempotent across reinit)

    const handler = (event: Event) => {
      if (this.callbacks.getContext().isDestroyed) return;
      // Any pointerdown/click marks the modality; used to decide whether to drop
      // trigger focus on menu close (pointer) vs preserve it (keyboard a11y).
      this.lastInputModality = 'pointer';
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (event.type === 'click' && this.trackNativeDeleteClick(target)) return;

      const trigger = target.closest(CONVERSATION_MENU_TRIGGER_SELECTOR) as HTMLElement | null;
      if (!trigger) return;

      this.deleteTracker.clearCandidate();
      this.injectIntoTriggerPanels(trigger);
    };

    document.addEventListener('click', handler, true);
    document.addEventListener('pointerdown', handler, true);
    this.moveMenuTriggerHandler = handler;

    const keyHandler = (event: Event) => {
      if (this.callbacks.getContext().isDestroyed) return;
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        this.deleteTracker.clearCandidate();
      }
      this.lastInputModality = 'keyboard';
    };
    document.addEventListener('keydown', keyHandler, true);
    this.moveMenuKeydownHandler = keyHandler;
  }

  /** Arms or resolves a user-driven native delete; true when the click belonged to it. */
  private trackNativeDeleteClick(target: HTMLElement): boolean {
    if (this.deleteTracker.handleDialogClick(target)) return true;
    const context = getNativeDeleteMenuContext(target);
    const conversationId = context
      ? normalizeConversationId(this.resolveConversationInfoForMenu(context)?.id)
      : null;
    if (!conversationId) return false;
    this.deleteTracker.rememberCandidate(conversationId);
    return true;
  }

  private injectIntoTriggerPanels(trigger: HTMLElement): void {
    const panelIds = parseMenuTriggerPanelIds(trigger);
    for (let attempt = 0; attempt <= MOVE_MENU_INJECTION_RETRY_LIMIT; attempt++) {
      this.scheduleMenuTask(() => {
        if (this.callbacks.getContext().isDestroyed) return;
        if (panelIds.length > 0) {
          panelIds.forEach((id) => {
            const panel = document.getElementById(id);
            if (panel instanceof HTMLElement && panel.matches(CONVERSATION_MENU_PANEL_SELECTOR)) {
              this.tryInjectMoveToFolderOnPanel(panel);
            }
          });
        } else {
          document
            .querySelectorAll<HTMLElement>(CONVERSATION_MENU_PANEL_SELECTOR)
            .forEach((panel) => this.tryInjectMoveToFolderOnPanel(panel));
        }
      }, attempt * MOVE_MENU_INJECTION_RETRY_DELAY_MS);
    }
  }

  // After a conversation ⋮ menu we injected into closes, mat-menu restores DOM
  // focus to the trigger (Angular default), leaving the row highlighted via
  // :focus-within. Drop that focus — but ONLY for plain pointer dismissals, so
  // we never disturb keyboard navigation, the rename/delete flows, our
  // move-to-folder dialog, or any confirm dialog that takes focus.
  private releaseTriggerFocusAfterPointerClose(): void {
    if (this.lastInputModality !== 'pointer') return;
    this.scheduleMenuTask(() => {
      if (this.callbacks.getContext().isDestroyed) return;
      // Skip if another overlay/dialog grabbed the stage (delete confirm, our
      // move-to-folder dialog, any CDK dialog) — those manage their own focus.
      if (
        document.querySelector(
          '.cdk-overlay-backdrop, .mat-mdc-dialog-container, .gv-folder-dialog-overlay',
        )
      ) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active && active.matches?.(CONVERSATION_MENU_TRIGGER_SELECTOR)) {
        active.blur();
      }
    }, 0);
  }

  private teardownMoveMenuTriggerListener(): void {
    if (this.moveMenuTriggerHandler) {
      document.removeEventListener('click', this.moveMenuTriggerHandler, true);
      document.removeEventListener('pointerdown', this.moveMenuTriggerHandler, true);
      this.moveMenuTriggerHandler = null;
    }
    if (this.moveMenuKeydownHandler) {
      document.removeEventListener('keydown', this.moveMenuKeydownHandler, true);
      this.moveMenuKeydownHandler = null;
    }
    this.deleteTracker.clearCandidate();
  }

  /**
   * Trigger native delete for a single conversation by simulating UI interactions
   */
  async deleteConversation(conversationId: string, signal?: AbortSignal): Promise<boolean> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    this.activeDeletes.add(controller);
    const action: NativeDeleteAction = {
      ...this.deleteTracker.captureScope(),
      signal: controller.signal,
    };
    try {
      return await this.runNativeDelete(conversationId, action);
    } catch (error) {
      console.error(`[FolderManager] Error in triggerNativeDeleteForConversation:`, error);
      return false;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.activeDeletes.delete(controller);
    }
  }

  private async runNativeDelete(
    conversationId: string,
    action: NativeDeleteAction,
  ): Promise<boolean> {
    const isCurrent = () => this.isNativeDeleteActionCurrent(action);
    if (!isCurrent()) return false;
    // The lr26 sidebar virtualizes rows — if the user has scrolled the list
    // since selecting, the target row may be unmounted entirely.
    const conversationEl = findNativeConversationElement(
      this.callbacks.getContext().sidebar,
      conversationId,
    );
    if (!conversationEl) {
      console.warn(
        `[FolderManager] Batch delete: conversation row not in DOM (likely virtualized out): ${conversationId}. ` +
          'Scroll the sidebar to bring it back into view, or split the batch into smaller chunks.',
      );
      return false;
    }

    const moreButton = await clickMoreButton(conversationEl, isCurrent, action.signal);
    if (!isCurrent()) return false;
    if (!moreButton) {
      console.warn(
        `[FolderManager] Batch delete: actions menu button not found for ${conversationId}`,
      );
      return false;
    }

    await delay(NATIVE_ACTION_TIMING.MENU_APPEAR_DELAY, action.signal);
    if (!isCurrent()) return false;
    return this.deleteFromOpenMenu(conversationId, action, isCurrent);
  }

  private async deleteFromOpenMenu(
    conversationId: string,
    action: NativeDeleteAction,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const deleteSuccess = await waitForDeleteButtonAndClick(isCurrent, action.signal);
    if (!isCurrent()) return false;
    if (!deleteSuccess) {
      console.warn(
        `[FolderManager] Batch delete: Delete menu item not found after ${NATIVE_ACTION_TIMING.MAX_BUTTON_WAIT_TIME}ms for ${conversationId}`,
      );
      clickBackdropToCloseMenu();
      return false;
    }

    await delay(NATIVE_ACTION_TIMING.DIALOG_APPEAR_DELAY, action.signal);
    if (!isCurrent()) return false;
    await confirmDeleteIfNeeded(isCurrent, action.signal);
    if (!isCurrent()) return false;
    await delay(NATIVE_ACTION_TIMING.DELETION_COMPLETE_DELAY, action.signal);

    return isCurrent();
  }

  private isNativeDeleteActionCurrent(action: NativeDeleteAction): boolean {
    return (
      !action.signal.aborted &&
      !this.callbacks.getContext().isDestroyed &&
      this.deleteTracker.isScopeCurrent(action)
    );
  }

  /**
   * Find and click the more options button for a conversation, scrolling a
   * virtualized row into view first when its trailing actions are unmounted.
   */
  findAndClickMoreButton(
    conversationEl: HTMLElement,
    action?: NativeDeleteAction,
  ): Promise<HTMLElement | null> {
    const isCurrent = () => !action || this.isNativeDeleteActionCurrent(action);
    return clickMoreButton(conversationEl, isCurrent, action?.signal);
  }

  resetNativeConversationMenuTrigger(moreButton: HTMLElement): void {
    moreButton.blur();
    const actionsContainer = moreButton.closest('.conversation-actions-container');
    if (actionsContainer instanceof HTMLElement) {
      actionsContainer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }
  }

  waitForRenameButtonAndClick(): Promise<boolean> {
    return waitForRenameButtonAndClick();
  }
}
