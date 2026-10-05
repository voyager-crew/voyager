import { historyTimestampStore } from '../timestamp/historyTimestamps';
import { watchRouteChanges } from '../utils/routeWatcher';
import { TimelineManager } from './manager';

function isGeminiConversationRoute(pathname = location.pathname): boolean {
  // Support account-scoped routes like /u/1/app or /u/0/gem/
  // Matches: "/app", "/gem/", "/u/<num>/app", "/u/<num>/gem/"
  return /^\/(?:u\/\d+\/)?(app|gem)(\/|$)/.test(pathname);
}

let timelineManagerInstance: TimelineManager | null = null;
let currentUrl = location.href;
let currentPathAndSearch = location.pathname + location.search;
let stopRouteWatcher: (() => void) | null = null;
let routeListenersAttached = false;
let activeObservers: MutationObserver[] = [];

function initializeTimeline(previousUrl: string | null = null): void {
  if (timelineManagerInstance) {
    try {
      timelineManagerInstance.destroy();
    } catch {}
    timelineManagerInstance = null;
  }
  // The shared view clears any stale rail when it mounts.
  timelineManagerInstance = new TimelineManager({ previousUrl });
  timelineManagerInstance
    .init()
    .catch((err) => console.error('Timeline initialization failed:', err));
}

let urlChangeTimer: number | null = null;

function handleUrlChange(): void {
  if (location.href === currentUrl) return;

  const previousUrl = currentUrl;
  const newPathAndSearch = location.pathname + location.search;
  const pathChanged = newPathAndSearch !== currentPathAndSearch;

  // Update current URL
  currentUrl = location.href;

  // Only reinitialize if pathname or search changed, not just hash
  if (!pathChanged) return;

  currentPathAndSearch = newPathAndSearch;

  // Clear any pending initialization
  if (urlChangeTimer) {
    clearTimeout(urlChangeTimer);
    urlChangeTimer = null;
  }

  if (isGeminiConversationRoute()) {
    // Add delay to allow DOM to update after SPA navigation
    urlChangeTimer = window.setTimeout(() => {
      initializeTimeline(previousUrl);
      urlChangeTimer = null;
    }, 500); // Wait for DOM to settle
  } else {
    if (timelineManagerInstance) {
      try {
        timelineManagerInstance.destroy();
      } catch {}
      timelineManagerInstance = null;
    }
    try {
      document.querySelector('.gemini-timeline-bar')?.remove();
    } catch {}
    try {
      document.querySelector('.timeline-left-slider')?.remove();
    } catch {}
    try {
      document.getElementById('gemini-timeline-tooltip')?.remove();
    } catch {}
  }
}

function attachRouteListenersOnce(): void {
  if (routeListenersAttached) return;
  routeListenersAttached = true;
  stopRouteWatcher = watchRouteChanges(handleUrlChange);
}

/**
 * Cleanup function to prevent memory leaks
 * Disconnects all observers, clears intervals, and removes event listeners
 */
function cleanup(): void {
  // Cancel any pending delayed initialization
  if (urlChangeTimer) {
    clearTimeout(urlChangeTimer);
    urlChangeTimer = null;
  }

  // Disconnect all active MutationObservers
  activeObservers.forEach((observer) => {
    try {
      observer.disconnect();
    } catch (e) {
      console.error('[Gemini Voyager] Failed to disconnect observer during cleanup:', e);
    }
  });
  activeObservers = [];

  stopRouteWatcher?.();
  stopRouteWatcher = null;

  // The parsed history cache intentionally survives SPA manager replacement,
  // but the page-lifetime bridge must be released on a real unload.
  historyTimestampStore.stop();

  // Reset flag
  routeListenersAttached = false;
}

export function startTimeline(): void {
  const setup = (): void => {
    attachRouteListenersOnce();
    if (isGeminiConversationRoute() && !timelineManagerInstance) {
      initializeTimeline();
    }
  };

  if (document.body) {
    setup();
  } else {
    const initialObserver = new MutationObserver(() => {
      if (!document.body) return;

      // Disconnect and remove from tracking
      initialObserver.disconnect();
      activeObservers = activeObservers.filter((obs) => obs !== initialObserver);

      setup();
    });

    // Track observer for cleanup
    activeObservers.push(initialObserver);
    initialObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Setup cleanup on page unload
  window.addEventListener('beforeunload', cleanup, { once: true });

  // Also cleanup on extension unload (if content script is removed)
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onSuspend?.addListener?.(cleanup);
  }
}
