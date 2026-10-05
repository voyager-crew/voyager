import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { runRouteTimeline } from '@/features/timeline/runRouteTimeline';

import type { StopNativeFeature } from '../featureLifecycle';
import { historyTimestampStore } from '../timestamp/historyTimestamps';
import { TimelineManager } from './manager';

/** Gemini renders a conversation after its router settles; rebuilding sooner reads the old DOM. */
const ROUTE_SETTLE_MS = 500;

function isGeminiConversationRoute(href: string): boolean {
  // Account-scoped routes too: "/app", "/gem/", "/u/<num>/app", "/u/<num>/gem/"
  return /^\/(?:u\/\d+\/)?(app|gem)(\/|$)/.test(new URL(href, location.href).pathname);
}

/** Native lifecycle module: one rail per Gemini conversation route, torn down by the returned stop. */
export function startTimeline(): StopNativeFeature {
  const lifetime = new AbortController();
  const run = (): void => {
    runRouteTimeline({
      signal: lifetime.signal,
      isConversationRoute: isGeminiConversationRoute,
      settleMs: ROUTE_SETTLE_MS,
      createEngine: (previousUrl) => new TimelineManager({ previousUrl }),
    });
  };

  let bodyObserver: MutationObserver | null = null;
  if (document.body) run();
  else {
    bodyObserver = new MutationObserver(() => {
      if (!document.body) return;
      bodyObserver?.disconnect();
      bodyObserver = null;
      run();
    });
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  return () => {
    bodyObserver?.disconnect();
    bodyObserver = null;
    lifetime.abort();
    // These page-lifetime services outlive SPA engine replacement; only page teardown releases them.
    historyTimestampStore.stop();
    keyboardShortcutService.destroy();
  };
}
