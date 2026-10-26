import { getBundledGeminiSelectorView, getGeminiSelectorView } from '@/core/gemini/selectors';
import { acceptsGeminiSidebarScroller } from '@/core/gemini/sidebar/proof';
import {
  geminiSidebarSelector,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

/** A scoped read; the pagination protocol and timers below remain packaged. */
function findNativeListScroller(row: HTMLElement): HTMLElement | null {
  return resolveGeminiSidebarOperation(
    (view) => {
      const candidate = row.closest(geminiSidebarSelector('sidebar.scroller', view));
      if (view.remoteKeys.has('sidebar.scroller')) {
        const original = row.closest<HTMLElement>(
          geminiSidebarSelector('sidebar.scroller', getBundledGeminiSelectorView()),
        );
        if (
          !acceptsGeminiSidebarScroller(
            row,
            candidate instanceof HTMLElement ? candidate : null,
            original,
          )
        )
          return null;
      }
      return candidate instanceof HTMLElement &&
        candidate !== document.body &&
        candidate !== document.documentElement
        ? candidate
        : null;
    },
    (scroller) => scroller !== null,
  ).value;
}

// Gemini asks for the next Recents page only on a scroll past its bottomScrollThreshold
// of 90% (#1040), so a page we hide entirely adds no height and no scroll ever follows.
const GEMINI_BOTTOM_THRESHOLD_PERCENT = 90;

// Gemini silently drops a request while it is still loading the previous page, and a
// user parked at the bottom can send no other scroll (#1040): re-ask until the list grows.
const RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800];

function hasLayout(scroller: HTMLElement): boolean {
  return scroller.scrollHeight > 0 && scroller.clientHeight > 0;
}

type ListExtent = { scrollHeight: number; overflow: number };

function listExtent(scroller: HTMLElement): ListExtent {
  return {
    scrollHeight: scroller.scrollHeight,
    overflow: scroller.scrollHeight - scroller.clientHeight,
  };
}

/** New rows raise both; a sidebar resized taller or shorter moves at most one. */
function hasGrown(scroller: HTMLElement, before: ListExtent): boolean {
  const now = listExtent(scroller);
  return now.scrollHeight > before.scrollHeight && now.overflow > before.overflow;
}

function wouldRequestNextPage(scroller: HTMLElement): boolean {
  const { scrollTop, clientHeight, scrollHeight } = scroller;
  // Rows hidden out of a short list leave nothing to scroll, so the user cannot ask either.
  if (scrollHeight <= clientHeight) return true;
  return ((scrollTop + clientHeight) / scrollHeight) * 100 > GEMINI_BOTTOM_THRESHOLD_PERCENT;
}

export type NativePaginationNudge = {
  /** A native row was just hidden; re-asks Gemini for older chats once per frame if it would, retrying while the list does not grow. */
  rowHidden: (row: HTMLElement) => void;
  /** Drops pending requests, including one waiting for the sidebar to reopen (folder teardown). */
  cancel: () => void;
};

/**
 * Repeats the scroll Gemini would have seen had the hidden rows stayed visible,
 * so hide-archived cannot strand the Recents list at a bottom it never extends.
 * It acts only after rows are newly hidden, then retries a few times while the
 * list does not grow: once Gemini has no older chats to add, it stops.
 */
export function createNativePaginationNudge(): NativePaginationNudge {
  const scrollers = new Set<HTMLElement>();
  const awaitingLayout = new Set<HTMLElement>();
  let frame: number | null = null;
  let layoutObserver: ResizeObserver | null = null;
  const retries = new Map<HTMLElement, number>();
  const remoteRows = new WeakMap<HTMLElement, HTMLElement>();
  const stillOwned = (scroller: HTMLElement): boolean => {
    const row = remoteRows.get(scroller);
    return !row || (row.isConnected && findNativeListScroller(row) === scroller);
  };

  const stopRetry = (scroller: HTMLElement): void => {
    const timer = retries.get(scroller);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    retries.delete(scroller);
  };

  const retryUntilGrown = (scroller: HTMLElement, before: ListExtent, attempt: number): void => {
    if (attempt >= RETRY_DELAYS_MS.length) return;
    const timer = window.setTimeout(() => {
      retries.delete(scroller);
      if (!scroller.isConnected || !stillOwned(scroller)) return;
      // Collapsed before Gemini took a request: its rows stay hidden, so only reopening can ask.
      if (!hasLayout(scroller)) return waitForLayout(scroller);
      if (hasGrown(scroller, before) || !wouldRequestNextPage(scroller)) return;
      scroller.dispatchEvent(new Event('scroll'));
      retryUntilGrown(scroller, before, attempt + 1);
    }, RETRY_DELAYS_MS[attempt]);
    retries.set(scroller, timer);
  };

  const request = (scroller: HTMLElement): void => {
    stopRetry(scroller);
    if (!stillOwned(scroller) || !wouldRequestNextPage(scroller)) return;
    const before = listExtent(scroller);
    scroller.dispatchEvent(new Event('scroll'));
    retryUntilGrown(scroller, before, 0);
  };

  const stopWatchingLayout = (): void => {
    layoutObserver?.disconnect();
    layoutObserver = null;
    awaitingLayout.clear();
  };

  const stopAwaiting = (scroller: HTMLElement): void => {
    if (!awaitingLayout.delete(scroller)) return;
    layoutObserver?.unobserve(scroller);
    if (awaitingLayout.size === 0) stopWatchingLayout();
  };

  // A scroller Gemini replaced while collapsed may never resize again, so sweep it here.
  const dropDetached = (): void => {
    for (const scroller of awaitingLayout) {
      if (!scroller.isConnected) stopAwaiting(scroller);
    }
  };

  const onLayout = (): void => {
    dropDetached();
    for (const scroller of awaitingLayout) {
      if (!hasLayout(scroller)) continue;
      stopAwaiting(scroller);
      request(scroller);
    }
  };

  // Rows hidden while the sidebar is collapsed are already marked when it reopens,
  // so no later hide re-asks: keep that request until the scroller can be measured.
  const waitForLayout = (scroller: HTMLElement): void => {
    if (awaitingLayout.has(scroller)) return;
    awaitingLayout.add(scroller);
    layoutObserver ??= new ResizeObserver(onLayout);
    layoutObserver.observe(scroller);
  };

  const flush = (): void => {
    frame = null;
    const pending = [...scrollers];
    scrollers.clear();
    dropDetached();
    for (const scroller of pending) {
      if (!scroller.isConnected) continue;
      if (hasLayout(scroller)) {
        stopAwaiting(scroller);
        request(scroller);
      } else {
        waitForLayout(scroller);
      }
    }
  };

  return {
    rowHidden: (row) => {
      const scroller = findNativeListScroller(row);
      if (!scroller) return;
      if (getGeminiSelectorView().remoteKeys.has('sidebar.scroller')) remoteRows.set(scroller, row);
      scrollers.add(scroller);
      frame ??= window.requestAnimationFrame(flush);
    },
    cancel: () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      scrollers.clear();
      stopWatchingLayout();
      for (const timer of retries.values()) window.clearTimeout(timer);
      retries.clear();
    },
  };
}
