/**
 * How a navigator jump moves, and how to tell when it has stopped.
 *
 * Two facts drive this. A jump should glide — the Gemini timeline always has —
 * unless the reader asked for less motion. And the navigator's homing loop,
 * which re-aims after content mounts or re-measures, fires on a short timer; if
 * it lands while a long smooth scroll is still travelling it reads a position
 * mid-flight and jumps again, which looks worse than never animating at all.
 * So the caller waits for the scroll to settle before homing.
 */

/** Polling a smooth scroll to a stop: two identical reads, or give up. */
const SETTLE_POLL_MS = 80;
const SETTLE_TIMEOUT_MS = 1200;
/** Two stable reads, so a single coincidence mid-animation does not count. */
const STABLE_READS = 2;

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `smooth`, unless the reader asked for less motion. */
export function navigationScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'instant' : 'smooth';
}

/**
 * Call `next` once the scroll offset stops changing, or after a cap.
 *
 * Polled rather than driven by `scrollend`, which is absent on the Safari this
 * extension still supports, and capped so a container that never settles — one
 * whose content keeps growing, say — cannot strand the caller. `timer` is the
 * caller's scope timer, so the poll dies with the plugin.
 */
export function afterScrollSettles(
  readScrollTop: () => number,
  timer: (run: () => void, ms: number) => void,
  isDisposed: () => boolean,
  next: () => void,
): void {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last = readScrollTop();
  let stable = 0;

  const tick = (): void => {
    if (isDisposed()) return;
    const current = readScrollTop();
    stable = current === last ? stable + 1 : 0;
    last = current;
    if (stable >= STABLE_READS || Date.now() > deadline) {
      next();
      return;
    }
    timer(tick, SETTLE_POLL_MS);
  };

  timer(tick, SETTLE_POLL_MS);
}

/** Where an active turn sits in the viewport: a little above the middle. */
const ACTIVE_ANCHOR = 0.45;

type ScrollTarget = HTMLElement | Window | null;

/**
 * A `flex-direction: column-reverse` scroller anchors its scroll origin at the
 * END of the content: `scrollTop` runs from 0 (newest) down to `-range` (the
 * conversation's start). Every offset the navigator compares grows from the
 * start, so such a container is translated on the way in and back on the way
 * out; otherwise `Math.max(0, …)` sends every jump to the newest turn.
 * (ChatGPT's thread was reported to scroll this way; a normal scroller is
 * unaffected.)
 *
 * Only the scroller's own layout decides it. A negative `scrollTop` is not
 * evidence: Safari reports one on an ordinary scroller during rubber-band
 * overscroll. A reversed flex box INSIDE an ordinary scroller does not move
 * the scroll origin either, so the content's direction is irrelevant.
 */
const reverseByStyle = new WeakMap<HTMLElement, boolean>();

function isReverseScroller(container: HTMLElement): boolean {
  // Read once per container: this runs on every scroll event.
  let reverse = reverseByStyle.get(container);
  if (reverse === undefined) {
    try {
      const style = getComputedStyle(container);
      reverse = style.flexDirection === 'column-reverse' && /flex/.test(style.display);
    } catch {
      reverse = false;
    }
    reverseByStyle.set(container, reverse);
  }
  return reverse;
}

function scrollRange(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

/** The target's scroll offset measured from the start of the conversation. */
export function readScrollOffset(target: ScrollTarget): number {
  if (!target || target === window) {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }
  const container = target as HTMLElement;
  return isReverseScroller(container)
    ? container.scrollTop + scrollRange(container)
    : container.scrollTop;
}

function applyScroll(target: ScrollTarget, top: number, behavior: ScrollBehavior): void {
  if (!target || target === window) {
    window.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  const container = target as HTMLElement;
  const range = scrollRange(container);
  const clamped = isReverseScroller(container)
    ? Math.min(0, Math.max(-range, top - range))
    : Math.max(0, top);
  if (container.scrollTo) container.scrollTo({ top: clamped, behavior });
  else container.scrollTop = clamped;
}

/** Put `center`, an offset in the target's own coordinates, on the anchor line. */
export function scrollToCenter(
  target: ScrollTarget,
  center: number,
  viewportHeight: number,
  behavior: ScrollBehavior = 'instant',
): void {
  applyScroll(target, center - viewportHeight * ACTIVE_ANCHOR, behavior);
}

/** Cancel a native smooth scroll at its current position before the user's input runs. */
export function interruptSmoothScroll(target: ScrollTarget): void {
  if (target) applyScroll(target, readScrollOffset(target), 'instant');
}

/**
 * The ordinary jump: the turn is mounted and near, so it glides. The instant
 * landings elsewhere are the ones a homing loop has to re-aim, where an
 * animation fights the correction.
 */
export function scrollElementToAnchor(
  target: HTMLElement | Window,
  element: HTMLElement,
  scrollTop: number,
  viewportHeight: number,
): void {
  const behavior = navigationScrollBehavior();
  const rect = element.getBoundingClientRect();
  if (target === window) {
    applyScroll(
      target,
      scrollTop + rect.top + rect.height / 2 - viewportHeight * ACTIVE_ANCHOR,
      behavior,
    );
    return;
  }
  const container = target as HTMLElement;
  const containerRect = container.getBoundingClientRect();
  const top =
    readScrollOffset(container) +
    rect.top -
    containerRect.top -
    container.clientHeight * ACTIVE_ANCHOR +
    rect.height / 2;
  applyScroll(container, top, behavior);
}

/**
 * A host that pins its thread to the newest turn pulls a scripted scroll back
 * until a wheel moves it (ChatGPT, measured live for #1071 and #1112). A
 * scripted wheel in the scroll's direction, `delta` pixels from where it is
 * now, releases the pin and scrolls nothing itself.
 */
export function releaseScrollPin(target: ScrollTarget, delta: number): void {
  if (!(target instanceof HTMLElement) || Math.abs(delta) < 1) return;
  target.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
}
