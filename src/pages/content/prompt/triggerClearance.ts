/**
 * Keeps default floating surfaces off the Prompt Manager ball and composer.
 *
 * The folder FAB and the floating folder panel default to the same
 * bottom-right corner as the ball, and the FAB stacks above it, so the ball
 * could not be clicked. Only default spots go through here: a spot the user
 * saved by dragging is theirs.
 */

import { readInputPlacement } from '@/core/services/composer/inputPlacement';

import { findChatInput } from '../chatInput';

export const PROMPT_TRIGGER_ELEMENT_ID = 'gv-pm-trigger';

/** `.gv-pm-trigger` in src/styles/contentStyle/: 46px, 18px in from the bottom inline-end corner. */
export const PROMPT_TRIGGER_DEFAULT_INSET = 18;
export const PROMPT_TRIGGER_SIZE = 46;

const GAP = 12;
const VIEWPORT_MARGIN = 8;

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

/**
 * Where the ball is: its live box when it is on screen, otherwise its default
 * slot, mirrored for RTL. The slot also covers a ball that mounts later or that
 * the user hid and may show again.
 */
export function promptTriggerBox(): Box {
  const trigger = document.getElementById(PROMPT_TRIGGER_ELEMENT_ID);
  const rect = trigger?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }
  const rtl = document.body?.classList.contains('gv-rtl') ?? false;
  const inset = PROMPT_TRIGGER_DEFAULT_INSET;
  const size = PROMPT_TRIGGER_SIZE;
  return {
    x: rtl ? inset : window.innerWidth - inset - size,
    y: window.innerHeight - inset - size,
    w: size,
    h: size,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function fitsViewport(box: Box): boolean {
  return (
    box.x >= VIEWPORT_MARGIN &&
    box.y >= VIEWPORT_MARGIN &&
    box.x + box.w <= window.innerWidth - VIEWPORT_MARGIN &&
    box.y + box.h <= window.innerHeight - VIEWPORT_MARGIN
  );
}

/** The input's control surface, using the same anchors as native composer integrations. */
function composerElement(): HTMLElement | null {
  const input = findChatInput();
  return (
    (input
      ? readInputPlacement(
          'input.clearance',
          (selector) => input.closest<HTMLElement>(selector),
          input.ownerDocument,
          false,
        )
      : null) ?? input
  );
}

function composerBox(): Box | null {
  const rect = composerElement()?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0
    ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    : null;
}

/**
 * Moves a default spot off the ball and composer. The first clear spot that fits wins: beside the
 * ball towards the page (left of it in LTR), then above it, then on its other
 * side. Beside the ball, the box is centred on it when it fits and otherwise
 * keeps its own height. The slot above the ball is tried second because the
 * Research Pack launcher sits there.
 */
export function clearOfPromptTrigger(box: Box): Point {
  const ball = promptTriggerBox();
  const composer = composerBox();
  const clear = (candidate: Box) =>
    !boxesOverlap(candidate, ball) && (!composer || !boxesOverlap(candidate, composer));
  if (clear(box)) return { x: box.x, y: box.y };

  const centred = ball.y + (ball.h - box.h) / 2;
  const besideY = fitsViewport({ ...box, y: centred }) ? centred : box.y;
  const towardsPage = ball.x + ball.w / 2 > window.innerWidth / 2;
  const before = { x: ball.x - GAP - box.w, y: besideY };
  const after = { x: ball.x + ball.w + GAP, y: besideY };
  const above = { x: box.x, y: ball.y - GAP - box.h };
  const candidates = towardsPage ? [before, above, after] : [after, above, before];
  if (composer) {
    candidates.push({ x: above.x, y: Math.min(ball.y, composer.y) - GAP - box.h });
  }

  for (const spot of candidates) {
    const moved = { ...box, ...spot };
    if (fitsViewport(moved) && clear(moved)) {
      return { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
  }
  return { x: box.x, y: box.y };
}

/**
 * Calls `onChange` once a frame after the ball or composer mounts, moves, shows
 * or hides. The Prompt Manager moves its ball next to Gemini's composer up to
 * 350ms after load, after a default-placed surface may already have been
 * placed. Returns the cleanup.
 */
export function watchPromptTrigger(onChange: () => void): () => void {
  let frame: number | null = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      bindComposer();
      onChange();
    });
  };

  let watched: HTMLElement | null = null;
  let watchedComposer: HTMLElement | null = null;
  const composerResize = new ResizeObserver(schedule);
  const bindComposer = () => {
    const current = composerElement();
    if (current === watchedComposer) return;
    composerResize.disconnect();
    watchedComposer = current;
    if (current) composerResize.observe(current);
  };
  const ballObserver = new MutationObserver(schedule);
  const bind = () => {
    const current = document.getElementById(PROMPT_TRIGGER_ELEMENT_ID);
    if (current === watched) return false;
    ballObserver.disconnect();
    watched = current;
    if (current) {
      ballObserver.observe(current, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
    }
    return true;
  };
  // Streaming nodes outside the composer need no selector or layout pass.
  const mountObserver = new MutationObserver((records) => {
    if (
      bind() ||
      records.some((record) => {
        if (record.type === 'childList' && !watchedComposer?.isConnected) return true;
        return (
          watchedComposer &&
          record.target instanceof Element &&
          record.target.contains(watchedComposer)
        );
      })
    )
      schedule();
  });
  bind();
  bindComposer();
  if (document.body)
    mountObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    });

  return () => {
    mountObserver.disconnect();
    ballObserver.disconnect();
    composerResize.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
}
