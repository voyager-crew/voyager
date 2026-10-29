import type { TimelineEngine } from '@/features/timeline/TimelineEngine';
import { type RouteTimeline, runRouteTimeline } from '@/features/timeline/runRouteTimeline';

import { isGeminiConversationRoute } from './conversationRoute';

/** Gemini renders a conversation after its router settles; rebuilding sooner reads the old DOM. */
const ROUTE_SETTLE_MS = 500;

export interface GeminiTimelineRail {
  readonly engine: TimelineEngine | null;
  stop(): void;
}

/** Route/DOM lifetime only: each caller owns its enable setting and data readiness. */
export function startGeminiTimelineRail(options: {
  readonly signal?: AbortSignal;
  createEngine(previousUrl: string | null): TimelineEngine;
  start?(engine: TimelineEngine): void;
}): GeminiTimelineRail {
  const lifetime = new AbortController();
  let route: RouteTimeline | null = null;
  let bodyObserver: MutationObserver | null = null;
  const stop = (): void => {
    if (lifetime.signal.aborted) return;
    options.signal?.removeEventListener('abort', stop);
    bodyObserver?.disconnect();
    bodyObserver = null;
    lifetime.abort();
    route = null;
  };
  const mount = (): void => {
    if (lifetime.signal.aborted || route) return;
    if (!document.body) {
      bodyObserver ??= new MutationObserver(mount);
      bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }
    bodyObserver?.disconnect();
    bodyObserver = null;
    route = runRouteTimeline({
      signal: lifetime.signal,
      isConversationRoute: isGeminiConversationRoute,
      settleMs: ROUTE_SETTLE_MS,
      createEngine: options.createEngine,
      start: options.start,
    });
  };
  // Stop before the plugin cleanup ledger waits for pending initialization or other disposers.
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  else mount();
  return {
    get engine() {
      return route?.engine ?? null;
    },
    stop,
  };
}
