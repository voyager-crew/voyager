/**
 * Sidebar Auto-Hide & Full-Hide Feature for Gemini
 *
 * Auto-hide: sidebar automatically collapses when the mouse leaves,
 * and expands when the mouse enters.
 *
 * Full-hide: when collapsed (by auto-hide or manually), the sidebar
 * is fully hidden (zero width).
 *
 * Uses the `side-nav-menu-button` to toggle sidebar state.
 */

import { closestGeminiSidebarElement } from '@/core/gemini/sidebar/queries';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-interaction-packaged.json';
import { type Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';

import { createFullHide } from './fullHide';
import { createHoverIntent } from './hoverIntent';
import { getSidebarToggleState, isSidebarCollapsed, isSidebarToggleTarget } from './sidebarDom';

const STYLE_ID = 'gv-sidebar-auto-hide-style';
const OBSERVER_DEBOUNCE_MS = 100;
const SIDENAV_CHECK_INTERVAL_MS = 1000;
const RESIZE_DEBOUNCE_MS = 200;
const MENU_CLICK_PAUSE_MS = 1500;

export function createSidebarHideController(isLocked: () => boolean) {
  const scope = new PluginScope();
  let enabled = false;
  let fullHideEnabled = false;
  let autoCollapsed = false;
  let internalToggleClickDepth = 0;
  let observer: MutationObserver | null = null;
  let resizeHandler: (() => void) | null = null;
  let resizeDebounceTimer: Dispose | null = null;
  let observerDebounceTimer: Dispose | null = null;
  let sidenavCheckTimer: Dispose | null = null;
  let menuClickHandler: ((event: Event) => void) | null = null;

  const fullHide = createFullHide({
    onEdgeEnter: () => hover.enter(),
    onEdgeLeave: (event) => {
      if (fullHideEnabled) hover.leaveEdge(event);
    },
    onReconcile: checkAndReattach,
  });
  const hover = createHoverIntent({
    isEnabled: () => enabled,
    isEdgeHovered: fullHide.isEdgeHovered,
    expand: expandSidebar,
    collapse: collapseSidebar,
  });

  function getTransitionStyle(): string {
    return `
      /* Smooth transition for sidebar auto-hide / full-hide */
      bard-sidenav,
      bard-sidenav side-navigation-content,
      bard-sidenav side-navigation-content > div {
        transition: width 0.26s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.26s cubic-bezier(0.4, 0, 0.2, 1), transform 0.26s cubic-bezier(0.4, 0, 0.2, 1) !important;
        will-change: width, min-width, transform;
      }
    `;
  }

  function insertTransitionStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = getTransitionStyle();
    document.documentElement.appendChild(style);
  }

  function removeTransitionStyle(): void {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function isKeepExpandedLocked(): boolean {
    return isLocked();
  }

  function handleMenuClick(e: Event): void {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    if (isSidebarToggleTarget(target)) {
      if (internalToggleClickDepth > 0) {
        return;
      }

      if (fullHideEnabled) {
        const wasCollapsed = isSidebarCollapsed();
        fullHide.beforeToggle(wasCollapsed);
        fullHide.afterToggle(wasCollapsed);
      }

      if (enabled) {
        hover.pause(MENU_CLICK_PAUSE_MS);
      }
      return;
    }

    if (!enabled) return;

    const menuItem = target.closest(packaged.menuItem.join(', '));
    if (menuItem) {
      hover.pause(MENU_CLICK_PAUSE_MS);
      return;
    }

    const sidebarButton = closestGeminiSidebarElement(target, 'sidebar.interactionButton');
    if (sidebarButton) {
      hover.pause(MENU_CLICK_PAUSE_MS);
      return;
    }

    const optionsButton = target.closest(packaged.optionsButton.join(', '));
    if (optionsButton) {
      hover.pause(MENU_CLICK_PAUSE_MS);
      return;
    }
  }

  // ─── Sidebar Toggle ────────────────────────────────────────────────────

  function clickToggleButton(): boolean {
    const { button: btn, collapsed: wasCollapsed } = getSidebarToggleState();
    if (!btn) return false;

    internalToggleClickDepth += 1;
    try {
      if (fullHideEnabled) fullHide.beforeToggle(wasCollapsed);
      btn.click();

      if (fullHideEnabled) {
        fullHide.afterToggle(wasCollapsed);
      }
    } finally {
      internalToggleClickDepth -= 1;
    }

    return true;
  }

  function collapseSidebar(): void {
    if (isKeepExpandedLocked()) return;
    if (!hover.canCollapse()) return;

    if (!isSidebarCollapsed()) {
      if (clickToggleButton()) {
        autoCollapsed = true;
        hover.resetPrediction();
      }
    }
  }

  function expandSidebar(): void {
    if (isSidebarCollapsed()) {
      clickToggleButton();
      autoCollapsed = false;
      // Schedule a reattach so auto-hide listeners are re-added after expansion.
      // Must fire after the 220ms CSS transition completes to avoid mid-animation DOM updates.
      scope.timer(() => checkAndReattach(), 450);
    }
  }

  function checkAndReattach(): void {
    if (scope.isDisposed || (!enabled && !fullHideEnabled)) return;
    if (enabled && hover.reattach()) autoCollapsed = false;
    if (fullHideEnabled) fullHide.sync(enabled, isKeepExpandedLocked());
  }

  function handleResize(): void {
    if (scope.isDisposed || (!enabled && !fullHideEnabled)) return;

    if (resizeDebounceTimer !== null) {
      void resizeDebounceTimer();
    }

    resizeDebounceTimer = scope.timer(() => {
      resizeDebounceTimer = null;
      checkAndReattach();

      scope.timer(() => {
        if (enabled || fullHideEnabled) checkAndReattach();
      }, 600);
    }, RESIZE_DEBOUNCE_MS);
  }

  function startSidenavCheck(): void {
    if (sidenavCheckTimer !== null) return;
    sidenavCheckTimer = scope.timer(
      () => {
        checkAndReattach();
      },
      SIDENAV_CHECK_INTERVAL_MS,
      { repeat: true },
    );
  }

  function stopSidenavCheck(): void {
    if (sidenavCheckTimer !== null) {
      void sidenavCheckTimer();
      sidenavCheckTimer = null;
    }
  }

  // ─── Shared Infrastructure ─────────────────────────────────────────────

  function setupInfrastructure(): void {
    if (!observer) {
      observer = new MutationObserver(() => {
        if (scope.isDisposed || (!enabled && !fullHideEnabled)) return;
        // Debounce: during sidebar expansion Gemini renders hundreds of
        // conversation rows in rapid succession. Without debouncing every
        // mutation triggers a synchronous DOM-query sweep (#753).
        if (observerDebounceTimer !== null) void observerDebounceTimer();
        observerDebounceTimer = scope.timer(() => {
          observerDebounceTimer = null;
          checkAndReattach();
        }, OBSERVER_DEBOUNCE_MS);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    if (!resizeHandler) {
      resizeHandler = handleResize;
      window.addEventListener('resize', resizeHandler);
    }

    startSidenavCheck();
  }

  function teardownInfrastructure(): void {
    if (enabled || fullHideEnabled) return;

    stopSidenavCheck();
    fullHide.clearScheduledSync();

    if (resizeDebounceTimer !== null) {
      void resizeDebounceTimer();
      resizeDebounceTimer = null;
    }

    if (observerDebounceTimer !== null) {
      void observerDebounceTimer();
      observerDebounceTimer = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  }

  function ensureMenuClickHandler(): void {
    if (menuClickHandler) return;
    menuClickHandler = handleMenuClick;
    document.addEventListener('click', menuClickHandler, true);
  }

  function maybeRemoveMenuClickHandler(): void {
    if (enabled || fullHideEnabled || !menuClickHandler) return;
    document.removeEventListener('click', menuClickHandler, true);
    menuClickHandler = null;
  }

  function enable(): void {
    if (enabled) return;
    enabled = true;
    autoCollapsed = false;

    insertTransitionStyle();
    hover.start();
    ensureMenuClickHandler();
    if (fullHideEnabled) fullHide.sync(enabled, isKeepExpandedLocked());

    setupInfrastructure();

    hover.scheduleInitialCollapse();
  }

  function disable(): void {
    if (!enabled) return;
    enabled = false;

    hover.clearPending();

    if (autoCollapsed && isSidebarCollapsed()) {
      clickToggleButton();
    }
    autoCollapsed = false;

    hover.stop();

    if (fullHideEnabled) {
      fullHide.sync(enabled, isKeepExpandedLocked());
    } else {
      removeTransitionStyle();
    }

    maybeRemoveMenuClickHandler();

    teardownInfrastructure();
  }

  function enableFullHide(): void {
    if (fullHideEnabled) return;
    fullHideEnabled = true;

    insertTransitionStyle();
    fullHide.mount();
    ensureMenuClickHandler();

    setupInfrastructure();
    fullHide.sync(enabled, isKeepExpandedLocked());

    // Show edge trigger if sidebar is already collapsed
    scope.timer(() => {
      if (!fullHideEnabled) return;
      fullHide.sync(enabled, isKeepExpandedLocked());
    }, 300);
  }

  function disableFullHide(): void {
    if (!fullHideEnabled) return;
    fullHideEnabled = false;

    fullHide.unmount();

    if (!enabled) {
      removeTransitionStyle();
      hover.stop();
    }

    maybeRemoveMenuClickHandler();

    teardownInfrastructure();
  }

  scope.effect(
    () => () => {
      disable();
      disableFullHide();
    },
    'sidebar-hide:controller',
  );

  return {
    setAutoHide(value: boolean) {
      if (value) enable();
      else disable();
    },
    setFullHide(value: boolean) {
      if (value) enableFullHide();
      else disableFullHide();
    },
    keepExpanded() {
      hover.clearPending();
      if (isSidebarCollapsed()) expandSidebar();
      if (fullHideEnabled) fullHide.sync(enabled, isKeepExpandedLocked());
    },
    reconcile: checkAndReattach,
    destroy: () => scope.dispose(),
  };
}
