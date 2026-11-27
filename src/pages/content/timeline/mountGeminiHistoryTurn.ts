import { afterScrollSettles } from '@/features/timeline/scrollMotion';

const PAGE_TIMEOUT_MS = 12_000;
const MAX_PAGES = 300;
const MAX_TOP_ATTEMPTS = 3;

/** A user-selected older turn still needs Gemini to mount its real transcript. */
export function mountGeminiHistoryTurn(
  viewport: HTMLElement,
  id: string,
  selector: string,
  path: string,
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let oldest = '';
    let pages = 0;
    let topAttempts = 0;
    let timeout: number | undefined;
    let scrollTimer: number | undefined;
    const stop = (element: HTMLElement | null) => {
      observer.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      signal.removeEventListener('abort', abort);
      clearTimeout(timeout);
      clearTimeout(scrollTimer);
      resolve(element);
    };
    const abort = () => stop(null);
    const isCurrent = () => !signal.aborted && viewport.isConnected && location.pathname === path;
    const seekTop = () => {
      if (!isCurrent()) return abort();
      if (viewport.scrollTop <= 1) return;
      topAttempts++;
      viewport.scrollTop = 0;
    };
    const seekAfterSettle = () => {
      if (scrollTimer !== undefined || topAttempts >= MAX_TOP_ATTEMPTS) return;
      afterScrollSettles(
        () => viewport.scrollTop,
        (run, delay) => {
          scrollTimer = window.setTimeout(() => {
            scrollTimer = undefined;
            run();
          }, delay);
        },
        () => !isCurrent(),
        seekTop,
      );
    };
    const onScroll = () => {
      // Gemini can restore the previous anchor even after the prepend was observed.
      if (pages > 1 && viewport.scrollTop > 1) seekAfterSettle();
    };
    const check = () => {
      if (!isCurrent()) return abort();
      const container = viewport.querySelector<HTMLElement>(
        `.conversation-container[id="${id.slice(2)}"]`,
      );
      const target = container?.matches(selector)
        ? container
        : container?.querySelector<HTMLElement>(selector);
      if (target) return stop(target);
      const first = viewport.querySelector('.conversation-container[id]')?.id;
      if (!first || first === oldest) return;
      if (pages++ >= MAX_PAGES) return abort();
      oldest = first;
      topAttempts = 0;
      clearTimeout(scrollTimer);
      scrollTimer = undefined;
      if (pages === 1) seekTop();
      else seekAfterSettle();
      clearTimeout(timeout);
      timeout = window.setTimeout(abort, PAGE_TIMEOUT_MS);
    };
    const observer = new MutationObserver(check);
    observer.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener('scroll', onScroll, { passive: true });
    signal.addEventListener('abort', abort, { once: true });
    timeout = window.setTimeout(abort, PAGE_TIMEOUT_MS);
    check();
  });
}
