// Keeps the persistent export toolbar placed: in its default top-right dock or
// on the spot the user dragged it to, clear of host controls as the page
// changes, and hidden while a fullscreen Canvas needs the corner.
import {
  type AvoidanceContext,
  CANVAS_OWNER_SELECTOR,
  type MeasuredControls,
  type ToolbarSpot,
  classifyAvoidanceMutations,
  clampRight,
  clampTop,
  indexMeasuredControls,
  measureTopRightControls,
} from './toolbarAvoidance';
import { attachToolbarDrag } from './toolbarDrag';
import { type ToolbarOcclusion, detectToolbarOcclusion } from './toolbarOcclusion';

export const RIGHT_OFFSET_PROPERTY = '--gv-persistent-export-right';
const HIDDEN_CLASS = 'gv-hidden';
const DRAGGING_CLASS = 'gv-persistent-export-toolbar--dragging';
/** Steps under a host dialog's backdrop instead of floating over the dimmed page. */
const UNDER_MODAL_CLASS = 'gv-persistent-export-toolbar--under-modal';
const INACTIVE_CANVAS_SELECTOR = 'deep-research-immersive-panel, [hidden], [aria-hidden="true"]';
/**
 * Least time between re-measurements started by unlabeled controls appearing.
 * Those also stream in with replies and sidebar rows, and each re-measure
 * hit-tests the row; without a floor that is a forced layout per frame (#1040).
 */
const SOFT_REMEASURE_INTERVAL_MS = 250;
/**
 * A change re-measures once more this long after things go quiet: a panel
 * sliding in by transform moves its controls without a mutation or a width change.
 */
const SETTLE_REMEASURE_MS = 300;
/** A drop this close to the dock on both axes snaps back to it and forgets the saved spot. */
const DOCK_SNAP_PX = 24;
/** The toolbar's size before it has one (hidden by a fullscreen Canvas). */
const FALLBACK_SIZE = { width: 80, height: 36 };

export type ToolbarPlacementOptions = {
  /** The element the user drags; the toolbar's button. */
  handle: HTMLElement;
  turnSelector: string;
  /** The user dropped the toolbar: the spot to remember, or null when it snapped back to the dock. */
  onSpotChange: (spot: ToolbarSpot | null) => void;
};

export type ToolbarPlacement = {
  /** Moves to a remembered spot, unless the user already dropped the toolbar on this page. */
  restoreSpot: (spot: ToolbarSpot) => void;
  stop: () => void;
};

let active: { root: HTMLElement; placement: ToolbarPlacement } | null = null;

/** Places `root` until it leaves the page or `stop` runs; one toolbar is placed at a time. */
export function startToolbarPlacement(
  root: HTMLElement,
  options: ToolbarPlacementOptions,
): ToolbarPlacement {
  if (active?.root === root) return active.placement;
  active?.placement.stop();

  let spot: ToolbarSpot | null = null;
  let dropped = false;
  let dragging = false;
  let frameId: number | null = null;
  let softTimer: number | null = null;
  let settleTimer: number | null = null;
  let settleAfterUpdate = false;
  let lastSoftAt = Number.NEGATIVE_INFINITY;
  let measured: MeasuredControls = indexMeasuredControls([]);
  let last: { watched: HTMLElement[]; hidden: HTMLElement[]; canvas: HTMLElement[] } = {
    watched: [],
    hidden: [],
    canvas: [],
  };
  let size = FALLBACK_SIZE;
  let appliedOffset = root.style.getPropertyValue(RIGHT_OFFSET_PROPERTY);
  const context = (): AvoidanceContext => ({ turnSelector: options.turnSelector, spot });

  const applyRight = (offset: number) => {
    const next = `${offset}px`;
    if (next === appliedOffset) return;
    appliedOffset = next;
    root.style.setProperty(RIGHT_OFFSET_PROPERTY, next);
  };
  // Inline only for a user's spot; the dock's top comes from the per-site stylesheet.
  const applyTop = (top: number | null) => {
    const next = top === null ? '' : `${top}px`;
    if (root.style.top !== next) root.style.top = next;
  };

  const widthWatch = createWidthWatch(() => onTrigger('soft'));

  /** The toolbar's size, remembered while `display: none` reads it as 0 × 0. */
  const measureSize = () => {
    const rect = root.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) size = { width: rect.width, height: rect.height };
    return size;
  };

  const update = () => {
    frameId = null;
    if (!root.isConnected) {
      placement.stop();
      return;
    }
    if (dragging) return;
    if (settleAfterUpdate) {
      settleAfterUpdate = false;
      scheduleSettle();
    }
    // A backdrop or a menu's pointer lock hides the header from the hit-test;
    // measuring through it dropped the toolbar onto Share. Keep the last
    // offset, and watch the occluder so its removal re-measures.
    const holdUnder = (occlusion: ToolbarOcclusion) => {
      root.classList.toggle(UNDER_MODAL_CLASS, occlusion.modal);
      measured = indexMeasuredControls(last.watched, last.hidden, last.canvas, occlusion.occluders);
    };
    const before = detectToolbarOcclusion(root);
    if (before) {
      holdUnder(before);
      return;
    }
    applyTop(spot ? clampTop(spot.top, measureSize().height) : null);
    const { offset, watched, hidden, canvas, rowHosts, occluders } = measureTopRightControls(
      root,
      context(),
    );
    const during = occluders.length > 0 ? detectToolbarOcclusion(root, occluders) : null;
    if (during) {
      holdUnder(during);
      return;
    }
    root.classList.remove(UNDER_MODAL_CLASS);
    // Fullscreen Canvas puts Collapse under this pill; its own Export menu remains available.
    root.classList.toggle(
      HIDDEN_CLASS,
      canvas.some(
        (editor) =>
          editor.closest(CANVAS_OWNER_SELECTOR)?.matches('immersive-panel') &&
          !editor.closest(INACTIVE_CANVAS_SELECTOR),
      ),
    );
    last = { watched, hidden, canvas };
    measured = indexMeasuredControls(watched, hidden, canvas);
    widthWatch.track([...watched, ...rowHosts]);
    applyRight(spot ? clampRight(offset, measureSize().width) : offset);
  };
  const updateNow = () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    update();
  };
  function scheduleUpdate() {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(update);
  }
  const scheduleSettle = () => {
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      scheduleUpdate();
    }, SETTLE_REMEASURE_MS);
  };
  const scheduleSoftUpdate = () => {
    if (frameId !== null || softTimer !== null) return;
    const wait = lastSoftAt + SOFT_REMEASURE_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      lastSoftAt = Date.now();
      scheduleUpdate();
      return;
    }
    softTimer = window.setTimeout(() => {
      softTimer = null;
      lastSoftAt = Date.now();
      scheduleUpdate();
    }, wait);
  };

  /** A page change: re-measure (rate-limited when soft), then once more when it settles. */
  function onTrigger(trigger: 'soft' | 'hard') {
    settleAfterUpdate = true;
    if (trigger === 'hard') scheduleUpdate();
    else scheduleSoftUpdate();
  }

  const observer = new MutationObserver((mutations) => {
    if (frameId !== null) return;
    const trigger = classifyAvoidanceMutations(mutations, root, measured, options.turnSelector);
    if (trigger !== 'none') onTrigger(trigger);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
  });
  window.addEventListener('resize', scheduleUpdate);

  const detachDrag = attachToolbarDrag(root, options.handle, {
    begin: () => {
      dragging = true;
      root.classList.add(DRAGGING_CLASS);
    },
    move: (next) => {
      applyTop(next.top);
      applyRight(next.right);
    },
    drop: (next) => {
      dragging = false;
      dropped = true;
      root.classList.remove(DRAGGING_CLASS);
      // Where the dock would put the toolbar right now, to tell a drop back onto it.
      spot = null;
      applyTop(null);
      const dockTop = root.getBoundingClientRect().top;
      const dock = measureTopRightControls(root, context());
      // The dock spans its default offset and wherever avoidance moved it from
      // there: a drop on the bare default (right 84 beside Claude's Activity
      // button) was kept as a custom spot instead of resetting.
      const docked =
        Math.abs(next.top - dockTop) <= DOCK_SNAP_PX &&
        next.right >= Math.min(dock.anchor, dock.offset) - DOCK_SNAP_PX &&
        next.right <= Math.max(dock.anchor, dock.offset) + DOCK_SNAP_PX;
      spot = docked ? null : next;
      options.onSpotChange(spot);
      updateNow();
    },
    cancel: () => {
      dragging = false;
      root.classList.remove(DRAGGING_CLASS);
      updateNow();
    },
  });

  const placement: ToolbarPlacement = {
    restoreSpot: (next) => {
      if (dropped || dragging) return;
      spot = next;
      updateNow();
    },
    stop: () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      if (softTimer !== null) window.clearTimeout(softTimer);
      softTimer = null;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = null;
      observer.disconnect();
      widthWatch.stop();
      window.removeEventListener('resize', scheduleUpdate);
      detachDrag();
      if (active?.root === root) active = null;
    },
  };
  active = { root, placement };
  scheduleUpdate();
  return placement;
}

export function isToolbarPlaced(root: HTMLElement): boolean {
  return active?.root === root;
}

/** Stops placing `root` if it is the toolbar being placed. */
export function stopToolbarPlacement(root: HTMLElement): void {
  if (active?.root === root) active.placement.stop();
}

/**
 * Calls `onChange` when an element under or beside the toolbar, or one of its
 * ancestors, changes width: a side panel opening, closing or being resized
 * moves host controls without any DOM change near them. Height is ignored, as
 * replies grow their containers' height while they stream.
 */
function createWidthWatch(onChange: () => void): {
  track: (elements: readonly HTMLElement[]) => void;
  stop: () => void;
} {
  if (typeof ResizeObserver !== 'function') return { track: () => {}, stop: () => {} };
  const widths = new Map<Element, number>();
  const observed = new Set<Element>();
  const resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width);
      const previous = widths.get(entry.target);
      widths.set(entry.target, width);
      if (previous !== undefined && previous !== width) changed = true;
    }
    if (changed) onChange();
  });
  return {
    track: (elements) => {
      const next = new Set<Element>();
      for (const element of elements) {
        for (
          let node: Element | null = element;
          node && node !== document.body && node !== document.documentElement;
          node = node.parentElement
        ) {
          if (next.has(node)) break;
          next.add(node);
        }
      }
      for (const element of observed) {
        if (next.has(element)) continue;
        resizeObserver.unobserve(element);
        observed.delete(element);
        widths.delete(element);
      }
      for (const element of next) {
        if (observed.has(element)) continue;
        observed.add(element);
        resizeObserver.observe(element);
      }
    },
    stop: () => {
      resizeObserver.disconnect();
      observed.clear();
      widths.clear();
    },
  };
}
