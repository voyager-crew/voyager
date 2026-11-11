import type { CreationReviewCandidate } from '@/features/plugins/local/creation/messages';

/** A pick the panel has not fetched by then is stale: the panel never opened. */
export const PENDING_REVIEW_TTL_MS = 60_000;

export interface PendingReview {
  put(candidate: CreationReviewCandidate): void;
  /** The last pick, once; null when none is waiting or it went stale. */
  take(): CreationReviewCandidate | null;
}

/** The reply block the user chose on the page, held for the panel to fetch through the relay. */
export function createPendingReview(now: () => number = Date.now): PendingReview {
  let held: { candidate: CreationReviewCandidate; at: number } | null = null;
  return {
    put(candidate) {
      held = { candidate, at: now() };
    },
    take() {
      const current = held;
      held = null;
      return current && now() - current.at <= PENDING_REVIEW_TTL_MS ? current.candidate : null;
    },
  };
}
