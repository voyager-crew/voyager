/**
 * Hover intent toward an open preview card ("safe triangle", or menu-aim).
 *
 * A card that previews one row usually sits off to one side of the list, so
 * the way to it runs across other rows. Taken literally, each of those rows
 * claims the card as the pointer passes over it. While the pointer stays in
 * the triangle from where it left its row to the card's near corners, and
 * keeps closing in fast enough, it is on its way to the card and those rows
 * should wait.
 *
 * The geometry is pure. `createSafeTriangle` adds only what tracking needs: a
 * document `pointermove` listener and a stall timer, both alive just while the
 * pointer is heading for the card. `createAimedRows` holds the rows' own hover
 * handlers back for that time; keyboard, touch and pen never start it.
 */

/** No progress toward the card for this long means the pointer has settled. */
export const SAFE_TRIANGLE_STALL_MS = 300;
/** How far outside the triangle still counts, for a hand that is not a ruler. */
export const SAFE_TRIANGLE_TOLERANCE_PX = 3;
/** Drift away from the card that is still a wobble rather than a turn. */
const BACKTRACK_PX = 4;
/**
 * Slower than this toward the card is browsing, not heading for it (Floating
 * UI's `requireIntent` uses the same 0.1 px/ms). The slash card sits above the
 * whole list, so every upward move points at it; without a speed floor a slow
 * scan up the rows kept the first row's card until the pointer stopped.
 */
export const SAFE_TRIANGLE_MIN_SPEED = 0.1;
/** Approach speed is measured over at least this long, so one jittery event cannot decide it. */
const SPEED_WINDOW_MS = 50;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Triangle = readonly [Point, Point, Point];

/**
 * The triangle from `apex` to the two corners of `card` that bound it as seen
 * from there: the near edge when the apex is level with the card (beside it on
 * either side, or above or below it), the diagonal when it is off a corner.
 * Null when the apex is already on the card.
 */
export function triangleToward(card: Box, apex: Point): Triangle | null {
  const col = apex.x < card.left ? -1 : apex.x > card.right ? 1 : 0;
  const row = apex.y < card.top ? -1 : apex.y > card.bottom ? 1 : 0;
  const tl = { x: card.left, y: card.top };
  const tr = { x: card.right, y: card.top };
  const bl = { x: card.left, y: card.bottom };
  const br = { x: card.right, y: card.bottom };
  if (col === 0 && row === 0) return null;
  if (row === 0) return col < 0 ? [apex, tl, bl] : [apex, tr, br];
  if (col === 0) return row < 0 ? [apex, tl, tr] : [apex, bl, br];
  // Off a corner: the two corners either side of the one nearest the apex.
  return col * row > 0 ? [apex, tr, bl] : [apex, tl, br];
}

export function isInsideTriangle(
  triangle: Triangle,
  point: Point,
  tolerance = SAFE_TRIANGLE_TOLERANCE_PX,
): boolean {
  const [a, b, c] = triangle;
  const side = (p: Point, q: Point) =>
    (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(hasNegative && hasPositive)) return true;
  return (
    Math.min(
      distanceToSegment(point, a, b),
      distanceToSegment(point, b, c),
      distanceToSegment(point, c, a),
    ) <= tolerance
  );
}

/** Zero on or inside `box`. */
export function distanceToBox(box: Box, point: Point): number {
  const dx = Math.max(box.left - point.x, 0, point.x - box.right);
  const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
  return Math.hypot(dx, dy);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * vx), point.y - (a.y + t * vy));
}

export interface SafeTriangle {
  /**
   * The pointer moved from `exit` (its last point on the row whose card is
   * open) to `point`. Starts tracking and returns true when that move heads
   * into the triangle and closer to the card.
   */
  start: (exit: Point, point: Point) => boolean;
  /** Whether the pointer is still heading for the card. */
  isActive: () => boolean;
  /** Stops tracking without calling `onExpire`: the card was reached or dismissed. */
  stop: () => void;
}

export interface SafeTriangleOptions {
  /** The card's current rect, or null once it is gone. */
  cardRect: () => Box | null;
  /** The pointer stopped heading for the card: left the triangle, turned back, slowed or settled. */
  onExpire: () => void;
}

export function createSafeTriangle({ cardRect, onExpire }: SafeTriangleOptions): SafeTriangle {
  let apex: Point | null = null;
  let best = 0;
  let checkpoint = { distance: 0, time: 0 };
  let stallTimer: number | null = null;

  function holds(point: Point): boolean {
    const card = cardRect();
    if (!apex || !card) return false;
    const triangle = triangleToward(card, apex);
    if (!triangle || !isInsideTriangle(triangle, point)) return false;
    const distance = distanceToBox(card, point);
    if (distance > best + BACKTRACK_PX) return false;
    const now = Date.now();
    const elapsed = now - checkpoint.time;
    if (elapsed >= SPEED_WINDOW_MS) {
      if ((checkpoint.distance - distance) / elapsed < SAFE_TRIANGLE_MIN_SPEED) return false;
      checkpoint = { distance, time: now };
    }
    if (distance < best) {
      best = distance;
      armStall();
    }
    return true;
  }

  function armStall(): void {
    if (stallTimer !== null) window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(expire, SAFE_TRIANGLE_STALL_MS);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!holds({ x: event.clientX, y: event.clientY })) expire();
  }

  function stop(): void {
    if (!apex) return;
    apex = null;
    if (stallTimer !== null) window.clearTimeout(stallTimer);
    stallTimer = null;
    document.removeEventListener('pointermove', onPointerMove, true);
  }

  function expire(): void {
    if (!apex) return;
    stop();
    onExpire();
  }

  return {
    start: (exit, point) => {
      const card = cardRect();
      if (!card) return false;
      apex = exit;
      best = distanceToBox(card, exit);
      checkpoint = { distance: best, time: Date.now() };
      // The first move must close in: beside a tall card, a move straight down
      // stays within the tolerance of the triangle's near-vertical edge.
      if (distanceToBox(card, point) >= best || !holds(point)) {
        stop();
        return false;
      }
      armStall();
      document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
      return true;
    },
    isActive: () => apex !== null,
    stop,
  };
}

export interface AimedRows {
  /**
   * Wires a row's hover. `enter` and `leave` are what the row does on
   * mouseenter and mouseleave; while the pointer is heading for the card they
   * wait, and when it stops heading there the row under it gets its `enter`
   * (or, over no row, the last row left gets its `leave`).
   */
  bind: (row: HTMLElement, enter: () => void, leave: () => void) => void;
  /** The card was reached or dismissed, or the keyboard took over: drop any waiting hover. */
  stop: () => void;
}

export interface AimedRowsOptions {
  /** The card while it is showing, or null: a hidden card is never aimed at. */
  card: () => HTMLElement | null;
  /** The row whose preview the card last showed. */
  owner: () => HTMLElement | null;
  /** The pointer left `owner` for the card: hold whatever leaving would close. */
  onAim: () => void;
  /** The pointer is no longer heading for the card, however that ended. */
  onAimEnd?: () => void;
}

/** Row hover that waits while a mouse is on its way to the open card. */
export function createAimedRows({ card, owner, onAim, onAimEnd }: AimedRowsOptions): AimedRows {
  let lastInside: { row: HTMLElement; point: Point } | null = null;
  let pending: { row: HTMLElement; enter: () => void } | null = null;
  let resumeLeave: (() => void) | null = null;

  const triangle = createSafeTriangle({
    cardRect: () => card()?.getBoundingClientRect() ?? null,
    onExpire: () => {
      const next = pending;
      pending = null;
      onAimEnd?.();
      if (next?.row.isConnected) next.enter();
      else resumeLeave?.();
    },
  });

  function stop(): void {
    pending = null;
    triangle.stop();
    onAimEnd?.();
  }

  return {
    bind: (row, enter, leave) => {
      row.addEventListener(
        'pointermove',
        (event) => {
          lastInside = { row, point: { x: event.clientX, y: event.clientY } };
        },
        { passive: true },
      );
      row.addEventListener('pointerleave', (event) => {
        // Touch and pen have no path to aim along; their taps work as before.
        if (event.pointerType !== 'mouse' || owner() !== row) return;
        // Leaving the owner again ends any earlier aim and the row it was
        // holding; a hover kept from then would later reopen a row the
        // pointer has long left.
        stop();
        const point = { x: event.clientX, y: event.clientY };
        // The last move inside the row, so a move straight away from the card is
        // judged at once; a stale point from another row would aim from there.
        const exit = lastInside?.row === row ? lastInside.point : point;
        if (!triangle.start(exit, point)) return;
        resumeLeave = leave;
        onAim();
      });
      row.addEventListener('mouseenter', () => {
        if (triangle.isActive()) pending = { row, enter };
        else enter();
      });
      row.addEventListener('mouseleave', () => {
        // Whether or not an aim is running: a row the pointer has left is
        // never the one under it.
        if (pending?.row === row) pending = null;
        if (!triangle.isActive()) {
          leave();
          return;
        }
        resumeLeave = leave;
      });
    },
    stop,
  };
}
