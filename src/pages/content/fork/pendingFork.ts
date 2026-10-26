import browser from 'webextension-polyfill';

import { createToaster } from '@/core/ui/toast/toaster';

import { getTranslationSync } from '../../../utils/i18n';
import { setInputText } from '../utils/inputHelper';
import { createForkComposerRead } from './forkComposer';
import { PENDING_FORK_KEY, type PendingForkData, type PendingForkMode } from './forkLaunch';
import { handoffPendingForkLink, type ForkLinkReceipt } from './linkFinisher';
import {
  captureForkReceiver,
  isCurrentForkReceiver,
  isForkSourceAccount,
} from './receiverIdentity';

const UPLOAD_HINT_CHANNEL = 'fork-upload';

function formatTranslation(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [key, value]) => {
    return result.split(`{${key}}`).join(value);
  }, template);
}

export function startPendingFork({
  getConversationId,
  getConversationTitle,
  onLinked,
}: {
  getConversationId: () => string | null;
  getConversationTitle: () => string;
  onLinked: () => Promise<void>;
}): () => void {
  // Each run owns its hint, countdown and waits: an older run cleaning up late must
  // never close the upload hint a newer run is showing.
  const { find: findInput, hasRemote } = createForkComposerRead();
  let stopped = false;
  const receiver = captureForkReceiver();
  let receipt: ForkLinkReceipt | null = null;
  const isCurrent = () => !stopped && receiver !== null && isCurrentForkReceiver(receiver);
  const uploadHints = createToaster();
  let manualUploadCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveRetry: (() => void) | null = null;
  const pendingWaits = new Set<() => void>();

  function stopCountdown(): void {
    if (manualUploadCountdownTimer) {
      clearInterval(manualUploadCountdownTimer);
      manualUploadCountdownTimer = null;
    }
  }

  function clearManualUploadHint(): void {
    stopCountdown();
    uploadHints.dismiss(UPLOAD_HINT_CHANNEL);
  }

  const PENDING_FORK_PASTE_STALE_MS = 60000;
  const PENDING_FORK_FILE_UPLOAD_STALE_MS = 120000;

  function getPendingForkTtl(mode: PendingForkMode): number {
    return mode === 'fileUpload' ? PENDING_FORK_FILE_UPLOAD_STALE_MS : PENDING_FORK_PASTE_STALE_MS;
  }

  function getPendingForkRemainingMs(pendingFork: PendingForkData): number {
    const createdAt = pendingFork.createdAt ?? Date.now();
    return Math.max(0, createdAt + getPendingForkTtl(pendingFork.mode) - Date.now());
  }

  function formatCountdown(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function getInputText(input: HTMLElement): string {
    return input instanceof HTMLTextAreaElement ? input.value : (input.textContent ?? '');
  }

  function buildManualUploadPrompt(pendingFork: PendingForkData): string {
    return formatTranslation(getTranslationSync('forkManualUploadPrompt'), {
      filename: pendingFork.filename || 'MD',
    });
  }

  async function readPendingFork(): Promise<PendingForkData | null> {
    try {
      const result = await browser.storage.local.get(PENDING_FORK_KEY);
      // Account headers can change while storage waits: never consume another page's handoff.
      if (!isCurrent()) return null;
      const parsed = result[PENDING_FORK_KEY] as Partial<PendingForkData> | undefined;
      if (!parsed || !receiver || !isForkSourceAccount(receiver, parsed.sourceUrl || ''))
        return null;
      const mode: PendingForkMode = parsed.mode === 'fileUpload' ? 'fileUpload' : 'paste';

      // Discard stale data (e.g. from a previous failed fork)
      if (parsed.createdAt && Date.now() - parsed.createdAt > getPendingForkTtl(mode)) {
        await browser.storage.local.remove(PENDING_FORK_KEY);
        return null;
      }

      const pendingFork: PendingForkData = {
        sourceConversationId: parsed.sourceConversationId || '',
        sourceTurnId: parsed.sourceTurnId || '',
        sourceUrl: parsed.sourceUrl || '',
        sourceTitle: parsed.sourceTitle || '',
        forkGroupId: parsed.forkGroupId || '',
        sourceForkIndex: Number.isFinite(parsed.sourceForkIndex) ? parsed.sourceForkIndex! : 0,
        nextForkIndex: Number.isFinite(parsed.nextForkIndex) ? parsed.nextForkIndex! : 1,
        markdown: parsed.markdown || '',
        mode,
        filename: typeof parsed.filename === 'string' ? parsed.filename : undefined,
        createdAt: parsed.createdAt ?? Date.now(),
      };

      if (
        !pendingFork.sourceConversationId ||
        !pendingFork.sourceTurnId ||
        !pendingFork.forkGroupId ||
        !pendingFork.markdown.trim()
      ) {
        await browser.storage.local.remove(PENDING_FORK_KEY);
        return null;
      }

      return pendingFork;
    } catch {
      return null;
    }
  }

  function checkAndHandlePendingFork(): void {
    // Only handle on a new conversation page (no conversation ID yet)
    const currentConvId = getConversationId();
    if (currentConvId || !isCurrent()) return;

    // Clean up legacy sessionStorage data (from versions before this fix)
    try {
      sessionStorage.removeItem(PENDING_FORK_KEY);
    } catch {
      // Ignore
    }

    void handlePendingForkFromStorage();
  }

  async function handlePendingForkFromStorage(): Promise<void> {
    // The opener tab writes to storage.local after async work, which may take a moment.
    // Try immediately, then retry once after a short delay.
    let pendingFork = await readPendingFork();
    if (!pendingFork && isCurrent()) {
      await new Promise<void>((resolve) => {
        resolveRetry = resolve;
        retryTimer = setTimeout(resolve, 2000);
      });
      retryTimer = null;
      resolveRetry = null;
      if (!isCurrent()) return;
      pendingFork = await readPendingFork();
    }
    if (!pendingFork || !isCurrent()) return;

    // Clear immediately so other tabs don't pick it up
    try {
      await browser.storage.local.remove(PENDING_FORK_KEY);
    } catch {
      // Ignore
    }

    // Taken but not handed off yet: a stopped run drops it rather than paste into a page
    // whose fork feature is off.
    if (!isCurrent()) return;

    // Re-check: still on a new conversation page?
    if (getConversationId()) return;

    const remainingMs = getPendingForkRemainingMs(pendingFork);
    if (remainingMs <= 0) return;

    if (pendingFork.mode === 'fileUpload') {
      showManualUploadHint(pendingFork, remainingMs);
      handoff(pendingFork);
      void prefillManualUploadPrompt(pendingFork);
      return;
    }

    // Wait for the input field to be available
    const input = await waitForInput(10000);
    if (!isCurrent() || getPendingForkRemainingMs(pendingFork) <= 0) return;
    if (!input?.isConnected || (hasRemote && findInput() !== input)) {
      console.warn('[Fork] Input field not found');
      return;
    }

    setInputText(input, pendingFork.markdown);

    handoff(pendingFork);
  }

  async function prefillManualUploadPrompt(pendingFork: PendingForkData): Promise<void> {
    const input = await waitForInput(10000);
    if (
      !isCurrent() ||
      !receipt?.canPrefill() ||
      !input?.isConnected ||
      (hasRemote && findInput() !== input) ||
      getInputText(input).trim()
    )
      return;
    setInputText(input, buildManualUploadPrompt(pendingFork));
  }

  function showManualUploadHint(pendingFork: PendingForkData, remainingMs: number): void {
    clearManualUploadHint();
    const hint = uploadHints.show({
      channel: UPLOAD_HINT_CHANNEL,
      message: formatTranslation(getTranslationSync('forkManualUploadHint'), {
        filename: pendingFork.filename || 'MD',
      }),
      detail: formatCountdown(remainingMs),
      // Sticky, so other toasts never evict it; the countdown closes it at the TTL.
      durationMs: null,
      dismissLabel: getTranslationSync('pm_cancel'),
      onDismiss: stopCountdown,
    });

    const expiresAt = Date.now() + remainingMs;
    manualUploadCountdownTimer = setInterval(() => {
      const nextRemainingMs = Math.max(0, expiresAt - Date.now());
      if (nextRemainingMs <= 0 || !hint.isOpen) {
        clearManualUploadHint();
        return;
      }
      hint.update({ detail: formatCountdown(nextRemainingMs) });
    }, 1000);
  }

  function waitForInput(timeoutMs: number): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      if (!isCurrent()) {
        resolve(null);
        return;
      }
      const existing = findInput();
      if (existing) {
        resolve(existing);
        return;
      }

      let frame = 0;
      const finish = (element: HTMLElement | null) => {
        cancelAnimationFrame(frame);
        pendingWaits.delete(cancel);
        resolve(element);
      };
      const cancel = () => finish(null);
      pendingWaits.add(cancel);

      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (!isCurrent()) {
          finish(null);
          return;
        }
        const el = findInput();
        if (el) {
          finish(el);
          return;
        }
        if (Date.now() > deadline) {
          finish(null);
          return;
        }
        frame = requestAnimationFrame(check);
      };
      frame = requestAnimationFrame(check);
    });
  }

  function handoff(pendingFork: PendingForkData): void {
    if (!receiver || !isCurrent()) return;
    // The deadline belongs to the original operation, not to a delayed paste or feature restart.
    receipt = handoffPendingForkLink({
      pendingFork,
      receiver,
      deadline: (pendingFork.createdAt ?? Date.now()) + getPendingForkTtl(pendingFork.mode),
      getConversationTitle,
      onLinked,
      onFinished: clearManualUploadHint,
    });
    if (!receipt) clearManualUploadHint();
  }

  checkAndHandlePendingFork();
  // S2 is now page-owned: feature off hides its UI, while page teardown cancels its bounded wait.
  return () => {
    if (stopped) return;
    stopped = true;
    receipt?.hideUi();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    resolveRetry?.();
    resolveRetry = null;
    for (const cancel of Array.from(pendingWaits)) cancel();
    stopCountdown();
    uploadHints.destroy();
  };
}
