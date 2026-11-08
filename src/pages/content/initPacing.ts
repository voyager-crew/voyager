import { logger } from '@/core/services/LoggerService';

/**
 * How the content script paces its initialization.
 *
 * Staggered initialization prevents a "thundering herd" when many tabs are
 * restored at once (e.g. after a browser restart): background tabs wait a
 * random 3-8 s, foreground tabs start at once. This keeps Google's rate
 * limiting away from sessions with many long Gemini conversations.
 */

/** For resource-intensive features (Timeline, Folder). */
export const HEAVY_FEATURE_INIT_DELAY = 100;
/** For lightweight features. */
export const LIGHT_FEATURE_INIT_DELAY = 50;
const BACKGROUND_TAB_MIN_DELAY = 3000;
const BACKGROUND_TAB_MAX_DELAY = 8000;

/** Determine the initialization delay from tab visibility. */
export function getInitializationDelay(): number {
  if (document.visibilityState === 'visible') {
    // Foreground tab: initialize immediately for good UX
    logger.debug('Foreground tab detected, initializing immediately');
    return 0;
  }
  // Background tab: add random delay to distribute load across multiple tabs
  const randomRange = BACKGROUND_TAB_MAX_DELAY - BACKGROUND_TAB_MIN_DELAY;
  const randomDelay = BACKGROUND_TAB_MIN_DELAY + Math.random() * randomRange;
  logger.debug('Background tab detected, delaying initialization', {
    delayMs: Math.round(randomDelay),
  });
  return randomDelay;
}

/**
 * Yield between features instead of sleeping a fixed amount. On an idle main
 * thread (the common foreground case) requestIdleCallback fires on the next
 * idle slice — typically well under `ms` — so tail features (timeline, export,
 * mermaid, …) wire up promptly instead of waiting out a ~2s floor of stacked
 * setTimeouts. When the thread is busy, the `timeout` cap makes it back off
 * exactly like the old fixed delay, preserving the anti-thundering-herd intent.
 * Falls back to setTimeout where requestIdleCallback is unavailable (older WebKit).
 */
export function yieldToIdle(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: ms });
    } else {
      setTimeout(resolve, ms);
    }
  });
}
