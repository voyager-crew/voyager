import { getTranslationSync, onCachedLanguageChange } from '../../../utils/i18n';
import {
  COLLAPSED_CLASS,
  PLACEHOLDER_CLASS,
  PROCESSED_CLASS,
  STYLE_ID,
  TRANSITION_CLASS,
  ensurePlaceholder,
  getInputContainer,
  injectStyles,
  isInputEmpty,
  isInputRelatedElement,
  moveCursorToEndOfElement,
  shouldDisableAutoCollapse,
} from './dom';
import { findCollapseElement } from './targets';

/**
 * Everything one enabled period owns. A session ends when the feature is
 * switched off live or its runtime stops; whichever happens, every timer,
 * listener and observer below goes with it.
 */
interface CollapseSession {
  readonly controller: AbortController;
  readonly timers: Set<number>;
  /** Page-level listeners, removed by hand so the lifecycle ledger can see them go. */
  readonly pageListeners: Array<() => void>;
  stopFollowingLanguage: (() => void) | null;
  observer: MutationObserver | null;
  observerDebounceTimer: number | null;
  blurCollapseTimer: number | null;
}

/**
 * Read by the public `collapseInput`, so it is page state rather than session
 * state: a live change lands even while the feature is off.
 */
let allowCollapseWhenNotEmpty = false;
let activeSession: CollapseSession | null = null;

/**
 * Applies the "collapse with content" sub-switch in place, with or without a
 * running session: the native module and the official plugin both follow it
 * live without restarting the session.
 */
export function setCollapseWhenNotEmpty(value: boolean): void {
  allowCollapseWhenNotEmpty = value;
}

/** The sub-switch value a session started now would run with. */
export function collapseWhenNotEmpty(): boolean {
  return allowCollapseWhenNotEmpty;
}

/**
 * Timers check the session that queued them, so a callback cannot outlive a
 * stop and collapse or focus the composer of a feature that is already off.
 */
function scheduleSessionTimer(
  session: CollapseSession,
  callback: () => void,
  delay: number,
): number {
  const id = window.setTimeout(() => {
    session.timers.delete(id);
    if (activeSession !== session) return;
    callback();
  }, delay);
  session.timers.add(id);
  return id;
}

function listenOnPage<K extends keyof WindowEventMap>(
  session: CollapseSession,
  target: Document | Window,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options: AddEventListenerOptions = {},
): void {
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  session.pageListeners.push(() => target.removeEventListener(type, listener, options));
}

function clearSessionTimer(session: CollapseSession, id: number | null): void {
  if (id === null) return;
  window.clearTimeout(id);
  session.timers.delete(id);
}

export function expand(container: HTMLElement, moveCursorToEnd: boolean = false): void {
  if (!container.classList.contains(COLLAPSED_CLASS)) return;
  container.classList.remove(COLLAPSED_CLASS);

  // Auto-focus the Quill editor
  const editor = findCollapseElement(container, 'inputCollapse.focus');
  if (!(editor instanceof HTMLElement)) return;

  const focusEditor = (): void => {
    editor.focus();
    if (moveCursorToEnd && !isInputEmpty(container)) {
      moveCursorToEndOfElement(editor);
    }
  };
  // The deferred focus belongs to the running session: once it stops, the
  // feature must not pull focus back into the composer.
  if (activeSession) scheduleSessionTimer(activeSession, focusEditor, 0);
  else window.setTimeout(focusEditor, 0);
}

function tryCollapse(session: CollapseSession, container: HTMLElement): void {
  // We need a small delay to handle transient states
  scheduleSessionTimer(
    session,
    () => {
      // Don't collapse on excluded pages (homepage, new conversation, gems create)
      if (shouldDisableAutoCollapse()) {
        container.classList.remove(COLLAPSED_CLASS);
        return;
      }

      const active = document.activeElement;
      const isStillFocused = container.contains(active);

      if (!isStillFocused) {
        // Check if we should collapse based on setting and input state
        // If allowCollapseWhenNotEmpty is true, we can collapse even with content
        // Otherwise, only collapse when empty (original behavior)
        const canCollapse = allowCollapseWhenNotEmpty || isInputEmpty(container);
        if (canCollapse) {
          container.classList.add(COLLAPSED_CLASS);
        }
      }
    },
    150,
  );
}

/** Removes the page state a session added; only this feature's own classes and nodes. */
function removeCollapseDom(): void {
  document.getElementById(STYLE_ID)?.remove();
  for (const className of [COLLAPSED_CLASS, TRANSITION_CLASS, PROCESSED_CLASS]) {
    document.querySelectorAll(`.${className}`).forEach((el) => {
      el.classList.remove(className);
    });
  }
  document.querySelectorAll(`.${PLACEHOLDER_CLASS}`).forEach((el) => {
    el.remove();
  });
}

function endSession(session: CollapseSession): void {
  // A stale stop must not tear down the session that replaced it.
  if (activeSession !== session) return;
  activeSession = null;

  for (const id of session.timers) window.clearTimeout(id);
  session.timers.clear();
  session.blurCollapseTimer = null;
  session.observerDebounceTimer = null;
  session.controller.abort();
  for (const remove of session.pageListeners.splice(0)) remove();
  session.observer?.disconnect();
  session.observer = null;
  removeCollapseDom();
  session.stopFollowingLanguage?.();
  session.stopFollowingLanguage = null;
}

function attachToContainer(session: CollapseSession, container: HTMLElement): void {
  const { signal } = session.controller;
  container.classList.add(PROCESSED_CLASS);
  container.classList.add(TRANSITION_CLASS); // Add transition class

  ensurePlaceholder(container);

  container.addEventListener(
    'click',
    () => {
      expand(container);
    },
    { signal },
  );

  // Capture focus events deeply
  // focusin cancels delayed collapse when focus returns to input area
  container.addEventListener(
    'focusin',
    () => {
      expand(container);
      // If we have a pending collapse, cancel it since focus is coming back
      clearSessionTimer(session, session.blurCollapseTimer);
      session.blurCollapseTimer = null;
    },
    { signal },
  );

  container.addEventListener(
    'focusout',
    (e) => {
      // Clear any existing timer
      clearSessionTimer(session, session.blurCollapseTimer);
      session.blurCollapseTimer = null;

      const newFocus = e.relatedTarget as HTMLElement;

      // Check if focus is still inside the container
      if (newFocus && container.contains(newFocus)) {
        return; // Focus is still inside
      }

      // Use a small delay before collapsing
      // This allows focusin events to cancel the collapse if focus returns
      session.blurCollapseTimer = scheduleSessionTimer(
        session,
        () => {
          session.blurCollapseTimer = null;
          // Double-check: focus should truly be away from input-related elements
          const active = document.activeElement as HTMLElement;
          if (active && container.contains(active)) {
            return; // Focus came back, don't collapse
          }

          // Also check if the new focus is in an input-related overlay/menu
          if (
            (newFocus && isInputRelatedElement(newFocus, container)) ||
            (active && isInputRelatedElement(active, container))
          ) {
            return; // Focus moved to input-related UI, don't collapse
          }

          // Now safe to collapse
          tryCollapse(session, container);
        },
        100,
      ); // 100ms delay - enough for focusin to cancel if needed
    },
    { signal },
  );

  // Initial check - only collapse if not on excluded pages
  if (!shouldDisableAutoCollapse()) {
    tryCollapse(session, container);
  }
}

/**
 * Runs the collapse behaviour until the returned stop is called. Starting a
 * session retires any session still running, so the page has at most one.
 */
export function startCollapseSession(allowNotEmpty: boolean): () => void {
  if (activeSession) endSession(activeSession);

  const relabelPlaceholders = (): void => {
    document.querySelectorAll<HTMLDivElement>(`.${PLACEHOLDER_CLASS}`).forEach((placeholder) => {
      const span = placeholder.querySelector('span');
      if (span) {
        span.textContent = getTranslationSync('inputCollapsePlaceholder') || 'Message Gemini';
      }
    });
  };
  const session: CollapseSession = {
    controller: new AbortController(),
    timers: new Set(),
    pageListeners: [],
    stopFollowingLanguage: null,
    observer: null,
    observerDebounceTimer: null,
    blurCollapseTimer: null,
  };
  activeSession = session;
  allowCollapseWhenNotEmpty = allowNotEmpty; // Store the setting

  injectStyles();

  let lastPathname = window.location.pathname;

  // Auto-expand the input area when a file is dragged into the window.
  listenOnPage(
    session,
    document,
    'dragenter',
    (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        const container = getInputContainer();
        if (container && container.classList.contains(COLLAPSED_CLASS)) {
          expand(container);
        }
      }
    },
    { capture: true },
  );

  // Handle URL changes for SPA navigation
  const urlChangeHandler = (): void => {
    // Safety check for test environments and edge cases
    if (typeof window === 'undefined' || !window.location) return;

    const currentPathname = window.location.pathname;
    if (currentPathname === lastPathname) return;

    lastPathname = currentPathname;

    const container = getInputContainer();
    if (!container) return;

    if (shouldDisableAutoCollapse()) {
      // On homepage/new conversation/gems create: expand the input
      container.classList.remove(COLLAPSED_CLASS);
    } else {
      // On conversation page: try to collapse if appropriate
      tryCollapse(session, container);
    }
  };

  // Listen for URL changes (browser back/forward)
  listenOnPage(session, window, 'popstate', urlChangeHandler);

  // MutationObserver to re-apply when Gemini re-renders and detect SPA navigation
  session.observer = new MutationObserver(() => {
    if (activeSession !== session) return;
    clearSessionTimer(session, session.observerDebounceTimer);
    session.observerDebounceTimer = scheduleSessionTimer(
      session,
      () => {
        session.observerDebounceTimer = null;
        // Check for URL changes on DOM mutations (catches SPA navigation)
        urlChangeHandler();

        const container = getInputContainer();
        if (!container || container.classList.contains(PROCESSED_CLASS)) return;
        attachToContainer(session, container);
      },
      100,
    );
  });
  session.observer.observe(document.body, { childList: true, subtree: true });

  // Add keyboard shortcuts for collapse/expand
  listenOnPage(
    session,
    document,
    'keydown',
    (e) => {
      const container = getInputContainer();
      if (!container) return;

      // ESC key - collapse input
      if (e.key === 'Escape') {
        // Only respond when focus is within the input container
        const active = document.activeElement;
        if (active && container.contains(active)) {
          e.preventDefault();
          e.stopPropagation();
          collapseInputNow();
        }
        return;
      }

      // Ctrl+I - expand input and focus with cursor at end
      if (e.key === 'i' || e.key === 'I') {
        if (e.ctrlKey || e.metaKey) {
          // Only respond when input is collapsed
          if (container.classList.contains(COLLAPSED_CLASS)) {
            e.preventDefault();
            e.stopPropagation();
            expand(container, true);
          }
        }
        return;
      }
    },
    { capture: true }, // capture phase to ensure we intercept before other handlers
  );

  // Update placeholder text once a new language has loaded, not when storage changes.
  session.stopFollowingLanguage = onCachedLanguageChange(relabelPlaceholders);

  // Try once immediately
  const container = getInputContainer();
  if (container) {
    // trigger logic manually just in case
    container.classList.remove(PROCESSED_CLASS);
  }

  return () => endSession(session);
}

/**
 * Collapses the input area immediately (for keyboard shortcut)
 * This bypasses the delay and state checks in tryCollapse
 */
export function collapseInputNow(): void {
  const container = getInputContainer();
  if (!container) return;

  // Respect the "collapse when not empty" setting
  if (!allowCollapseWhenNotEmpty && !isInputEmpty(container)) return;

  // Immediately collapse
  container.classList.add(COLLAPSED_CLASS);

  // Remove focus from the input
  const active = document.activeElement;
  if (active && container.contains(active)) {
    (active as HTMLElement).blur();
  }
}
