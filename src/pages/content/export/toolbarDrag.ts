// Dragging the persistent export toolbar by its button, with mouse, pen or
// touch. A press that travels less than the threshold stays a click; a drag
// never lets its closing click through to the export.
import { isUserEvent } from '@/core/utils/userEvent';

import { type ToolbarSpot, clampRight, clampTop } from './toolbarAvoidance';

/** Pointer travel, in px, past which a press is a drag rather than a click (as on the prompt ball). */
const DRAG_THRESHOLD_PX = 5;
/** How long a drag's own click may take to arrive; touch delivers it after the gesture ends. */
const CLICK_SUPPRESS_MS = 600;

export type ToolbarDragCallbacks = {
  /** The press became a drag; the toolbar stops avoiding until it is dropped. */
  begin: () => void;
  move: (spot: ToolbarSpot) => void;
  drop: (spot: ToolbarSpot) => void;
  /** The browser took the pointer away (pointercancel): put the toolbar back. */
  cancel: () => void;
};

type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where in the toolbar the pointer grabbed it, so the toolbar does not jump to the pointer. */
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  dragging: boolean;
};

/** The spot that puts the grabbed point under the pointer, inside the viewport. */
function spotAt(ev: PointerEvent, press: Press): ToolbarSpot {
  const left = ev.clientX - press.grabX;
  return {
    right: clampRight(window.innerWidth - left - press.width, press.width),
    top: clampTop(ev.clientY - press.grabY, press.height),
  };
}

/** Makes `handle` drag `root`; returns the teardown. */
export function attachToolbarDrag(
  root: HTMLElement,
  handle: HTMLElement,
  callbacks: ToolbarDragCallbacks,
): () => void {
  let press: Press | null = null;
  let suppressClick = false;
  let suppressTimer: number | null = null;

  const endPress = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', abortPress);
    window.removeEventListener('keydown', onKeyDown, true);
    handle.removeEventListener('lostpointercapture', onLostCapture);
    if (press) {
      try {
        handle.releasePointerCapture?.(press.pointerId);
      } catch {}
    }
    press = null;
  };

  /** Puts a drag back where it started: the release never arrived. */
  function abortPress() {
    const dragged = press?.dragging ?? false;
    endPress();
    if (dragged) callbacks.cancel();
  }

  const onMove = (ev: PointerEvent) => {
    if (!press || ev.pointerId !== press.pointerId) return;
    // No button held: the release went elsewhere (a window switch, a system
    // dialog), and the toolbar would follow a hovering pointer until a click.
    if (press.dragging && ev.buttons === 0) {
      abortPress();
      return;
    }
    if (!press.dragging) {
      const dx = Math.abs(ev.clientX - press.startX);
      const dy = Math.abs(ev.clientY - press.startY);
      if (dx <= DRAG_THRESHOLD_PX && dy <= DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      callbacks.begin();
    }
    callbacks.move(spotAt(ev, press));
  };

  const onUp = (ev: PointerEvent) => {
    if (!press || ev.pointerId !== press.pointerId) return;
    const dragged = press.dragging;
    const spot = dragged ? spotAt(ev, press) : null;
    endPress();
    if (!spot) return;
    suppressClick = true;
    if (suppressTimer !== null) window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressClick = false;
      suppressTimer = null;
    }, CLICK_SUPPRESS_MS);
    callbacks.drop(spot);
  };

  const onCancel = (ev: PointerEvent) => {
    if (!press || ev.pointerId !== press.pointerId) return;
    abortPress();
  };
  // Also fires after a normal release, which has already ended the press.
  const onLostCapture = (ev: PointerEvent) => {
    if (press && ev.pointerId === press.pointerId) abortPress();
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && press?.dragging) abortPress();
  };

  const onDown = (ev: PointerEvent) => {
    if (!isUserEvent(ev) || (typeof ev.button === 'number' && ev.button !== 0)) return;
    if (press) endPress();
    suppressClick = false;
    const rect = root.getBoundingClientRect();
    press = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      grabX: ev.clientX - rect.left,
      grabY: ev.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      dragging: false,
    };
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {}
    // Capture phase on window: the button stops its pointer events from
    // bubbling to the host page, which would also hide them from window.
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('blur', abortPress);
    window.addEventListener('keydown', onKeyDown, true);
    handle.addEventListener('lostpointercapture', onLostCapture);
  };

  // Registered in the capture phase so it runs before the button's export click.
  // Only a pointer's click (detail > 0): Enter or `openPersistentExportToolbar` still export.
  const onClick = (ev: MouseEvent) => {
    if (!suppressClick || ev.detail === 0) return;
    suppressClick = false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };

  // Capture phase: the button stops its presses in a capture listener so the
  // host page never sees them, which also skips its bubble-phase listeners.
  handle.addEventListener('pointerdown', onDown, true);
  handle.addEventListener('click', onClick, true);
  return () => {
    endPress();
    if (suppressTimer !== null) window.clearTimeout(suppressTimer);
    handle.removeEventListener('pointerdown', onDown, true);
    handle.removeEventListener('click', onClick, true);
  };
}
