import { getSidebarAnimationElements, getSidenavElement, isSidebarCollapsed } from './sidebarDom';

const FULL_HIDE_STYLE_ID = 'gv-sidebar-full-hide-style';
const EDGE_TRIGGER_ID = 'gv-sidebar-edge-trigger';
const FULL_HIDE_COLLAPSED_CLASS = 'gv-sidebar-full-hide-collapsed';
const FULL_HIDE_COLLAPSING_CLASS = 'gv-sidebar-full-hide-collapsing';
const FULL_HIDE_COLLAPSE_SYNC_DELAY_MS = 260;
const SIDEBAR_STATE_SYNC_DELAYS_MS = [FULL_HIDE_COLLAPSE_SYNC_DELAY_MS, 500] as const;
const EDGE_TRIGGER_WIDTH = 6;

interface FullHideCallbacks {
  onEdgeEnter: () => void;
  onEdgeLeave: (event: MouseEvent) => void;
  onReconcile: () => void;
}

export function createFullHide(callbacks: FullHideCallbacks) {
  let edgeTriggerElement: HTMLElement | null = null;
  let sidebarStateSyncTimeoutIds: number[] = [];
  let fullHideCollapsedSyncBlockedUntil = 0;
  let fullHideCollapseAnimationTimeoutId: number | null = null;
  let fullHideCollapseAnimationElements: HTMLElement[] = [];

  function getFullHideStyle(): string {
    return `
    /* Animate to zero width before fully hiding collapsed sidebar */
    html.${FULL_HIDE_COLLAPSING_CLASS} bard-sidenav,
    html.${FULL_HIDE_COLLAPSING_CLASS} bard-sidenav side-navigation-content,
    html.${FULL_HIDE_COLLAPSING_CLASS} bard-sidenav side-navigation-content > div {
      width: 0 !important;
      min-width: 0 !important;
      overflow: hidden !important;
    }

    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav,
    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav side-navigation-content,
    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav side-navigation-content > div {
      width: 0 !important;
      min-width: 0 !important;
      max-width: 0 !important;
      flex-basis: 0 !important;
      overflow: hidden !important;
    }

    /* Fully hide collapsed sidebar */
    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav,
    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav side-navigation-content,
    html.${FULL_HIDE_COLLAPSED_CLASS}:not(.${FULL_HIDE_COLLAPSING_CLASS}) bard-sidenav side-navigation-content > div {
      padding: 0 !important;
    }
  `;
  }

  function insertFullHideStyle(): void {
    if (document.getElementById(FULL_HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FULL_HIDE_STYLE_ID;
    style.textContent = getFullHideStyle();
    document.documentElement.appendChild(style);
  }

  function removeFullHideStyle(): void {
    const style = document.getElementById(FULL_HIDE_STYLE_ID);
    if (style) style.remove();
  }

  function createEdgeTrigger(): void {
    if (edgeTriggerElement) return;
    const el = document.createElement('div');
    el.id = EDGE_TRIGGER_ID;
    el.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: ${EDGE_TRIGGER_WIDTH}px;
    height: 100vh;
    z-index: 99999;
    background: transparent;
    display: none;
  `;
    el.addEventListener('mouseenter', callbacks.onEdgeEnter);
    el.addEventListener('mouseleave', callbacks.onEdgeLeave);
    document.documentElement.appendChild(el);
    edgeTriggerElement = el;
  }

  function removeEdgeTrigger(): void {
    if (edgeTriggerElement) {
      edgeTriggerElement.removeEventListener('mouseenter', callbacks.onEdgeEnter);
      edgeTriggerElement.removeEventListener('mouseleave', callbacks.onEdgeLeave);
      edgeTriggerElement.remove();
      edgeTriggerElement = null;
    }
  }

  function showEdgeTrigger(): void {
    if (edgeTriggerElement) {
      edgeTriggerElement.style.display = 'block';
    }
  }

  function hideEdgeTrigger(): void {
    if (edgeTriggerElement) {
      edgeTriggerElement.style.display = 'none';
    }
  }

  function clearScheduledSidebarStateSync(): void {
    for (const timeoutId of sidebarStateSyncTimeoutIds) {
      window.clearTimeout(timeoutId);
    }
    sidebarStateSyncTimeoutIds = [];
    fullHideCollapsedSyncBlockedUntil = 0;
  }

  function clearFullHideCollapseAnimation(): void {
    if (fullHideCollapseAnimationTimeoutId !== null) {
      window.clearTimeout(fullHideCollapseAnimationTimeoutId);
      fullHideCollapseAnimationTimeoutId = null;
    }
    document.documentElement.classList.remove(FULL_HIDE_COLLAPSING_CLASS);
    for (const element of fullHideCollapseAnimationElements) {
      element.style.removeProperty('width');
      element.style.removeProperty('min-width');
      element.style.removeProperty('overflow');
    }
    fullHideCollapseAnimationElements = [];
  }

  function startFullHideCollapseAnimation(): void {
    clearFullHideCollapseAnimation();
    const elements = getSidebarAnimationElements();

    fullHideCollapseAnimationElements = elements;
    for (const element of elements) {
      const width = element.getBoundingClientRect().width;
      element.style.setProperty('width', `${width}px`, 'important');
      element.style.setProperty('min-width', `${width}px`, 'important');
      element.style.setProperty('overflow', 'hidden', 'important');
    }

    getSidenavElement()?.getBoundingClientRect();
    document.documentElement.classList.add(FULL_HIDE_COLLAPSING_CLASS);
    for (const element of elements) {
      element.style.setProperty('width', '0px', 'important');
      element.style.setProperty('min-width', '0px', 'important');
    }

    fullHideCollapseAnimationTimeoutId = window.setTimeout(
      () => {
        fullHideCollapseAnimationTimeoutId = null;
        clearFullHideCollapseAnimation();
      },
      SIDEBAR_STATE_SYNC_DELAYS_MS[SIDEBAR_STATE_SYNC_DELAYS_MS.length - 1],
    );
  }

  function scheduleSidebarStateSync(syncImmediately: boolean): void {
    clearScheduledSidebarStateSync();
    if (syncImmediately) {
      clearFullHideCollapseAnimation();
    }

    if (!syncImmediately) {
      fullHideCollapsedSyncBlockedUntil = Date.now() + FULL_HIDE_COLLAPSE_SYNC_DELAY_MS;
    }

    const delays = syncImmediately
      ? ([0, ...SIDEBAR_STATE_SYNC_DELAYS_MS] as const)
      : SIDEBAR_STATE_SYNC_DELAYS_MS;

    for (const delay of delays) {
      const timeoutId = window.setTimeout(() => {
        callbacks.onReconcile();
        sidebarStateSyncTimeoutIds = sidebarStateSyncTimeoutIds.filter((id) => id !== timeoutId);
      }, delay);
      sidebarStateSyncTimeoutIds.push(timeoutId);
    }
  }

  function setFullHideCollapsedState(collapsed: boolean): void {
    document.documentElement.classList.toggle(FULL_HIDE_COLLAPSED_CLASS, collapsed);
  }

  function syncFullHideState(autoHideEnabled: boolean, keepExpandedLocked: boolean): void {
    if (keepExpandedLocked) {
      clearFullHideCollapseAnimation();
      setFullHideCollapsedState(false);
      hideEdgeTrigger();
      return;
    }

    const sidenav = getSidenavElement();
    const sidenavExists = Boolean(sidenav && sidenav.getBoundingClientRect().height > 0);
    const collapsed = sidenavExists && isSidebarCollapsed();

    if (collapsed && Date.now() < fullHideCollapsedSyncBlockedUntil) return;
    if (!collapsed) {
      fullHideCollapsedSyncBlockedUntil = 0;
      clearFullHideCollapseAnimation();
    }

    setFullHideCollapsedState(collapsed);

    if (collapsed) {
      if (autoHideEnabled) {
        showEdgeTrigger();
      } else {
        hideEdgeTrigger();
      }
    } else {
      hideEdgeTrigger();
    }
  }

  return {
    mount() {
      insertFullHideStyle();
      createEdgeTrigger();
    },
    unmount() {
      clearScheduledSidebarStateSync();
      clearFullHideCollapseAnimation();
      setFullHideCollapsedState(false);
      removeEdgeTrigger();
      removeFullHideStyle();
    },
    sync: syncFullHideState,
    beforeToggle(wasCollapsed: boolean) {
      if (!wasCollapsed) startFullHideCollapseAnimation();
    },
    afterToggle: scheduleSidebarStateSync,
    clearScheduledSync: clearScheduledSidebarStateSync,
    isEdgeHovered() {
      return edgeTriggerElement?.matches(':hover') ?? false;
    },
  };
}
