import { logger } from '@/core/services/LoggerService';
import { createToaster } from '@/core/ui/toast/toaster';
import { isUserEvent } from '@/core/utils/userEvent';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import type { ChatTurn } from '@/features/export/types/export';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { type Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings } from '@/features/plugins/types';
import {
  buildChatGptTurnsForSelection,
  chatgptCollectTurnContainers,
  isChatGptResponseGenerating,
} from '@/pages/content/export/adapter/chatgpt';
import { hasRenderedThread } from '@/pages/content/export/adapter/chatgptThread';
import { readChatGptThreadTurns } from '@/pages/content/export/adapter/chatgptThreadExport';
import { resolveExportAdapter } from '@/pages/content/export/adapter/platformAdapters';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';
import { getCurrentLanguage } from '@/utils/i18n';

import { chatgptComposerRootOf } from '../chatgptComposerTargets';
import {
  hasCurrentComposerAttachments,
  isCurrentComposerAttachmentRemovalControl,
  readCurrentComposerDraft,
} from './composerDelivery';
import {
  cancelPendingHandoffRecovery,
  handoffTemporaryChat,
  isHandoffPageUnloading,
  isTemporaryChat,
  markHandoffPageActive,
  markHandoffPageUnloading,
  pendingAttachmentPreviewReady,
  resumePendingHandoff,
} from './handoff';
import { buildHandoffBackup, downloadHandoffBackup, planHandoff } from './handoffPlan';
import { type TemporaryHandoffCopy, getTemporaryHandoffCopy } from './i18n';
import { discardPendingHandoff } from './pendingHandoff';
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_NEW_CHAT_SELECTOR,
  CHATGPT_SEND_CONTROL_SELECTOR,
  CHATGPT_TEMP_TOGGLE_SELECTOR,
} from './selectors';
import { CHATGPT_TEMPORARY_HANDOFF_CSS } from './styles';
import { showHandoffConfirmation, showHandoffProgress } from './ui';

const BUTTON_MARKER = 'data-gv-chatgpt-handoff-button';
const HEADER_SELECTOR = chatgptSite.selectors.headerActions;
const SHARE_SELECTOR = chatgptPageData.shareButton;
const REFRESH_DELAY_MS = 80;
const TOAST_MS = 4_500;
/** Each outcome replaces the previous one: they report the same handoff. */
const TOAST_CHANNEL = 'handoff';

interface ButtonMountTarget {
  readonly parent: HTMLElement;
  readonly anchor: Element | null;
  readonly floating: boolean;
}

function findButtonTarget(): ButtonMountTarget {
  const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
  if (header) return { parent: header, anchor: header.firstElementChild, floating: false };

  const share = document.querySelector<HTMLElement>(SHARE_SELECTOR);
  const wrapper = share?.parentElement;
  const parent = wrapper?.parentElement;
  if (wrapper && parent) return { parent, anchor: wrapper, floating: false };
  return { parent: document.body, anchor: null, floating: true };
}

function handoffIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gv-chatgpt-handoff-button-icon');
  for (const pathData of ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v6h6', 'M12 7v5l3 2']) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
  }
  return svg;
}

export async function collectTemporaryChatTurns(
  signal: AbortSignal,
  expectedUrl = location.href,
): Promise<ChatTurn[]> {
  const extractor = createContentExtractor(resolveExportAdapter());
  // The current thread is virtualized: read it whole with the export's crawl.
  if (hasRenderedThread()) return readChatGptThreadTurns({ signal, expectedUrl, extractor });
  // Refuse incomplete or changed turns rather than hand off a partial or mixed conversation.
  const snapshot = chatgptCollectTurnContainers();
  if (isChatGptResponseGenerating() || snapshot.at(-1)?.role === 'user') {
    throw new Error('chatgpt_export_response_still_generating');
  }
  const snapshotIds = snapshot.map(({ id }) => id);
  const selectedIds = new Set(snapshotIds);
  if (selectedIds.size === 0) return [];
  const turns = await buildChatGptTurnsForSelection(selectedIds, {
    signal,
    expectedUrl,
    extractor,
  });
  const currentSnapshot = chatgptCollectTurnContainers();
  if (
    isChatGptResponseGenerating() ||
    currentSnapshot.at(-1)?.role === 'user' ||
    currentSnapshot.length !== snapshotIds.length ||
    currentSnapshot.some(({ id }, index) => id !== snapshotIds[index])
  ) {
    throw new Error('chatgpt_export_conversation_changed');
  }
  return turns;
}

const PAGE_INPUT_EVENTS = ['pointerdown', 'keydown'] as const;
let stopWatchingDeparture: (() => void) | null = null;

/**
 * After `beforeunload`, only `pagehide` proves the page left and only the person's input
 * proves it stayed. Raw listeners: the plugin scope is torn down on `beforeunload`.
 */
function watchDepartureOutcome(): void {
  if (stopWatchingDeparture) return;
  const stop = (): void => {
    for (const type of PAGE_INPUT_EVENTS) document.removeEventListener(type, onInput, true);
    window.removeEventListener('pagehide', stop, true);
    stopWatchingDeparture = null;
  };
  const onInput = (event: Event): void => {
    if (!isUserEvent(event)) return;
    stop();
    markHandoffPageActive();
    void discardPendingHandoff();
  };
  for (const type of PAGE_INPUT_EVENTS) document.addEventListener(type, onInput, true);
  window.addEventListener('pagehide', stop, true);
  stopWatchingDeparture = stop;
}

// Mark hard departure before root teardown so recovery survives navigation, but not disable.
// Keep progress mounted until departure bookkeeping finishes.
class ChatGptTemporaryHandoffPlugin {
  private button: HTMLButtonElement | null = null;
  private stopButton: Dispose | null = null;
  private stopRefreshTimer: Dispose | null = null;
  private stopOperation: Dispose | null = null;
  private operationRequest = 0;
  private resumeInFlight: Promise<void> | null = null;
  private resumeRequested = false;
  private attachmentPreviewCheckInFlight = false;
  private attachmentPreviewCheckRequested = false;
  private attachmentPreviewResumeTriggered = false;
  private readonly toaster = createToaster();

  constructor(
    private readonly scope: PluginScope,
    private readonly copy: TemporaryHandoffCopy,
    private readonly language: Awaited<ReturnType<typeof getCurrentLanguage>>,
  ) {}

  start(): void {
    this.scope.style(CHATGPT_TEMPORARY_HANDOFF_CSS);
    this.scope.child(this.toaster, 'chatgpt-temporary-handoff-toasts');
    this.scope.on(
      window,
      'beforeunload',
      () => {
        markHandoffPageUnloading();
        // A visible page after beforeunload may still be loading the next document; a timer
        // fires then and would discard the handoff that document needs to recover.
        watchDepartureOutcome();
      },
      { capture: true },
    );
    this.scope.on(window, 'pagehide', markHandoffPageUnloading, { capture: true });
    this.scope.on(window, 'pageshow', markHandoffPageActive, { capture: true });
    this.scope.on(
      document,
      'beforeinput',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (
          target?.matches(CHATGPT_COMPOSER_SELECTOR) ||
          target?.closest(CHATGPT_COMPOSER_SELECTOR)
        ) {
          cancelPendingHandoffRecovery();
        }
      },
      { capture: true },
    );
    this.scope.on(
      document,
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (
          target?.closest(CHATGPT_SEND_CONTROL_SELECTOR) ||
          target?.closest(CHATGPT_NEW_CHAT_SELECTOR) ||
          (target && isCurrentComposerAttachmentRemovalControl(target))
        ) {
          cancelPendingHandoffRecovery();
        }
      },
      { capture: true },
    );
    this.scope.on(
      document,
      'submit',
      (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (form?.querySelector(CHATGPT_COMPOSER_SELECTOR)) cancelPendingHandoffRecovery();
      },
      { capture: true },
    );
    this.scope.effect(
      () => () => (isHandoffPageUnloading() ? undefined : discardPendingHandoff()),
      'discard-chatgpt-temporary-handoff-on-disable',
    );
    this.ensureButton();
    this.scope.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: chatgptPageData.handoffObservedAttributes,
      },
      (records) => {
        const mountedComposer = this.mutationsMountComposer(records);
        if (mountedComposer) {
          this.attachmentPreviewResumeTriggered = false;
        }
        if (mountedComposer || this.mutationsTouchComposerContent(records)) {
          this.tryResumePendingHandoff();
        } else if (this.mutationsTouchComposerForm(records)) {
          this.tryResumeWhenAttachmentReady();
        }
        if (this.mutationsTouchButtonMount(records)) this.scheduleRefresh();
      },
    );
    this.scope.effect(
      () =>
        watchRouteChanges(() => {
          this.scheduleRefresh();
          this.attachmentPreviewResumeTriggered = false;
          this.tryResumePendingHandoff();
        }),
      'watch-chatgpt-handoff-route',
    );
    this.tryResumePendingHandoff();
    this.scope.effect(
      () => () => {
        this.operationRequest += 1;
        void this.stopOperation?.();
        void this.stopButton?.();
        document.querySelectorAll(`[${BUTTON_MARKER}]`).forEach((node) => node.remove());
      },
      'chatgpt-temporary-handoff-instance',
    );
  }

  private mutationsMountComposer(records: readonly MutationRecord[]): boolean {
    return records.some((record) => {
      const mutationTarget =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (record.type === 'attributes' && mutationTarget?.matches(CHATGPT_COMPOSER_SELECTOR)) {
        return true;
      }
      return [...record.addedNodes].some((node) => {
        if (!(node instanceof Element)) return false;
        return (
          node.matches(CHATGPT_COMPOSER_SELECTOR) ||
          node.querySelector(CHATGPT_COMPOSER_SELECTOR) !== null
        );
      });
    });
  }

  private mutationsTouchComposerContent(records: readonly MutationRecord[]): boolean {
    return records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return Boolean(
        target?.matches(CHATGPT_COMPOSER_SELECTOR) || target?.closest(CHATGPT_COMPOSER_SELECTOR),
      );
    });
  }

  private mutationsTouchComposerForm(records: readonly MutationRecord[]): boolean {
    return records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return Boolean(
        target && chatgptComposerRootOf(target)?.querySelector(CHATGPT_COMPOSER_SELECTOR),
      );
    });
  }

  private tryResumeWhenAttachmentReady(): void {
    if (this.scope.isDisposed || this.attachmentPreviewResumeTriggered) return;
    if (this.attachmentPreviewCheckInFlight) {
      this.attachmentPreviewCheckRequested = true;
      return;
    }

    this.attachmentPreviewCheckInFlight = true;
    void (async () => {
      try {
        do {
          this.attachmentPreviewCheckRequested = false;
          if (await pendingAttachmentPreviewReady()) {
            this.attachmentPreviewResumeTriggered = true;
            this.tryResumePendingHandoff();
            return;
          }
        } while (this.attachmentPreviewCheckRequested && !this.scope.isDisposed);
      } catch (error) {
        logger.warn('ChatGPT temporary handoff preview check failed', { error: String(error) });
      } finally {
        this.attachmentPreviewCheckInFlight = false;
      }
    })();
  }

  private mutationsTouchButtonMount(records: readonly MutationRecord[]): boolean {
    if (this.button && !this.button.isConnected) return true;
    const selector = [HEADER_SELECTOR, SHARE_SELECTOR, CHATGPT_TEMP_TOGGLE_SELECTOR].join(',');
    return records.some((record) => {
      const nodes =
        record.type === 'attributes'
          ? [record.target]
          : [...record.addedNodes, ...record.removedNodes];
      return nodes.some((node) => {
        if (!(node instanceof Element)) return false;
        return (
          node.matches(selector) ||
          node.querySelector(selector) !== null ||
          (this.button ? node.contains(this.button) : false)
        );
      });
    });
  }

  private scheduleRefresh(): void {
    if (this.scope.isDisposed) return;
    void this.stopRefreshTimer?.();
    if (this.scope.isDisposed) return;
    this.stopRefreshTimer = this.scope.timer(() => {
      this.stopRefreshTimer = null;
      this.ensureButton();
    }, REFRESH_DELAY_MS);
  }

  private ensureButton(): void {
    if (this.scope.isDisposed || !document.body) return;
    if (!isTemporaryChat()) {
      void this.stopButton?.();
      this.stopButton = null;
      this.button = null;
      return;
    }

    const target = findButtonTarget();
    const correctParent = this.button?.parentElement === target.parent;
    const correctMode =
      this.button?.classList.contains('gv-chatgpt-handoff-button--floating') === target.floating;
    if (this.button?.isConnected && correctParent && correctMode) return;

    void this.stopButton?.();
    const buttonScope = new PluginScope();
    this.stopButton = this.scope.child(
      { destroy: () => buttonScope.dispose() },
      'chatgpt-temporary-handoff-button',
    );
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `gv-chatgpt-handoff-button${target.floating ? ' gv-chatgpt-handoff-button--floating' : ''}`;
    button.setAttribute(BUTTON_MARKER, 'true');
    button.setAttribute('aria-label', this.copy.button);
    button.title = this.copy.button;
    const label = document.createElement('span');
    label.className = 'gv-chatgpt-handoff-button-label';
    label.textContent = this.copy.button;
    button.append(handoffIcon(), label);
    buttonScope.on(button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.startHandoff();
    });
    buttonScope.effect(
      () => () => {
        if (this.button === button) this.button = null;
      },
      'chatgpt-temporary-handoff-button-reference',
    );
    buttonScope.mount(button, target.parent, target.anchor);
    this.button = button;
  }

  private cancelCurrentOperation(): void {
    this.operationRequest += 1;
    const stop = this.stopOperation;
    this.stopOperation = null;
    void stop?.();
  }

  private toast(message: string, tone: 'info' | 'error' = 'info'): void {
    this.toaster.show({ channel: TOAST_CHANNEL, message, tone, durationMs: TOAST_MS });
  }

  private runOperation(action: (scope: PluginScope) => Promise<void>): void {
    const request = ++this.operationRequest;
    void (async () => {
      await this.stopOperation?.();
      if (this.scope.isDisposed || request !== this.operationRequest) return;

      const operationScope = new PluginScope();
      const stop = this.scope.child(
        { destroy: () => operationScope.dispose() },
        'chatgpt-temporary-handoff-operation',
      );
      this.stopOperation = stop;
      try {
        await action(operationScope);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        logger.error('ChatGPT temporary handoff failed', { error: String(error) });
        this.toast(this.copy.failed, 'error');
      } finally {
        await stop();
        if (this.stopOperation === stop) this.stopOperation = null;
      }
    })();
  }

  private startHandoff(): void {
    this.runOperation(async (operationScope) => {
      if (!isTemporaryChat()) {
        this.toast(this.copy.notTemporary, 'error');
        return;
      }
      if (!(await showHandoffConfirmation(operationScope, this.copy))) return;
      if (!isTemporaryChat()) {
        this.toast(this.copy.notTemporary, 'error');
        return;
      }
      if (hasCurrentComposerAttachments()) {
        this.toast(this.copy.attachmentDraftUnsupported, 'error');
        return;
      }

      const expectedUrl = location.href;
      const progress = showHandoffProgress(operationScope, this.copy, () =>
        this.cancelCurrentOperation(),
      );
      try {
        const turns = await collectTemporaryChatTurns(operationScope.signal, expectedUrl);
        if (turns.length === 0) {
          this.toast(this.copy.emptyConversation, 'error');
          return;
        }

        const plan = planHandoff(turns, this.language);
        const preservedDraft = readCurrentComposerDraft();
        downloadHandoffBackup(
          buildHandoffBackup(plan.transcript, preservedDraft, this.language),
          plan.backupFilename,
        );
        const result = await handoffTemporaryChat(operationScope, plan.delivery, preservedDraft);
        if (result === 'ready') this.toast(this.copy.ready);
        else if (result === 'leave-failed') {
          this.toast(this.copy.leaveFailed, 'error');
        } else if (result === 'composer-missing') {
          this.toast(this.copy.composerMissing);
        } else if (result === 'delivery-failed') {
          this.toast(this.copy.deliveryFailed, 'error');
        } else if (result === 'storage-failed') {
          this.toast(this.copy.failed, 'error');
        } else this.toast(this.copy.accountChanged, 'error');
      } finally {
        await progress.close();
      }
    });
  }

  private tryResumePendingHandoff(): void {
    if (this.scope.isDisposed) return;
    if (this.resumeInFlight) {
      this.resumeRequested = true;
      return;
    }

    this.resumeInFlight = resumePendingHandoff(this.scope)
      .then((result) => {
        if (this.scope.isDisposed) return;
        if (result === 'ready') this.toast(this.copy.ready);
        else if (result === 'delivery-failed') {
          this.toast(this.copy.deliveryFailed, 'error');
        } else if (result === 'account-mismatch') {
          this.toast(this.copy.accountChanged, 'error');
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        logger.error('ChatGPT temporary handoff resume failed', { error: String(error) });
      })
      .finally(() => {
        this.resumeInFlight = null;
        if (!this.resumeRequested) return;
        this.resumeRequested = false;
        this.tryResumePendingHandoff();
      });
  }
}

export async function activateChatGptTemporaryHandoff(
  scope: PluginScope,
  _settings: PluginSettings = {},
): Promise<void> {
  const language = await getCurrentLanguage();
  if (scope.isDisposed) return;
  new ChatGptTemporaryHandoffPlugin(scope, getTemporaryHandoffCopy(language), language).start();
}
