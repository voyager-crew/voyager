import { LAYER_ATTR } from '@/core/ui/layer';
import { POPOVER_LAYER_HOST_CLASS } from '@/pages/content/folder/floatingTree/popoverLayer';

import { getSidebarHoverPopups } from './popupTargets';
import { getSidenavElement, isSidebarCollapsed, isSidebarVisible } from './sidebarDom';

const LEAVE_DELAY_MS = 400;
const ENTER_DELAY_MS = 150;
const PREDICTIVE_ZONE_WIDTH = 100;
const PREDICTIVE_VELOCITY_THRESHOLD = -0.5; // px/ms (negative = leftward)
const PREDICTIVE_THROTTLE_MS = 50;
const PREDICTIVE_SAFETY_COLLAPSE_MS = 1200;
const CUSTOM_POPUP_SELECTORS = [
  '.gv-folder-dialog',
  '.gv-folder-dialog-overlay',
  `[${LAYER_ATTR}="popover"]`,
  '.gv-folder-import-dialog',
  '.gv-folder-menu',
  '.gv-color-picker-dialog',
  // The folder tree's right-click menu, inside a 0×0 body-level host (#1059).
  `.${POPOVER_LAYER_HOST_CLASS}`,
];

function hasBox(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/** A shadow host may be an empty box whose popover is drawn inside it. */
function isElementVisible(element: HTMLElement): boolean {
  if (hasBox(element)) return true;
  const inside = element.shadowRoot?.querySelectorAll<HTMLElement>('*') ?? [];
  return Array.from(inside).some(hasBox);
}

/** Typing in the sidebar, such as renaming a folder inline; its tree is a shadow host. */
function isEditingIn(sidenav: HTMLElement | null): boolean {
  let active = document.activeElement;
  if (!sidenav || !active || !sidenav.contains(active)) return false;
  while (active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return (
    active instanceof HTMLElement && (active.matches('input, textarea') || active.isContentEditable)
  );
}

interface HoverIntentCallbacks {
  isEnabled: () => boolean;
  isEdgeHovered: () => boolean;
  expand: () => void;
  collapse: () => void;
}

export function createHoverIntent(callbacks: HoverIntentCallbacks) {
  let initialCollapseTimeoutId: number | null = null;
  let enterTimeoutId: number | null = null;
  let leaveTimeoutId: number | null = null;
  let sidenavElement: HTMLElement | null = null;
  let pausedUntil = 0;
  let predictiveTriggered = false;
  let lastMouseX: number | null = null;
  let lastMouseTime: number | null = null;
  let lastMoveProcessedTime = 0;
  let predictiveMouseMoveHandler: ((event: MouseEvent) => void) | null = null;

  function isPaused(): boolean {
    return Date.now() < pausedUntil;
  }

  function clearAutoHideTimers(): void {
    if (enterTimeoutId !== null) {
      window.clearTimeout(enterTimeoutId);
      enterTimeoutId = null;
    }
    if (leaveTimeoutId !== null) {
      window.clearTimeout(leaveTimeoutId);
      leaveTimeoutId = null;
    }
    // A stale 500ms deadline could otherwise collapse a re-enabled run.
    if (initialCollapseTimeoutId !== null) {
      window.clearTimeout(initialCollapseTimeoutId);
      initialCollapseTimeoutId = null;
    }
    resetPredictiveState();
  }

  function pauseAutoCollapse(durationMs: number): void {
    pausedUntil = Date.now() + durationMs;
  }

  function isPopupOrDialogOpen(): boolean {
    const { dialogs: matDialogs, menus: matMenus } = getSidebarHoverPopups();
    for (const dialog of matDialogs) {
      if (isElementVisible(dialog)) return true;
    }

    for (const menu of matMenus) {
      if (isElementVisible(menu)) return true;
    }

    for (const selector of CUSTOM_POPUP_SELECTORS) {
      const customPopups = document.querySelectorAll<HTMLElement>(selector);
      for (const popup of customPopups) {
        if (isElementVisible(popup)) return true;
      }
    }

    return false;
  }

  function isMouseOverSidebarArea(): boolean {
    if (callbacks.isEdgeHovered()) return true;
    if (sidenavElement?.matches(':hover')) return true;

    const { dialogs: matDialogs, menus: matMenus } = getSidebarHoverPopups();
    for (const dialog of matDialogs) {
      if (dialog.matches(':hover')) return true;
    }

    for (const menu of matMenus) {
      if (menu.matches(':hover')) return true;
    }

    for (const selector of CUSTOM_POPUP_SELECTORS) {
      const customPopups = document.querySelectorAll<HTMLElement>(selector);
      for (const popup of customPopups) {
        if (popup.matches(':hover')) return true;
      }
    }

    return false;
  }

  function resetPredictiveState(): void {
    predictiveTriggered = false;
    lastMouseX = null;
    lastMouseTime = null;
  }

  function handlePredictiveMouseMove(e: MouseEvent): void {
    if (!callbacks.isEnabled()) return;
    if (!isSidebarCollapsed()) return;
    // If the sidebar is collapsed while the flag is still set, it was collapsed
    // by an external path (manual toggle, full-hide sync, etc.) that did not
    // call resetPredictiveState(). Clear the stale latch so the next swipe works.
    if (predictiveTriggered) {
      resetPredictiveState();
      return;
    }
    if (isPaused()) return;

    const now = performance.now();
    if (now - lastMoveProcessedTime < PREDICTIVE_THROTTLE_MS) return;
    lastMoveProcessedTime = now;

    const x = e.clientX;

    if (lastMouseX !== null && lastMouseTime !== null) {
      const dt = now - lastMouseTime;
      // Only use recent samples; ignore stale data (e.g. after tab switch)
      if (dt > 0 && dt < 200) {
        const vx = (x - lastMouseX) / dt; // px/ms, negative = leftward

        if (x <= PREDICTIVE_ZONE_WIDTH && vx <= PREDICTIVE_VELOCITY_THRESHOLD) {
          predictiveTriggered = true;

          // Cancel any pending enter/leave timers to avoid double-action
          if (enterTimeoutId !== null) {
            window.clearTimeout(enterTimeoutId);
            enterTimeoutId = null;
          }
          if (leaveTimeoutId !== null) {
            window.clearTimeout(leaveTimeoutId);
            leaveTimeoutId = null;
          }

          callbacks.expand();

          // Safety net: if the mouse never actually enters the sidebar
          // (user changed direction mid-flight), auto-collapse after a
          // generous window. handleMouseEnter will clear this if triggered.
          leaveTimeoutId = window.setTimeout(() => {
            leaveTimeoutId = null;
            if (!callbacks.isEnabled()) return;
            callbacks.collapse();
          }, PREDICTIVE_SAFETY_COLLAPSE_MS);

          lastMouseX = x;
          lastMouseTime = now;
          return;
        }
      }
    }

    lastMouseX = x;
    lastMouseTime = now;
  }

  function attachPredictiveListener(): void {
    if (predictiveMouseMoveHandler) return;
    predictiveMouseMoveHandler = handlePredictiveMouseMove;
    document.addEventListener('mousemove', predictiveMouseMoveHandler, { passive: true });
  }

  function detachPredictiveListener(): void {
    if (!predictiveMouseMoveHandler) return;
    document.removeEventListener('mousemove', predictiveMouseMoveHandler);
    predictiveMouseMoveHandler = null;
    resetPredictiveState();
  }

  // ─── Mouse Event Handlers ──────────────────────────────────────────────

  function handleMouseEnter(): void {
    if (!callbacks.isEnabled()) return;

    if (leaveTimeoutId !== null) {
      window.clearTimeout(leaveTimeoutId);
      leaveTimeoutId = null;
    }

    if (enterTimeoutId !== null) {
      window.clearTimeout(enterTimeoutId);
    }

    enterTimeoutId = window.setTimeout(() => {
      enterTimeoutId = null;
      if (!callbacks.isEnabled()) return;
      callbacks.expand();
    }, ENTER_DELAY_MS);
  }

  function handleMouseLeave(): void {
    if (!callbacks.isEnabled()) return;

    if (enterTimeoutId !== null) {
      window.clearTimeout(enterTimeoutId);
      enterTimeoutId = null;
    }

    if (leaveTimeoutId !== null) {
      window.clearTimeout(leaveTimeoutId);
    }

    leaveTimeoutId = window.setTimeout(() => {
      leaveTimeoutId = null;
      if (!callbacks.isEnabled()) return;
      callbacks.collapse();
    }, LEAVE_DELAY_MS);
  }

  function attachEventListeners(): boolean {
    const sidenav = getSidenavElement();
    if (!sidenav) return false;
    if (!isSidebarVisible()) return false;
    if (sidenav === sidenavElement) return true;

    if (sidenavElement) {
      sidenavElement.removeEventListener('mouseenter', handleMouseEnter);
      sidenavElement.removeEventListener('mouseleave', handleMouseLeave);
    }

    sidenavElement = sidenav;
    sidenav.addEventListener('mouseenter', handleMouseEnter);
    sidenav.addEventListener('mouseleave', handleMouseLeave);
    return true;
  }

  function detachEventListeners(): void {
    if (sidenavElement) {
      sidenavElement.removeEventListener('mouseenter', handleMouseEnter);
      sidenavElement.removeEventListener('mouseleave', handleMouseLeave);
      sidenavElement = null;
    }
  }

  function handleEdgeTriggerLeave(e: MouseEvent): void {
    if (!callbacks.isEnabled()) return;

    const related = e.relatedTarget as HTMLElement | null;
    if (related) {
      const sidenav = getSidenavElement();
      if (sidenav && (sidenav === related || sidenav.contains(related))) {
        return;
      }
    }

    if (enterTimeoutId !== null) {
      window.clearTimeout(enterTimeoutId);
      enterTimeoutId = null;
    }
  }

  function reattach(): boolean {
    const currentSidenav = getSidenavElement();
    const disconnected = sidenavElement !== null && !sidenavElement.isConnected;
    if (disconnected) detachEventListeners();
    if (sidenavElement && !isSidebarVisible()) {
      detachEventListeners();
    } else if (currentSidenav && isSidebarVisible() && currentSidenav !== sidenavElement) {
      attachEventListeners();
    }
    return disconnected;
  }

  return {
    start() {
      pausedUntil = 0;
      attachEventListeners();
      attachPredictiveListener();
    },
    stop() {
      clearAutoHideTimers();
      pausedUntil = 0;
      detachEventListeners();
      detachPredictiveListener();
    },
    scheduleInitialCollapse() {
      initialCollapseTimeoutId = window.setTimeout(() => {
        initialCollapseTimeoutId = null;
        if (!callbacks.isEnabled()) return;
        if (sidenavElement && !sidenavElement.matches(':hover') && !isPopupOrDialogOpen()) {
          callbacks.collapse();
        }
      }, 500);
    },
    reattach,
    canCollapse() {
      return (
        !isPaused() &&
        !isPopupOrDialogOpen() &&
        !isMouseOverSidebarArea() &&
        !isEditingIn(sidenavElement)
      );
    },
    pause: pauseAutoCollapse,
    clearPending: clearAutoHideTimers,
    resetPrediction: resetPredictiveState,
    enter: handleMouseEnter,
    leaveEdge: handleEdgeTriggerLeave,
  };
}
