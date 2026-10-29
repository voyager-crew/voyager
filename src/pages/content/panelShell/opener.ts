/**
 * How other content modules open the Voyager panel (Prompt Manager's `/` menu):
 * the running shell provides the opener for as long as it lives.
 */
type Opener = () => void;

function createPanelOpener() {
  let current: Opener | null = null;
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
  };
}

export const voyagerPanelOpener = createPanelOpener();
