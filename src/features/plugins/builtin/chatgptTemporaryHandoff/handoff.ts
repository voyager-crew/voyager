import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';

import {
  currentComposer,
  deliverOnce,
  findComposer,
  hasAttachmentPreview,
  isDeliveryComplete,
  isInternalComposerWrite,
  readComposerText,
} from './composerDelivery';
import type { HandoffDelivery } from './handoffPlan';
import { abortError, wait } from './handoffWait';
import {
  discardPendingHandoff,
  hasDeliveredPendingHandoff,
  markPendingDelivered,
  type PendingHandoff,
  readAccountScope,
  readHandoffRoute,
  readPending,
  writePending,
} from './pendingHandoff';
import { CHATGPT_NEW_CHAT_SELECTOR, CHATGPT_TEMP_TOGGLE_SELECTOR } from './selectors';
import { PENDING_HANDOFF_TTL_MS } from './storage';

export type HandoffResult =
  | 'ready'
  | 'leave-failed'
  | 'composer-missing'
  | 'delivery-failed'
  | 'storage-failed'
  | 'account-mismatch';

export type PendingHandoffResult = 'ready' | 'delivery-failed' | 'account-mismatch' | null;

let activeHandoffOperations = 0;
let internalNavigationClicks = 0;
let pageUnloading = false;
let recoveryCancellationRevision = 0;

export function markHandoffPageUnloading(): void {
  pageUnloading = true;
}

export function markHandoffPageActive(): void {
  pageUnloading = false;
}

export function isHandoffPageUnloading(): boolean {
  return pageUnloading;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isTemporaryChat(): boolean {
  try {
    if (new URL(location.href).searchParams.get('temporary-chat') === 'true') return true;
  } catch {
    // A malformed host URL is not evidence of temporary mode.
  }
  const toggle = document.querySelector<HTMLElement>(CHATGPT_TEMP_TOGGLE_SELECTOR);
  if (!toggle) return false;
  const label =
    `${toggle.getAttribute('aria-label') || ''} ${toggle.textContent || ''}`.toLowerCase();
  const pressed = toggle.getAttribute('aria-pressed');
  return (
    pressed === 'true' || chatgptPageData.temporaryOffLabels.some((text) => label.includes(text))
  );
}

export function getChatGptNewChatPath(): string {
  try {
    const pathname = new URL(location.href).pathname;
    const customGpt = /^(\/u\/[^/]+)?\/g\/([^/]+)/.exec(pathname);
    if (customGpt) return `${customGpt[1] || ''}/g/${customGpt[2]}/`;
    const accountPrefix = /^\/u\/[^/]+/.exec(pathname)?.[0];
    return accountPrefix ? `${accountPrefix}/` : '/';
  } catch {
    return '/';
  }
}

export function discardDeliveredPendingHandoff(): void {
  if (!hasDeliveredPendingHandoff()) return;
  cancelPendingHandoffRecovery();
}

// Cancel synchronously so late storage or attachment work cannot restore an edited draft.
// Only our own synchronous writes/navigation clicks may suppress cancellation.
export function cancelPendingHandoffRecovery(): void {
  if (internalNavigationClicks > 0 || isInternalComposerWrite()) return;
  recoveryCancellationRevision += 1;
  if (activeHandoffOperations === 0) void discardPendingHandoff();
}

function clickForHandoffNavigation(target: HTMLElement): void {
  internalNavigationClicks += 1;
  try {
    target.click();
  } finally {
    internalNavigationClicks -= 1;
  }
}

// ChatGPT can reuse the composer; normal-mode readiness does not require a replacement node.
async function waitForNormalComposer(
  scope: PluginScope,
  attempts: number,
): Promise<HTMLElement | null> {
  let previous: HTMLElement | null = null;
  let stableChecks = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isTemporaryChat()) {
      const composer = currentComposer();
      stableChecks = composer && composer === previous ? stableChecks + 1 : composer ? 1 : 0;
      previous = composer;
      if (composer && stableChecks >= 3) return composer;
    } else {
      previous = null;
      stableChecks = 0;
    }
    await wait(scope, 100);
  }
  return null;
}

export async function leaveTemporaryChat(scope: PluginScope): Promise<HTMLElement | null> {
  const toggle = document.querySelector<HTMLElement>(CHATGPT_TEMP_TOGGLE_SELECTOR);
  if (toggle) {
    clickForHandoffNavigation(toggle);
    const composer = await waitForNormalComposer(scope, 16);
    if (composer) return composer;
  }

  const newChat = document.querySelector<HTMLElement>(CHATGPT_NEW_CHAT_SELECTOR);
  const newChatPath = getChatGptNewChatPath();
  if (newChat && newChatPath === '/') clickForHandoffNavigation(newChat);
  else location.assign(newChatPath);

  return await waitForNormalComposer(scope, 30);
}

export async function handoffTemporaryChat(
  scope: PluginScope,
  delivery: HandoffDelivery,
  preservedDraft?: string,
): Promise<HandoffResult> {
  activeHandoffOperations += 1;
  const cancellationRevisionAtStart = recoveryCancellationRevision;
  const handoffWasCancelled = (): boolean =>
    cancellationRevisionAtStart !== recoveryCancellationRevision;
  let abortedByPageUnload = scope.signal.aborted && isHandoffPageUnloading();
  const rememberAbortReason = (): void => {
    abortedByPageUnload = isHandoffPageUnloading();
  };
  scope.signal.addEventListener('abort', rememberAbortReason, { once: true });
  try {
    const accountScope = readAccountScope();
    const temporaryComposer = currentComposer();
    const composerDraft =
      preservedDraft ?? (temporaryComposer ? readComposerText(temporaryComposer) : '');
    const pendingDraft = composerDraft.trim() ? composerDraft : undefined;
    let pending: PendingHandoff;
    try {
      pending = await writePending(delivery, accountScope, pendingDraft);
    } catch {
      return 'storage-failed';
    }
    if (handoffWasCancelled()) throw abortError();
    if (scope.signal.aborted) throw abortError();
    const input = await leaveTemporaryChat(scope);
    if (handoffWasCancelled()) throw abortError();
    if (!input) {
      if (!isTemporaryChat()) return 'composer-missing';
      await discardPendingHandoff();
      return 'leave-failed';
    }
    if (readAccountScope() !== accountScope) {
      await discardPendingHandoff();
      return 'account-mismatch';
    }
    if (scope.signal.aborted) throw abortError();
    const deliveredInput = await deliverOnce(
      scope,
      input,
      delivery,
      pendingDraft,
      handoffWasCancelled,
    );
    if (handoffWasCancelled()) throw abortError();
    if (!deliveredInput || !isDeliveryComplete(deliveredInput, delivery, pendingDraft)) {
      return 'delivery-failed';
    }
    await markPendingDelivered(pending);
    if (handoffWasCancelled()) throw abortError();
    return 'ready';
  } catch (error) {
    if (isAbortError(error) && !abortedByPageUnload) await discardPendingHandoff();
    throw error;
  } finally {
    scope.signal.removeEventListener('abort', rememberAbortReason);
    activeHandoffOperations -= 1;
  }
}

export async function pendingAttachmentPreviewReady(): Promise<boolean> {
  const pending = await readPending();
  if (!pending || pending.delivery.mode !== 'attachment' || isTemporaryChat()) return false;
  const input = currentComposer();
  return !!input && hasAttachmentPreview(input, pending.delivery.filename);
}

export async function resumePendingHandoff(scope: PluginScope): Promise<PendingHandoffResult> {
  const recoveryRevisionAtStart = recoveryCancellationRevision;
  const recoveryWasCancelled = (): boolean =>
    recoveryRevisionAtStart !== recoveryCancellationRevision;
  let abortedByPageUnload = scope.signal.aborted && isHandoffPageUnloading();
  const rememberAbortReason = (): void => {
    abortedByPageUnload = isHandoffPageUnloading();
  };
  scope.signal.addEventListener('abort', rememberAbortReason, { once: true });
  try {
    while (activeHandoffOperations > 0) {
      if (scope.signal.aborted) throw abortError();
      if (recoveryWasCancelled()) return null;
      await wait(scope, 120);
    }
    if (scope.signal.aborted) throw abortError();
    if (recoveryWasCancelled()) return null;
    const pending = await readPending();
    if (recoveryWasCancelled()) return null;
    if (!pending) return null;
    if (
      Date.now() - pending.storedAt > PENDING_HANDOFF_TTL_MS ||
      pending.storedAt > Date.now() + 5_000
    ) {
      await discardPendingHandoff();
      return null;
    }
    if (pending.accountScope !== readAccountScope()) {
      await discardPendingHandoff();
      return 'account-mismatch';
    }
    // Delivered recovery stays on its original route so another chat never receives the transcript.
    if (pending.deliveredRoute && pending.deliveredRoute !== readHandoffRoute()) {
      await discardPendingHandoff();
      return null;
    }
    if (isTemporaryChat()) return null;
    const input = await findComposer(scope, 6_000);
    if (recoveryWasCancelled()) return null;
    if (!input) return null;
    if (pending.deliveredRoute && isDeliveryComplete(input, pending.delivery, pending.draft)) {
      return null;
    }
    if (scope.signal.aborted) throw abortError();
    if (recoveryWasCancelled()) return null;
    const deliveredInput = await deliverOnce(
      scope,
      input,
      pending.delivery,
      pending.draft,
      recoveryWasCancelled,
    );
    if (recoveryWasCancelled()) return null;
    if (!deliveredInput || !isDeliveryComplete(deliveredInput, pending.delivery, pending.draft)) {
      return 'delivery-failed';
    }
    await markPendingDelivered(pending);
    return pending.deliveredRoute ? null : 'ready';
  } catch (error) {
    if (isAbortError(error) && !abortedByPageUnload) await discardPendingHandoff();
    throw error;
  } finally {
    scope.signal.removeEventListener('abort', rememberAbortReason);
  }
}
