/**
 * How other content modules open the Voyager panel (Prompt Manager's `/` menu,
 * Create mode's reply controls): the running shell provides the opener for as
 * long as it lives.
 */
type Opener = () => void;

function createPanelOpener() {
  let current: Opener | null = null;
  let reviews = 0;
  const reviewListeners = new Set<() => void>();
  return {
    /** Returns the cleanup; only the provider that is current clears it. */
    provide(open: Opener): () => void {
      current = open;
      return () => {
        if (current === open) current = null;
      };
    },
    available(): boolean {
      return current !== null;
    },
    /** Opens the panel; false when no shell runs on this page. */
    open(): boolean {
      if (!current) return false;
      current();
      return true;
    },
    /**
     * Opens the panel on Create mode's review. The count travels in the panel's
     * context (`PanelContext.creationRequest`), so an open panel hears it too.
     */
    openReview(): boolean {
      if (!current) return false;
      reviews += 1;
      for (const listener of Array.from(reviewListeners)) listener();
      current();
      return true;
    },
    reviewRequests(): number {
      return reviews;
    },
    onReviewRequest(listener: () => void): () => void {
      reviewListeners.add(listener);
      return () => reviewListeners.delete(listener);
    },
  };
}

export const voyagerPanelOpener = createPanelOpener();
