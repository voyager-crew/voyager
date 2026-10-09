import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';

import type { TimelineEngine } from './TimelineEngine';

export interface RouteTimelineOptions {
  /** Aborting it stops the timeline, like calling the returned `stop`. */
  readonly signal: AbortSignal;
  /** Builds the engine for the current route; `previousUrl` is the href it replaces. */
  createEngine(previousUrl: string | null): TimelineEngine;
  /** Runs the new engine's startup; the default calls `init()` and ignores its rejection. */
  start?(engine: TimelineEngine): void;
  /** Routes that get no rail; every route has one when omitted. */
  isConversationRoute?(href: string): boolean;
  /** Delay between a path/query change and the rebuilt rail, for hosts that render after routing. */
  readonly settleMs?: number;
  /** Forward `hashchange` to the engine, so a same-route `#gv-turn-…` link navigates the rail. */
  readonly followHash?: boolean;
}

export interface RouteTimeline {
  /** The engine for the current route, or null while none is mounted. */
  readonly engine: TimelineEngine | null;
  /** Idempotent: destroys the engine and every listener and timer set up here. */
  stop(): void;
}

const routeOf = (href: string): string => href.split('#')[0];

/**
 * One timeline per path/query route. A hash-only change keeps the engine; a path or query change
 * destroys it and builds the next one (after `settleMs`, if set). Routes are observed through the
 * shared SPA route watcher, so navigation stays the host's own; nothing here reloads the page.
 */
export function runRouteTimeline(options: RouteTimelineOptions): RouteTimeline {
  const isConversation = options.isConversationRoute ?? (() => true);
  const start =
    options.start ??
    ((engine: TimelineEngine) => {
      engine.init().catch((error: unknown) => {
        console.error('[Gemini Voyager] Timeline initialization failed:', error);
      });
    });
  let engine: TimelineEngine | null = null;
  let stopped = false;
  let lastHref = location.href;
  let route = routeOf(lastHref);
  let settleTimer: number | null = null;

  const clearSettleTimer = (): void => {
    if (settleTimer === null) return;
    clearTimeout(settleTimer);
    settleTimer = null;
  };
  const destroyEngine = (): void => {
    const current = engine;
    engine = null;
    try {
      current?.destroy();
    } catch {
      /* A failing teardown must not keep the next route's rail from mounting. */
    }
  };
  const mount = (previousUrl: string | null): void => {
    if (stopped) return;
    destroyEngine();
    engine = options.createEngine(previousUrl);
    start(engine);
  };

  const stopRouteWatcher = watchRouteChanges(() => {
    const href = location.href;
    if (href === lastHref) return;
    const previousUrl = lastHref;
    lastHref = href;
    const next = routeOf(href);
    if (next === route) return;
    route = next;
    clearSettleTimer();
    if (!isConversation(href)) {
      destroyEngine();
      return;
    }
    const settleMs = options.settleMs ?? 0;
    if (settleMs <= 0) {
      mount(previousUrl);
      return;
    }
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      mount(previousUrl);
    }, settleMs);
  });
  const onHashChange = (): void => engine?.handleHash();
  if (options.followHash) window.addEventListener('hashchange', onHashChange);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    options.signal.removeEventListener('abort', stop);
    clearSettleTimer();
    stopRouteWatcher();
    if (options.followHash) window.removeEventListener('hashchange', onHashChange);
    destroyEngine();
  };
  options.signal.addEventListener('abort', stop, { once: true });
  if (options.signal.aborted) stop();
  else if (isConversation(lastHref)) mount(null);

  return {
    get engine() {
      return engine;
    },
    stop,
  };
}
