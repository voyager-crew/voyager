import { PluginScope } from '../runtime/pluginScope';
import {
  createResponseFingerprinter,
  sendCompletionNotification,
  shouldNotifyForBackgroundCompletion,
} from './completionDelivery';
import { completionEffects, startCompletion } from './completionMachine';
import { ResponseCompletionDetector, type ResponseCompletionSnapshot } from './detector';
import { createForegroundCompletionToast } from './foregroundCompletionToast';

interface ResponseNotificationSite {
  /** Site-specific detection; scheduled once even if the page keeps mutating. */
  evaluate(): void;
  getLatestReply(): HTMLElement | null;
  readDetails(reply: HTMLElement | null): Parameters<typeof sendCompletionNotification>[0];
  /** Resync identity first; this can retire the delivery whose fallback is being checked. */
  beforeFlush(): boolean;
  onGenerationEnd?(): void;
}

type CompletionObservation = Omit<ResponseCompletionSnapshot, 'now' | 'responseFingerprint'> & {
  readonly reply: HTMLElement | null;
};

/** Shared delivery, dedupe and evaluation lifetime; each site supplies completion evidence. */
export function createResponseNotificationCore(site: ResponseNotificationSite) {
  const scope = new PluginScope();
  const detector = new ResponseCompletionDetector();
  const fingerprint = createResponseFingerprinter();
  let evaluateTimer: number | null = null;
  let evaluateDueAt = 0;
  let latestCompletedReply: HTMLElement | null = null;
  const toast = createForegroundCompletionToast({
    getScrollTarget: () => latestCompletedReply ?? site.getLatestReply(),
  });
  const effects = completionEffects({
    notify: (reply) => sendCompletionNotification(site.readDetails(reply)),
    showToast: (reply) => {
      latestCompletedReply = reply ?? site.getLatestReply();
      toast.showIfNeeded(latestCompletedReply);
    },
    canFlush: () => site.beforeFlush() && !shouldNotifyForBackgroundCompletion(),
  });
  const startGeneration = () => {
    const delivery = startCompletion(effects);
    delivery.subscribe((_state, previous) => {
      if (previous.status === 'streaming') site.onGenerationEnd?.();
    });
    return delivery;
  };
  let delivery = startGeneration();

  const clearEvaluation = (): void => {
    if (evaluateTimer === null) return;
    clearTimeout(evaluateTimer);
    evaluateTimer = null;
  };
  const scheduleEvaluation = (delay = 250): void => {
    if (scope.isDisposed) return;
    const dueAt = Date.now() + delay;
    // Streaming and animation mutations must not postpone an earlier check indefinitely.
    if (evaluateTimer !== null && evaluateDueAt <= dueAt) return;
    clearEvaluation();
    evaluateDueAt = dueAt;
    evaluateTimer = window.setTimeout(() => {
      evaluateTimer = null;
      site.evaluate();
    }, delay);
  };

  const restartGeneration = (): void => {
    void delivery.stop();
    delivery = startGeneration();
  };
  const reset = (): void => {
    clearEvaluation();
    detector.reset();
    toast.stop();
    latestCompletedReply = null;
    restartGeneration();
  };
  scope.effect(() => () => {
    clearEvaluation();
    detector.reset();
    toast.stop();
    return delivery.stop();
  });

  return {
    get delivery() {
      return delivery;
    },
    restartGeneration,
    scheduleEvaluation,
    clearEvaluation,
    reset,
    resetDetection: () => detector.reset(),
    observe({ reply, ...snapshot }: CompletionObservation) {
      const now = Date.now();
      const decision = detector.update({
        ...snapshot,
        responseFingerprint: reply ? fingerprint(reply) : null,
        now,
      });
      // A completed page may go quiet before its stability window ends.
      const pendingDelay = detector.getPendingEvaluationDelay(now);
      if (pendingDelay !== null) scheduleEvaluation(pendingDelay);
      return decision;
    },
    stop: (): void => {
      void scope.dispose();
    },
  };
}
