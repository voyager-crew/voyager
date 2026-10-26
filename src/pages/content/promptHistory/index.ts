/**
 * Prompt History (#923)
 *
 * Captures the user's current composer text at the send/update intent, before
 * Gemini can clear or swallow it. The feature is opt-in and keeps all runtime
 * listeners removable so it can be disabled and re-enabled without a reload.
 */
import {
  accountIsolationService,
  detectAccountContextFromDocument,
} from '@/core/services/AccountIsolationService';
import { LoggerService } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { askConfirm } from '@/core/ui/confirm';
import { isVoyagerLayerEvent } from '@/core/ui/layer';
import { createToaster } from '@/core/ui/toast/toaster';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { getTranslationSync } from '@/utils/i18n';

import { stripInstructionBlockPreservingWhitespace } from '../folderProject/instructionBlock';
import { startPromptScopedRead } from '../prompt/promptPageScope';
import { followGeminiSendKey } from '../sendBehavior/followSendKey';
import {
  findClosestSendActionButton,
  findInputForSendActionButton,
  isSendKeyboardEvent,
  isUpdateActionButton,
} from '../sendBehavior/sendButton';
import { watchRouteChanges } from '../utils/routeWatcher';
import { isCurrentCapture, watchCaptureNavigation } from './captureNavigation';
import { createEl, createHistoryIcon, renderHistoryItems } from './historyList';
import {
  findFormPromptInput,
  inputFromTarget,
  isPromptInput,
  promptTypeForInput,
  readInputText,
} from './promptInput';
import {
  type PromptHistoryItem,
  addPromptHistory,
  clearPromptHistory,
  getPromptHistory,
  isPromptHistoryStorageKeyForAccount,
  removePromptHistoryItem,
} from './storage';

const logger = LoggerService.getInstance().createChild('PromptHistory');
const ROOT_ID = 'gv-ph-root';
const PANEL_ID = 'gv-ph-panel';
const TITLE_ID = 'gv-ph-title';
const CAPTURE_DEDUPLICATION_WINDOW_MS = 10_000;

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

let isEnabled = false;
let ctrlEnterSendEnabled = false;
let ctrlEnterSettingRevision = 0;
let stopRouteWatcher: (() => void) | null = null;
/** Refreshes the open panel when this account's history changes in another tab. */
let historyListener: StorageListener | null = null;
let clickListener: ((event: MouseEvent) => void) | null = null;
let submitListener: ((event: SubmitEvent) => void) | null = null;
let keydownListener: ((event: KeyboardEvent) => void) | null = null;
let trigger: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let panelOpen = false;
let panelCleanup: (() => void) | null = null;
// Answers an open clear confirm with null when the panel closes or tears down.
let confirmOwner: AbortController | null = null;
/** Storage failures while the panel is closed; with it open they go to its own notice line. */
const notices = createToaster();
let renderRevision = 0;
const recentCaptures = new Map<string, number>();
const pendingCaptures = new Set<{ stop: () => Promise<void> }>();

function getConversationPath(): string {
  return window.location.pathname;
}

interface ResolvedPromptHistoryScope {
  accountScope: string;
  identity: string;
}

function getCurrentAccountIdentity(): {
  pageUrl: string;
  routeUserId: string | null;
  email: string | null;
  identity: string;
} {
  const pageUrl = window.location.href;
  const context = detectAccountContextFromDocument(pageUrl, document);
  return {
    pageUrl,
    routeUserId: context.routeUserId,
    email: context.email,
    identity: `${context.routeUserId ?? ''}\u0000${context.email ?? ''}`,
  };
}

async function resolveCurrentAccountScope(): Promise<ResolvedPromptHistoryScope> {
  const context = getCurrentAccountIdentity();
  const scope = await accountIsolationService.resolveAccountScope({
    pageUrl: context.pageUrl,
    routeUserId: context.routeUserId,
    email: context.email,
  });
  return { accountScope: scope.accountKey, identity: context.identity };
}

function showGlobalStorageError(): void {
  notices.show({
    channel: 'storage-error',
    message: getTranslationSync('promptHistoryStorageFailed'),
    tone: 'error',
    durationMs: 5000,
  });
}

function reportStorageError(error: unknown): void {
  if (isExtensionContextInvalidatedError(error)) return;
  logger.warn('Prompt history storage operation failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  if (panelOpen) {
    setNotice(getTranslationSync('promptHistoryStorageFailed'), 'error');
  } else {
    showGlobalStorageError();
  }
}

function capturePrompt(input: HTMLElement, type = promptTypeForInput(input)): void {
  const content = stripInstructionBlockPreservingWhitespace(readInputText(input)).trim();
  if (!content) return;
  const path = getConversationPath();
  const account = getCurrentAccountIdentity();
  const capture = startPromptScopedRead({
    read: resolveCurrentAccountScope,
    invalidatedBy: watchCaptureNavigation,
    isCurrent: () => isCurrentCapture(path, account),
    accept: ({ accountScope }) => {
      const fingerprint = `${accountScope}\u0000${path}\u0000${type}\u0000${content}`;
      const now = Date.now();
      const previousCapture = recentCaptures.get(fingerprint);
      if (
        previousCapture !== undefined &&
        now - previousCapture >= 0 &&
        now - previousCapture < CAPTURE_DEDUPLICATION_WINDOW_MS
      ) {
        return;
      }
      recentCaptures.set(fingerprint, now);
      for (const [key, timestamp] of recentCaptures) {
        if (now - timestamp >= CAPTURE_DEDUPLICATION_WINDOW_MS) recentCaptures.delete(key);
      }
      void addPromptHistory(content, type, path, accountScope).catch((error) => {
        if (recentCaptures.get(fingerprint) === now) recentCaptures.delete(fingerprint);
        reportStorageError(error);
      });
    },
    failed: reportStorageError,
  });
  pendingCaptures.add(capture);
  capture.subscribe(() => pendingCaptures.delete(capture));
}

function startCaptureListeners(): void {
  if (clickListener || submitListener || keydownListener) return;

  clickListener = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target ? findClosestSendActionButton(target) : null;
    if (!button) return;
    const input = findInputForSendActionButton(button);
    if (!input || !isPromptInput(input)) return;
    capturePrompt(input, isUpdateActionButton(button) ? 'edited' : promptTypeForInput(input));
  };

  submitListener = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const input = findFormPromptInput(form);
    if (!input) return;
    const submitter = event.submitter;
    const type =
      submitter instanceof HTMLButtonElement && isUpdateActionButton(submitter)
        ? 'edited'
        : promptTypeForInput(input);
    capturePrompt(input, type);
  };

  keydownListener = (event) => {
    if (!isSendKeyboardEvent(event, ctrlEnterSendEnabled ? 'ctrlEnter' : 'host')) return;
    const input = inputFromTarget(event.target);
    if (input) capturePrompt(input);
  };

  document.addEventListener('click', clickListener, true);
  document.addEventListener('submit', submitListener, true);
  document.addEventListener('keydown', keydownListener, true);
}

function stopCaptureListeners(): void {
  if (clickListener) document.removeEventListener('click', clickListener, true);
  if (submitListener) document.removeEventListener('submit', submitListener, true);
  if (keydownListener) document.removeEventListener('keydown', keydownListener, true);
  clickListener = null;
  submitListener = null;
  keydownListener = null;
}

function setNotice(message: string, kind: 'ok' | 'error'): void {
  if (!panel) return;
  let notice = panel.querySelector<HTMLDivElement>('.gv-ph-notice');
  if (!notice) {
    notice = createEl('div', 'gv-ph-notice');
    panel.appendChild(notice);
  }
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  notice.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  notice.textContent = message;
  notice.className = `gv-ph-notice gv-ph-notice-${kind}`;
  window.clearTimeout((notice as HTMLDivElement & { _t?: number })._t);
  (notice as HTMLDivElement & { _t?: number })._t = window.setTimeout(() => {
    notice?.remove();
  }, 2000);
}

function showHistoryItems(items: PromptHistoryItem[]): void {
  if (!listEl) return;
  renderHistoryItems(listEl, items, {
    notify: setNotice,
    onInserted: () => closePanel(false),
    remove: (item) => {
      void removePromptHistoryItem(item.id, item.accountScope)
        .then(() => renderHistoryList())
        .catch(reportStorageError);
    },
  });
}

function renderHistoryList(): void {
  const list = listEl;
  if (!list) return;
  const revision = ++renderRevision;
  list.setAttribute('aria-busy', 'true');
  void resolveCurrentAccountScope()
    .then(async ({ accountScope, identity }) => ({
      accountScope,
      identity,
      items: await getPromptHistory(accountScope),
    }))
    .then(({ identity, items }) => {
      if (revision !== renderRevision) return;
      if (identity !== getCurrentAccountIdentity().identity) {
        if (panelOpen) renderHistoryList();
        return;
      }
      showHistoryItems(items);
    })
    .catch(reportStorageError)
    .finally(() => {
      if (revision === renderRevision) list.removeAttribute('aria-busy');
    });
}

function closePanel(restoreFocus = false): void {
  if (!panel) return;
  confirmOwner?.abort();
  panelOpen = false;
  panel.classList.add('gv-hidden');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

function openPanel(): void {
  if (!panel) return;
  panelOpen = true;
  panel.classList.remove('gv-hidden');
  trigger?.setAttribute('aria-expanded', 'true');
  renderHistoryList();
  panel.focus();
}

function togglePanel(): void {
  if (panelOpen) closePanel(true);
  else openPanel();
}

async function showClearConfirmation(anchor: HTMLButtonElement): Promise<void> {
  const { accountScope, identity } = await resolveCurrentAccountScope();
  if (!panelOpen || identity !== getCurrentAccountIdentity().identity) return;
  confirmOwner?.abort();
  const owner = new AbortController();
  confirmOwner = owner;
  const answer = await askConfirm({
    message: getTranslationSync('promptHistoryClearConfirm'),
    anchor,
    side: 'beside',
    tone: 'danger',
    cancelLabel: getTranslationSync('promptHistoryCancel'),
    choices: [{ id: 'confirm', label: getTranslationSync('promptHistoryClear') }],
    signal: owner.signal,
  });
  if (confirmOwner === owner) confirmOwner = null;
  // The account may have changed while the confirm was open; never clear another one's history.
  if (!answer || !panelOpen || identity !== getCurrentAccountIdentity().identity) return;
  await clearPromptHistory(accountScope);
  renderHistoryList();
}

function setupPanel(): void {
  if (panelCleanup || document.getElementById(ROOT_ID)) return;

  trigger = createEl('button', 'gv-ph-trigger');
  trigger.id = ROOT_ID;
  trigger.type = 'button';
  trigger.setAttribute('aria-label', getTranslationSync('promptHistoryTitle'));
  trigger.setAttribute('aria-controls', PANEL_ID);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.appendChild(createHistoryIcon());

  panel = createEl('div', 'gv-ph-panel gv-hidden');
  panel.id = PANEL_ID;
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', TITLE_ID);

  const header = createEl('div', 'gv-ph-header');
  const title = createEl('h2', 'gv-ph-title');
  title.id = TITLE_ID;
  title.textContent = getTranslationSync('promptHistoryTitle');
  const clearButton = createEl('button', 'gv-ph-action');
  clearButton.type = 'button';
  clearButton.textContent = getTranslationSync('promptHistoryClear');
  clearButton.addEventListener('click', () => {
    void showClearConfirmation(clearButton).catch(reportStorageError);
  });
  header.append(title, clearButton);

  listEl = createEl('div', 'gv-ph-list');
  panel.append(header, listEl);
  document.body.append(trigger, panel);

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePanel();
  });

  const onPointerDown = (event: PointerEvent) => {
    if (!panelOpen) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (isVoyagerLayerEvent(event) || target.closest('.gv-ph-panel, .gv-ph-trigger')) return;
    closePanel(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!panelOpen || event.key !== 'Escape') return;
    closePanel(true);
  };
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);

  panelCleanup = () => {
    confirmOwner?.abort();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown);
    trigger?.remove();
    panel?.remove();
    trigger = null;
    panel = null;
    listEl = null;
    panelOpen = false;
  };
}

function teardownPanel(): void {
  panelCleanup?.();
  panelCleanup = null;
}

function enableFeature(): void {
  if (isEnabled) return;
  isEnabled = true;
  startCaptureListeners();
  setupPanel();
}

function disableFeature(): void {
  if (!isEnabled) return;
  isEnabled = false;
  stopCaptureListeners();
  teardownPanel();
  for (const capture of pendingCaptures) void capture.stop();
  pendingCaptures.clear();
  recentCaptures.clear();
  renderRevision++;
}

function startUrlWatcher(): void {
  if (stopRouteWatcher) return;
  let currentPath = getConversationPath();
  stopRouteWatcher = watchRouteChanges(() => {
    const nextPath = getConversationPath();
    if (nextPath === currentPath) return;
    currentPath = nextPath;
    renderRevision++;
    closePanel(false);
  });
}

/** Reads one boolean sync setting as `=== true`; a failed read counts as off. */
function loadSyncSwitch(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage?.sync?.get) {
        resolve(false);
        return;
      }
      chrome.storage.sync.get({ [key]: false }, (result) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          logger.warn('Failed to load prompt history settings', { message: error.message });
          resolve(false);
          return;
        }
        resolve(result?.[key] === true);
      });
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('Failed to load prompt history settings', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      resolve(false);
    }
  });
}

function addStorageListener(listener: StorageListener): void {
  try {
    chrome.storage?.onChanged?.addListener(listener);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logger.warn('Failed to listen for prompt history settings', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function removeStorageListener(listener: StorageListener | null): void {
  if (!listener) return;
  try {
    chrome.storage?.onChanged?.removeListener(listener);
  } catch {}
}

// The effective key, with `gvCtrlEnterSend` as the pre-coordinator fallback.
// It is followed while the plugin runtime is mounted.
let sendKeyHolds = 0;
let sendKeyGeneration = 0;
let sendKeyListener: StorageListener | null = null;
let sendKeyLoad: Promise<void> | null = null;
let sendKeyLoaded = false;
let effectiveSendKey: ReturnType<typeof followGeminiSendKey> | null = null;

function holdSendKey(): () => void {
  if (sendKeyHolds++ === 0) {
    effectiveSendKey = followGeminiSendKey((key) => {
      ctrlEnterSendEnabled = key === 'ctrlEnter';
    });
    sendKeyListener = (changes, areaName) => {
      if (areaName !== 'sync' || !(StorageKeys.CTRL_ENTER_SEND in changes)) return;
      ctrlEnterSettingRevision++;
      if (!effectiveSendKey?.isFollowing()) {
        ctrlEnterSendEnabled = changes[StorageKeys.CTRL_ENTER_SEND].newValue === true;
      }
    };
    addStorageListener(sendKeyListener);
    const generation = ++sendKeyGeneration;
    const revisionBeforeLoad = ctrlEnterSettingRevision;
    sendKeyLoad = loadSyncSwitch(StorageKeys.CTRL_ENTER_SEND).then((stored) => {
      // A read that lands after the last holder let go must not seed the next one.
      if (generation !== sendKeyGeneration) return;
      if (revisionBeforeLoad === ctrlEnterSettingRevision && !effectiveSendKey?.isFollowing()) {
        ctrlEnterSendEnabled = stored;
      }
      sendKeyLoaded = true;
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--sendKeyHolds > 0) return;
    removeStorageListener(sendKeyListener);
    sendKeyListener = null;
    effectiveSendKey?.stop();
    effectiveSendKey = null;
    sendKeyGeneration++;
    sendKeyLoad = null;
    sendKeyLoaded = false;
    ctrlEnterSendEnabled = false;
    ctrlEnterSettingRevision = 0;
  };
}

function setupHistoryListener(): void {
  if (historyListener) return;
  historyListener = (changes, areaName) => {
    if (areaName !== 'local' || !panelOpen) return;
    void resolveCurrentAccountScope()
      .then(({ accountScope, identity }) => {
        if (!panelOpen || identity !== getCurrentAccountIdentity().identity) return;
        if (
          Object.keys(changes).some((key) => isPromptHistoryStorageKeyForAccount(key, accountScope))
        ) {
          renderHistoryList();
        }
      })
      .catch(reportStorageError);
  };
  addStorageListener(historyListener);
}

function teardownHistoryListener(): void {
  removeStorageListener(historyListener);
  historyListener = null;
}

/** The one running prompt-history runtime, owned by its plugin scope. */
let activeRuntime: object | null = null;

/**
 * Prompt history without its switch: capture, panel and route watching run
 * until `signal` aborts. PluginHost owns `gvPromptHistoryEnabled`.
 * Capture starts once the send key is known. Stopping removes listeners and UI and never
 * touches stored history.
 */
export function startPromptHistoryRuntime({ signal }: { signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (activeRuntime) {
    logger.error('Prompt history runtime is already running; the second start is ignored');
    return Promise.resolve();
  }
  const run = {};
  activeRuntime = run;
  const releaseSendKey = holdSendKey();
  let started = false;

  signal.addEventListener(
    'abort',
    () => {
      if (activeRuntime !== run) return;
      activeRuntime = null;
      if (started) {
        disableFeature();
        stopRouteWatcher?.();
        stopRouteWatcher = null;
        teardownHistoryListener();
      }
      notices.clear();
      releaseSendKey();
    },
    { once: true },
  );

  const begin = (): void => {
    // Stopped while the send key was still loading: nothing may attach.
    if (activeRuntime !== run) return;
    started = true;
    setupHistoryListener();
    startUrlWatcher();
    enableFeature();
  };
  if (sendKeyLoaded) {
    begin();
    return Promise.resolve();
  }
  return (sendKeyLoad ?? Promise.resolve()).then(begin);
}
