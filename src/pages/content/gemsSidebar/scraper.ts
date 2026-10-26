import { isGemsViewPathname, type GemMetadata } from './catalog';
import { readGemsList, type GemsListSource } from './selectorQueries';

/** Does this element (or any ancestor) carry one of our injected gv- classes? */
function isInsideGvNode(node: Node): boolean {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el) {
    for (const cls of el.classList) {
      if (cls.startsWith('gv-')) return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * True when every mutation in the batch only touches nodes we injected
 * ourselves (gv- prefixed — e.g. the pin toggles that injectPinButtons adds
 * after each scrape). Without this exemption our own injection feeds the
 * scrape observer, scheduling a pointless scrape cycle per injection. A batch
 * containing any non-gv (or indeterminate, e.g. detached text) node is NOT
 * self-inflicted — when unsure we scrape, never the other way. Pure.
 */
export function isSelfInflictedMutation(mutations: MutationRecord[]): boolean {
  return mutations.every((mutation) => {
    if (mutation.type === 'childList') {
      const nodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      return nodes.length > 0 && nodes.every(isInsideGvNode);
    }
    return isInsideGvNode(mutation.target);
  });
}

/** Owns the management-page list observer, retry and scrape debounce lifetime. */
export function createGemsScraper(
  saveCache: (items: GemMetadata[], source: GemsListSource) => Promise<void>,
  injectPins: () => Promise<void>,
) {
  let active = false;
  let scrapeObserver: MutationObserver | null = null;
  let scrapeTimer: number | null = null;
  let scrapeRetryTimer: number | null = null;
  const SCRAPE_DEBOUNCE_MS = 300;

  function scheduleScrape(): void {
    if (!active || scrapeTimer !== null) return;
    scrapeTimer = window.setTimeout(() => {
      scrapeTimer = null;
      if (!active) return;
      const read = readGemsList();
      const items = read.rows.flatMap(({ metadata }) => (metadata ? [metadata] : []));
      if (items.length === 0) return; // don't clobber cache on transient empty render
      void saveCache(items, read.source);
      // Re-inject pin buttons after the cache is updated — the scraped
      // rows may have been re-rendered or reordered by the user.
      void injectPins();
    }, SCRAPE_DEBOUNCE_MS);
  }

  function setupScrapeObserver(): void {
    if (!active || !isGemsViewPathname(location.pathname)) return;

    // Re-scrape whenever the visible gem list changes — covers reorder, rename,
    // create, delete. Cheap because we debounce + early-exit on empty matches.
    const list = readGemsList().list;
    if (!list) {
      // The list isn't mounted yet; retry shortly. Gemini's gems page lazy-loads
      // its content after a brief Angular bootstrap.
      if (scrapeRetryTimer === null) {
        scrapeRetryTimer = window.setTimeout(() => {
          scrapeRetryTimer = null;
          setupScrapeObserver();
        }, 500);
      }
      return;
    }
    if (scrapeRetryTimer !== null) {
      clearTimeout(scrapeRetryTimer);
      scrapeRetryTimer = null;
    }
    // Initial scrape (post-render).
    scheduleScrape();
    // Inject pin buttons on initial render of the gems list.
    void injectPins();

    scrapeObserver?.disconnect();
    scrapeObserver = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves (pin-button injection/toggling).
      if (isSelfInflictedMutation(mutations)) return;
      scheduleScrape();
    });
    // characterData stays on deliberately: a gem rename can land as a text-node
    // update on the existing row (no childList change), and the scraper reads
    // names via textContent. The churn cost is contained by the 300ms debounce,
    // the self-inflicted-mutation exemption above, and saveCache's
    // content-equality write skip.
    scrapeObserver.observe(list, { childList: true, subtree: true, characterData: true });
  }

  function teardownScrapeObserver(): void {
    active = false;
    if (scrapeObserver) {
      scrapeObserver.disconnect();
      scrapeObserver = null;
    }
    if (scrapeTimer !== null) {
      clearTimeout(scrapeTimer);
      scrapeTimer = null;
    }
    if (scrapeRetryTimer !== null) {
      clearTimeout(scrapeRetryTimer);
      scrapeRetryTimer = null;
    }
  }

  return {
    start() {
      active = true;
      setupScrapeObserver();
    },
    stop: teardownScrapeObserver,
  };
}
