export interface ResponseCompletionSnapshot {
  conversationKey: string;
  /** The run's session epoch; it changes whenever the page leaves the conversation. */
  sessionEpoch: number;
  hasCompletedResponse: boolean;
  isGenerating: boolean;
  responseFingerprint: string | null;
  now: number;
}

export type ResponseCompletionDecision =
  | { type: 'none' }
  | {
      type: 'notify';
      conversationKey: string;
      responseFingerprint: string;
    };

const DEFAULT_STABLE_WINDOW_MS = 1500;

export class ResponseCompletionDetector {
  /** Session epoch the observed generation belongs to; null until one is seen. */
  private generationEpoch: number | null = null;
  private candidateFingerprint: string | null = null;
  private candidateSince = 0;
  private readonly notifiedKeys = new Set<string>();

  constructor(private readonly stableWindowMs: number = DEFAULT_STABLE_WINDOW_MS) {}

  reset(): void {
    this.generationEpoch = null;
    this.candidateFingerprint = null;
    this.candidateSince = 0;
  }

  getPendingEvaluationDelay(now: number): number | null {
    if (this.candidateFingerprint === null) return null;
    const remaining = this.stableWindowMs - (now - this.candidateSince);
    return remaining > 0 ? remaining : null;
  }

  update(snapshot: ResponseCompletionSnapshot): ResponseCompletionDecision {
    if (snapshot.isGenerating) {
      this.generationEpoch = snapshot.sessionEpoch;
      this.candidateFingerprint = null;
      this.candidateSince = 0;
      return { type: 'none' };
    }

    if (!this.ownsGeneration(snapshot)) {
      // A generation seen in another session must not finish in this one.
      this.reset();
      return { type: 'none' };
    }

    if (!snapshot.hasCompletedResponse || !snapshot.responseFingerprint) {
      this.candidateFingerprint = null;
      this.candidateSince = 0;
      return { type: 'none' };
    }

    if (snapshot.responseFingerprint !== this.candidateFingerprint) {
      this.candidateFingerprint = snapshot.responseFingerprint;
      this.candidateSince = snapshot.now;
      return { type: 'none' };
    }

    if (snapshot.now - this.candidateSince < this.stableWindowMs) {
      return { type: 'none' };
    }

    return this.notifyOnce(snapshot);
  }

  private ownsGeneration(snapshot: ResponseCompletionSnapshot): boolean {
    return this.generationEpoch !== null && this.generationEpoch === snapshot.sessionEpoch;
  }

  private notifyOnce(snapshot: ResponseCompletionSnapshot): ResponseCompletionDecision {
    const responseFingerprint = snapshot.responseFingerprint;
    if (!responseFingerprint) return { type: 'none' };

    const notificationKey = `${snapshot.conversationKey}|${responseFingerprint}`;
    if (this.notifiedKeys.has(notificationKey)) {
      return { type: 'none' };
    }

    this.notifiedKeys.add(notificationKey);
    this.reset();
    return {
      type: 'notify',
      conversationKey: snapshot.conversationKey,
      responseFingerprint,
    };
  }
}
