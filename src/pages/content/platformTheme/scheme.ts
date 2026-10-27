/**
 * Light/dark for ALL Voyager UI, resolved once per page instead of re-derived
 * per surface.
 *
 * Every host site announces dark mode in its own dialect — Gemini with
 * `.theme-host.dark-theme`, AI Studio with `body.dark-theme`, Claude with
 * `html[data-mode="dark"]`, ChatGPT with `html[data-theme="dark"]`, DeepSeek with
 * `body.dark`. Those selectors already live in each `site.json` as
 * `SiteThemeDescriptor`; nothing used to read them, so `contentStyle.css`
 * named the dialects it happened to know and DeepSeek — added later — matched
 * none of them, leaving every Voyager surface light on a dark page.
 *
 * This module is the single translator: it reads the descriptor and stamps
 * `data-gv-scheme="light" | "dark"` on the document root. CSS keys off that one
 * attribute, and JS reads `getScheme()` / `subscribeScheme()` instead of
 * re-implementing the check. Adding a platform is then one line of `site.json`.
 *
 * An attribute rather than a class: it carries a value, so a module can read
 * `documentElement.dataset.gvScheme` synchronously without importing anything,
 * and it matches the `data-gv-theme` naming the Prompt Manager already uses.
 */
import type { SiteThemeDescriptor } from '@/features/plugins/types';

/** Root attribute every Voyager light/dark rule keys off, on every site. */
export const SCHEME_ATTR = 'data-gv-scheme';

export type Scheme = 'light' | 'dark';

/**
 * Attributes a host site flips when its theme changes. Most adapters signal
 * through a class; `style` is here because a site can set a custom property
 * instead, and ChatGPT rewrites `data-theme` on `<html>`. Any other attribute a
 * descriptor's selectors name is added by `watchedAttributes`.
 */
const BASE_WATCHED_ATTRIBUTES = ['class', 'style', 'data-theme'];

const ATTRIBUTE_NAME = /\[\s*([\w-]+)/g;

/**
 * The base attributes plus every attribute the descriptor's selectors name.
 * Claude moved its marker from `html.dark` to `html[data-mode]`; a fixed list
 * heard none of its toggles, so a descriptor fix (bundled or online) must bring
 * its own attributes.
 */
export function watchedAttributes(theme: SiteThemeDescriptor | null | undefined): string[] {
  const names = new Set(BASE_WATCHED_ATTRIBUTES);
  for (const selector of [theme?.hostSelector, theme?.lightSelector, theme?.darkSelector]) {
    if (!selector) continue;
    for (const match of selector.matchAll(ATTRIBUTE_NAME)) names.add(match[1].toLowerCase());
  }
  return Array.from(names);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Does `selector` match anything right now? A bad selector is simply no match. */
function matchesAnywhere(doc: Document, selector: string | undefined): boolean {
  if (!selector) return false;
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/**
 * The scheme for `theme` right now.
 *
 * An explicit light marker wins over an explicit dark one: a site that leaves
 * both attached (or whose dark class lingers through a toggle) should read as
 * the light it is showing. With no descriptor and no marker — custom websites
 * have no adapter at all — follow the OS, which is what the stylesheet's own
 * media queries used to do.
 */
export function resolveScheme(
  theme: SiteThemeDescriptor | null | undefined,
  doc: Document = document,
): Scheme {
  if (matchesAnywhere(doc, theme?.lightSelector)) return 'light';
  if (matchesAnywhere(doc, theme?.darkSelector)) return 'dark';
  return prefersDark() ? 'dark' : 'light';
}

/** Write the scheme onto the root. Idempotent; returns what is now applied. */
export function applyScheme(scheme: Scheme, doc: Document = document): Scheme {
  doc.documentElement?.setAttribute(SCHEME_ATTR, scheme);
  return scheme;
}

/**
 * The scheme Voyager UI is currently painted in. Reads the root attribute
 * rather than a module variable so a surface mounted before `startScheme`, or
 * living in another bundle, still sees the truth.
 */
export function getScheme(doc: Document = document): Scheme {
  return doc.documentElement?.getAttribute(SCHEME_ATTR) === 'dark' ? 'dark' : 'light';
}

type SchemeListener = (scheme: Scheme) => void;

const listeners = new Set<SchemeListener>();

/**
 * Run `listener` on every scheme CHANGE; the opening value is not replayed,
 * read it with `getScheme()`. Surfaces that RE-RENDER on theme —
 * Mermaid, WaveDrom, ECharts — need this; surfaces that only restyle can let
 * CSS follow the attribute and subscribe to nothing.
 */
export function subscribeScheme(listener: SchemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(scheme: Scheme): void {
  // Iterate a copy: a listener that subscribes from inside its own callback
  // would otherwise be visited in this same pass.
  for (const listener of Array.from(listeners)) listener(scheme);
}

export interface SchemeBridge {
  /**
   * Point the bridge at a (possibly different) descriptor and re-resolve. The
   * override-aware adapter arrives after async storage reads, so the first
   * paint uses the bundled one and this corrects it.
   */
  setTheme(theme: SiteThemeDescriptor | null): void;
  stop(): void;
}

/**
 * Keep `data-gv-scheme` in step with the host page.
 *
 * `hostSelector` names an element, but it is a selector and the element can be
 * absent at start or replaced later (Gemini's `.theme-host` is Angular-owned),
 * so it is re-resolved on every pass rather than captured once. `documentElement`
 * and `body` are always observed because they are stable and carry most
 * dialects; the resolved host is observed as well when it is neither.
 */
let active: SchemeBridge | null = null;

/**
 * Start the bridge once for the page, or return the running one.
 *
 * The stamp has to land before any Voyager UI mounts: the dialects it replaced
 * were the host's own classes, already on the page, so a surface styled itself
 * correctly the instant it appeared. Reaching the attribute only when the brand
 * feature mounts would leave every surface light for the gap in between, and
 * would never reach a custom website or a plugin subframe, neither of which
 * gets that far. Resolving the bundled descriptor is synchronous, so the stamp
 * costs nothing at the top of the content entry.
 */
export function ensureScheme(
  theme: SiteThemeDescriptor | null,
  doc: Document = document,
): SchemeBridge {
  if (active) {
    if (theme) active.setTheme(theme);
    return active;
  }
  active = startScheme(theme, doc);
  return active;
}

/** The running page-lifetime bridge, or null before the content entry starts it. */
export function getSchemeBridge(): SchemeBridge | null {
  return active;
}

/** Tear the page-lifetime bridge down. Idempotent. */
export function stopScheme(): void {
  active?.stop();
  active = null;
}

export function startScheme(
  theme: SiteThemeDescriptor | null,
  doc: Document = document,
): SchemeBridge {
  let currentTheme = theme;
  let watched = watchedAttributes(theme);
  let stopped = false;
  let applied: Scheme | null = null;
  const observers: MutationObserver[] = [];

  const apply = (): void => {
    if (stopped) return;
    const next = resolveScheme(currentTheme, doc);
    observeBody();
    observeHost();
    if (next === applied) return;
    const isFirst = applied === null;
    applied = applyScheme(next, doc);
    // Subscribers read the opening value with getScheme(); firing here too
    // would make every re-rendering surface redraw once for nothing at startup.
    if (!isFirst) notify(applied);
  };

  const observe = (target: Node | null): void => {
    if (!target) return;
    const observer = new MutationObserver(apply);
    observer.observe(target, { attributes: true, attributeFilter: watched });
    observers.push(observer);
  };

  /**
   * Attach to the descriptor's host element. It may not exist yet and it may be
   * replaced later — Gemini renders `.theme-host` from Angular — so while there
   * is no live host a childList watch waits for one, and disconnects as soon as
   * it attaches. Steady state costs two attribute observers, not a subtree one.
   */
  let observedHost: Element | null = null;
  // Its own handle, not the shared list: a replaced host must release the old
  // observer, or every replacement retains a detached element until stop().
  let hostObserver: MutationObserver | null = null;
  let hostWatch: MutationObserver | null = null;

  function stopHostWatch(): void {
    hostWatch?.disconnect();
    hostWatch = null;
  }

  /** Fires when the host is swapped out from under us, not when it re-themes. */
  let hostParentObserver: MutationObserver | null = null;

  function releaseHost(): void {
    hostObserver?.disconnect();
    hostObserver = null;
    hostParentObserver?.disconnect();
    hostParentObserver = null;
    observedHost = null;
  }

  function watchForHost(): void {
    if (stopped || hostWatch || !doc.documentElement) return;
    hostWatch = new MutationObserver(apply);
    hostWatch.observe(doc.documentElement, { childList: true, subtree: true });
  }

  function observeHost(): void {
    if (stopped || !currentTheme?.hostSelector) return;
    if (observedHost && !observedHost.isConnected) releaseHost();
    let host: Element | null = null;
    try {
      host = doc.querySelector(currentTheme.hostSelector);
    } catch {
      return;
    }
    if (host === doc.documentElement || host === doc.body) {
      releaseHost();
      stopHostWatch(); // already covered by the always-on observers
      return;
    }
    if (!host) {
      watchForHost();
      return;
    }
    if (host === observedHost) return;
    releaseHost();
    observedHost = host;
    hostObserver = new MutationObserver(apply);
    hostObserver.observe(host, { attributes: true, attributeFilter: watched });
    // Angular swaps the element rather than re-theming it, and an observer on
    // the element itself hears nothing about its own removal. Watching the
    // parent's children costs one shallow observer and lets the document-wide
    // watch stay off while a host is live.
    if (host.parentElement) {
      hostParentObserver = new MutationObserver(apply);
      hostParentObserver.observe(host.parentElement, { childList: true });
    }
    stopHostWatch();
  }

  observe(doc.documentElement);
  /** body can still be missing this early; attach on the first pass that sees it. */
  let bodyObserved = false;
  function observeBody(): void {
    if (bodyObserved || !doc.body) return;
    bodyObserved = true;
    observe(doc.body);
  }
  observeBody();

  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  const onMedia = (): void => apply();
  media?.addEventListener('change', onMedia);

  apply();

  return {
    setTheme(next: SiteThemeDescriptor | null): void {
      // startBrandTheme re-resolves on every plugin-state, catalog and accent
      // change, almost always landing on the same descriptor; tearing the
      // observers down and back up for that is pure churn.
      if (
        next?.hostSelector === currentTheme?.hostSelector &&
        next?.lightSelector === currentTheme?.lightSelector &&
        next?.darkSelector === currentTheme?.darkSelector
      ) {
        return;
      }
      currentTheme = next;
      const nextWatched = watchedAttributes(next);
      if (nextWatched.join() !== watched.join()) {
        watched = nextWatched;
        // The root and body observers were built with the old filter.
        for (const observer of observers) observer.disconnect();
        observers.length = 0;
        observe(doc.documentElement);
        bodyObserved = false;
        observeBody();
      }
      releaseHost();
      stopHostWatch();
      apply();
    },
    stop(): void {
      stopped = true;
      releaseHost();
      stopHostWatch();
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
      media?.removeEventListener('change', onMedia);
      doc.documentElement?.removeAttribute(SCHEME_ATTR);
      applied = null;
    },
  };
}
