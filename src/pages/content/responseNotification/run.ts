import { detectAccountContextFromDocument } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { shouldNotifyForBackgroundCompletion } from '@/features/plugins/responseNotification/completionDelivery';
import { createResponseNotificationCore } from '@/features/plugins/responseNotification/core';

import type { StopNativeFeature } from '../featureLifecycle';
import { watchRouteChanges } from '../utils/routeWatcher';
import { FirstSendIdentity } from './firstSendIdentity';
import { injectPageObserver } from './pageObserverInjection';
import {
  getConversationTitle,
  getAssistantResponses,
  getUserPromptElements,
  getLatestUserPromptSnapshot,
  getLatestAssistantResponse,
  getLatestUserPrompt,
  hasCompletionActions,
  hasGeneratingIndicator,
  isPromptInteractionTarget,
  normalizePromptIdentity,
} from './pageSnapshot';
import {
  type ConversationSession,
  compareSessions,
  readConversationSession,
  sessionKey,
} from './sessionIdentity';

const LOG_PREFIX = '[ResponseNotification]';
const PAGE_OBSERVER_SOURCE = 'gemini-voyager-response-complete-observer';
const EVALUATE_DEBOUNCE_MS = 250;
const STARTUP_DELAY_MS = 1000;

/** The conversation and signed-in account the page shows now. */
function readPageSession(): ConversationSession {
  return readConversationSession(
    location.href,
    detectAccountContextFromDocument(location.href, document).email,
  );
}

type PageObserverMessage = {
  source?: string;
  type?: string;
  payload?: {
    requestId?: number;
    duration?: number;
    shouldNotify?: boolean;
    outcome?: 'success' | 'failed' | 'cancelled';
    prompt?: string;
    conversationId?: string;
    pageUrl?: string;
  };
} | null;

/** One generation and the delivery of its reply. */
interface Generation {
  /** `network`: a request the page observer saw start; `page`: one only the page shows. */
  readonly owner: 'network' | 'page';
  /** The user turns on the page when delivery left `streaming`; null while it streams. */
  turnsAtEnd: HTMLElement[] | null;
}

interface PendingRequest {
  epoch: number;
  previousPrompts: HTMLElement[];
  protocolPrompt: string;
  prompt?: string;
}

export interface ResponseNotificationRunOptions {
  /** Aborting it stops the run, like calling `stop`. */
  readonly signal?: AbortSignal;
}

export interface ResponseNotificationRun {
  /** Synchronous and idempotent; an initial read still in flight then starts nothing. */
  readonly stop: StopNativeFeature;
  /** Settles once the initial setting read has been applied (or skipped). */
  readonly ready: Promise<void>;
}

/** Owns one run; session epochs drop stale work and first addresses need fresh DOM evidence. */
export function createResponseNotificationRun(
  options: ResponseNotificationRunOptions = {},
): ResponseNotificationRun {
  const { signal } = options;
  if (signal?.aborted) return { stop: () => {}, ready: Promise.resolve() };

  let alive = true;
  let enabled = false;
  let liveRevision = 0;
  let observer: MutationObserver | null = null;
  let stopRouteWatch: (() => void) | null = null;
  let startupTimer: number | null = null;
  let session: ConversationSession = readPageSession();
  // Bumped on every session switch and every observer stop: work captured
  // under an older epoch must not act on the page any more.
  let epoch = 0;
  const pendingRequests = new Map<number, PendingRequest>();
  let latestRequest: PendingRequest | null = null;
  let promptsBeforeInteraction: HTMLElement[] | null = null;
  let hasPendingBackgroundCompletion = false;
  const armedSessionKeys = new Set<string>();
  const firstSend = new FirstSendIdentity();

  let generation: Generation = { owner: 'page', turnsAtEnd: null };
  const completion = createResponseNotificationCore({
    evaluate: () => evaluate(),
    getLatestReply: getLatestAssistantResponse,
    readDetails: () => ({
      userPrompt:
        firstSend.prompt ?? latestRequest?.prompt ?? (latestRequest ? '' : getLatestUserPrompt()),
      conversationTitle: firstSend.prompt !== undefined ? '' : getConversationTitle(),
    }),
    beforeFlush: () => {
      if (!enabled) return false;
      syncSession();
      syncGeneration();
      return !firstSend.awaiting;
    },
    onGenerationEnd: () => {
      generation.turnsAtEnd = getUserPromptElements();
    },
  });

  const beginGeneration = (owner: Generation['owner']): void => {
    completion.restartGeneration();
    generation = { owner, turnsAtEnd: null };
  };

  /** A user turn sent after the generation ended starts a page-only one. */
  const syncGeneration = (): void => {
    const { turnsAtEnd } = generation;
    if (!turnsAtEnd) return;
    const turns = getUserPromptElements();
    const latest = turns.at(-1);
    // Gemini re-renders an addressed chat's turns as new nodes; only an added turn is a new send.
    if (latest && turns.length > turnsAtEnd.length && !turnsAtEnd.includes(latest))
      beginGeneration('page');
  };

  const snapshot = (latestResponse: HTMLElement | null) => {
    // A hidden page never plays Gemini's typing animation, so the reply stays busy and its action
    // buttons never render although its text is complete; there the stop button alone marks writing.
    const hidden = document.visibilityState === 'hidden';
    return {
      conversationKey: `${location.pathname}${location.search}`,
      sessionEpoch: epoch,
      hasCompletedResponse: !!latestResponse && (hidden || hasCompletionActions(latestResponse)),
      isGenerating: hasGeneratingIndicator({ countTypingAnimation: !hidden }),
      reply: latestResponse,
    };
  };

  const dropSessionWork = (): void => {
    epoch += 1;
    pendingRequests.clear();
    latestRequest = null;
    promptsBeforeInteraction = null;
    hasPendingBackgroundCompletion = false;
    firstSend.clear();
    completion.reset();
    generation = { owner: 'page', turnsAtEnd: null };
  };

  const captureRequestPrompt = (): void => {
    if (!latestRequest || latestRequest.prompt !== undefined) return;
    const turn = getLatestUserPromptSnapshot();
    // Protocol text only vetoes; a fresh DOM turn proves the summary belongs to this send.
    if (
      !turn?.text ||
      latestRequest.previousPrompts.includes(turn.element) ||
      (latestRequest.protocolPrompt && latestRequest.protocolPrompt !== turn.text)
    )
      return;
    latestRequest.prompt = turn.text;
  };

  /** Every entry point checks identity before inspecting a completion on the live page. */
  const syncSession = (subsequentEvent = false): void => {
    const current = readPageSession();
    let transition = compareSessions(session, current);
    if (transition === 'addressed' && firstSend.prompt === undefined) transition = 'switched';
    const identity = firstSend.inspect(
      current.conversationId,
      getLatestUserPromptSnapshot(),
      subsequentEvent,
    );
    if (identity === 'switched') transition = 'switched';
    if (identity === 'expired') {
      firstSend.clear();
      pendingRequests.clear();
      latestRequest = null;
      hasPendingBackgroundCompletion = false;
    }
    if (transition === 'addressed' && armedSessionKeys.delete(sessionKey(session))) {
      armedSessionKeys.add(sessionKey(current));
    }
    if (transition === 'switched') {
      session = current;
      dropSessionWork();
      scheduleEvaluate();
      return;
    }
    session = { ...current, email: current.email ?? session.email };
    captureRequestPrompt();
  };

  const shouldSuppressWithoutPromptInteraction = (): boolean =>
    !armedSessionKeys.delete(sessionKey(session));

  const handlePromptInteraction = (event: Event): void => {
    if (!isPromptInteractionTarget(event.target)) return;
    syncSession();
    promptsBeforeInteraction = getUserPromptElements();
    armedSessionKeys.add(sessionKey(session));
  };

  const notifyBackgroundRequestCompletion = (): void => {
    // Matched requests are consumed once; the DOM may still contain only the previous answer.
    completion.resetDetection();
    completion.delivery.send({ type: 'completed', reply: null, background: true });
  };

  const evaluate = (): void => {
    if (!enabled) return;
    syncSession();

    if (firstSend.awaiting) return;
    if (flushPendingCompletion()) return;
    if (pendingRequests.size > 0) return;
    syncGeneration();
    const current = generation;
    // Network-owned generations must not notify from old history or late generation UI, but a
    // later page-only generation still does: a new user turn replaced it in syncGeneration.
    if (current.owner === 'network' && completion.delivery.state.status !== 'streaming') return;
    const latestResponse = getLatestAssistantResponse();
    if (latestResponse && firstSend.isOldResponse(latestResponse)) return;
    const decision = completion.observe(snapshot(latestResponse));
    if (decision.type !== 'notify') return;

    // The detector bounds page-only generations itself: another completion is another reply.
    if (completion.delivery.state.status !== 'streaming') beginGeneration('page');
    const background = shouldNotifyForBackgroundCompletion();
    if (!background && shouldSuppressWithoutPromptInteraction()) {
      completion.delivery.send({ type: 'abandoned', reason: 'unprompted' });
      return;
    }
    completion.delivery.send({ type: 'completed', reply: latestResponse, background });
  };

  function scheduleEvaluate(delay = EVALUATE_DEBOUNCE_MS): void {
    if (enabled) completion.scheduleEvaluation(delay);
  }

  function flushPendingCompletion(): boolean {
    if (firstSend.awaiting || pendingRequests.size > 0 || !hasPendingBackgroundCompletion)
      return false;
    if (shouldNotifyForBackgroundCompletion()) {
      hasPendingBackgroundCompletion = false;
      notifyBackgroundRequestCompletion();
      return true;
    }
    const response = getLatestAssistantResponse();
    if (
      !response ||
      firstSend.isOldResponse(response) ||
      !hasCompletionActions(response) ||
      hasGeneratingIndicator()
    )
      return false;
    hasPendingBackgroundCompletion = false;
    scheduleEvaluate(0);
    return true;
  }

  const handlePageObserverMessage = (event: MessageEvent): void => {
    if (!enabled || event.source !== window) return;
    const data = event.data as PageObserverMessage;
    if (!data || data.source !== PAGE_OBSERVER_SOURCE) return;
    const requestId = data.payload?.requestId;
    if (typeof requestId !== 'number') return;

    if (data.type === 'request-start') {
      const source =
        typeof data.payload?.pageUrl === 'string'
          ? readConversationSession(data.payload.pageUrl, session.email)
          : session;
      syncSession();
      const transition = compareSessions(source, readPageSession());
      if (transition === 'switched') return;
      // An unresolved first send must not swallow later requests after address assignment.
      if (firstSend.awaiting) {
        if (!session.conversationId) return;
        dropSessionWork();
      }
      latestRequest = {
        epoch,
        previousPrompts: promptsBeforeInteraction ?? getUserPromptElements(),
        protocolPrompt: normalizePromptIdentity(data.payload?.prompt ?? ''),
      };
      promptsBeforeInteraction = null;
      pendingRequests.set(requestId, latestRequest);
      hasPendingBackgroundCompletion = false;
      beginGeneration('network');
      firstSend.clear();
      captureRequestPrompt();
      if (source.conversationId === null) {
        firstSend.start({
          requestId,
          sourcePrompt:
            readPageSession().conversationId === null
              ? (getLatestUserPromptSnapshot()?.text ?? '')
              : '',
          protocolPrompt: data.payload?.prompt,
          previousPrompts: getUserPromptElements(),
          previousResponses: getAssistantResponses(),
        });
        session = source;
        syncSession();
      }
      completion.observe({
        conversationKey: `${location.pathname}${location.search}`,
        sessionEpoch: epoch,
        hasCompletedResponse: false,
        isGenerating: true,
        reply: null,
      });
      return;
    }
    if (data.type !== 'request-complete') return;
    const request = pendingRequests.get(requestId);
    if (!request || request.epoch !== epoch) return;
    if (data.payload?.outcome === 'success')
      firstSend.complete(requestId, data.payload?.conversationId);
    syncSession();
    if (request.epoch !== epoch) return;
    pendingRequests.delete(requestId);
    if (request === latestRequest) {
      if (data.payload?.outcome !== 'success') {
        // Failed/aborted streams must not finish later through stale DOM completion controls.
        hasPendingBackgroundCompletion = false;
        completion.delivery.send({ type: 'abandoned', reason: 'failed' });
        completion.resetDetection();
        firstSend.clear();
        completion.clearEvaluation();
        return;
      }
      hasPendingBackgroundCompletion = data.payload?.shouldNotify === true;
    }
    flushPendingCompletion();
  };

  const startObserver = (): void => {
    if (observer || !document.body) return;

    session = readPageSession();
    injectPageObserver();
    window.addEventListener('message', handlePageObserverMessage);
    document.addEventListener('input', handlePromptInteraction, true);
    document.addEventListener('keydown', handlePromptInteraction, true);
    stopRouteWatch = watchRouteChanges(() => {
      syncSession(true);
      // Address assignment may be the final evidence, with no further DOM mutation to flush it.
      flushPendingCompletion();
      scheduleEvaluate();
    });
    observer = new MutationObserver(() => {
      // The prompt may render after its request starts; evaluation waits for a quiet page.
      syncSession(true);
      flushPendingCompletion();
      scheduleEvaluate();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'aria-label', 'data-test-id', 'class'],
    });
    scheduleEvaluate(STARTUP_DELAY_MS);
  };

  const stopObserver = (): void => {
    window.removeEventListener('message', handlePageObserverMessage);
    document.removeEventListener('input', handlePromptInteraction, true);
    document.removeEventListener('keydown', handlePromptInteraction, true);
    stopRouteWatch?.();
    stopRouteWatch = null;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (startupTimer !== null) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    dropSessionWork();
  };

  const reconcile = (): void => {
    if (!enabled) {
      stopObserver();
      return;
    }
    if (document.body) {
      startObserver();
      return;
    }
    if (startupTimer === null) {
      startupTimer = window.setTimeout(() => {
        startupTimer = null;
        reconcile();
      }, EVALUATE_DEBOUNCE_MS);
    }
  };

  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (!alive || areaName !== 'sync') return;
    const change = changes[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED];
    if (!change) return;

    liveRevision += 1;
    enabled = change.newValue === true;
    reconcile();
  };

  const stop = (): void => {
    if (!alive) return;
    alive = false;
    enabled = false;
    signal?.removeEventListener('abort', stop);
    stopObserver();
    completion.stop();
    try {
      chrome.storage?.onChanged?.removeListener(storageListener);
    } catch {}
  };

  try {
    chrome.storage?.onChanged?.addListener(storageListener);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn(LOG_PREFIX, 'Failed to attach storage listener:', error);
    }
  }
  signal?.addEventListener('abort', stop, { once: true });

  const loadEnabledSetting = async (): Promise<void> => {
    const readRevision = liveRevision;
    try {
      const result = await chrome.storage?.sync?.get({
        [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
      });
      if (!alive) return;
      // A toggle made while the read was in flight is newer than the read.
      if (liveRevision !== readRevision) return;
      enabled = result?.[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] === true;
      reconcile();
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return;
      console.warn(LOG_PREFIX, 'Failed to load setting:', error);
    }
  };

  return { stop, ready: loadEnabledSetting() };
}
