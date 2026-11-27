/**
 * Where to jump for an unmounted turn on a host that loads its history in
 * pages (ChatGPT, #1112, #1116). Fetched turns it has not mounted keep an
 * estimated height, so a far jump inside what is loaded lands and mounts at
 * once; turns older than the loaded pages reserve nothing, and the host fetches
 * the next page only once the view reaches the top.
 *
 * The estimate places the target by its ordinal: interpolated between the
 * nearest turns seen on either side of it, or extrapolated with the mounted
 * window's own pitch. The host swaps estimated heights for measured ones as
 * turns mount, which moves offsets by thousands of pixels. A narrow bracket
 * needs measurements from the same layout, while a wide bracket can still
 * give a useful coarse jump after a small reflow. An extrapolation that
 * reverses direction is halved to avoid swinging between distant windows.
 */

export interface MountedTurn {
  readonly index: number;
  /** Centre in the scroller's own coordinates. */
  readonly center: number;
}

interface SeenTurn extends MountedTurn {
  /** The scroll height the centre was read under. */
  readonly height: number;
}

/** What one walk remembers between estimates; start each walk with `{}`. */
export interface HomingBracket {
  below?: SeenTurn;
  above?: SeenTurn;
  direction?: -1 | 1;
  scale?: number;
  lastProbe?: { readonly offset: number; readonly height: number };
}

export interface HomingEstimateInput {
  readonly targetIndex: number;
  /** Mounted turns other than the target, ascending by index. */
  readonly mounted: readonly MountedTurn[];
  /** Offset from the conversation's start. */
  readonly offset: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
  /** Where the active turn sits, as a share of the view from its top. */
  readonly anchor: number;
  /** Updated from `mounted`; pass the same object for every estimate of one walk. */
  readonly bracket?: HomingBracket;
}

export type HomingEstimate =
  /** Put this centre on the anchor line. */
  | { readonly kind: 'jump'; readonly center: number; readonly bracketed: boolean }
  /** The target lies past what is loaded and the view already sits at that edge. */
  | { readonly kind: 'edge' }
  /** Nothing mounted to estimate from yet. */
  | { readonly kind: 'wait' };

/** A pitch below this is a mounted window too short to measure. */
const MIN_PITCH = 40;
/** Pitch, in viewports, when only one turn is mounted. */
const LONE_TURN_PITCH = 0.75;
const EDGE_SLOP = 1;
/** Least a jump moves toward a target past every mounted turn, in viewports. */
const MIN_PROBE_VIEWPORTS = 0.75;
/** A remembered side stays usable while the scroll height moved less than this, in viewports. */
const FRAME_TOLERANCE_VIEWPORTS = 0.5;
const MAX_WIDE_FRAME_TOLERANCE_VIEWPORTS = 4;
const WIDE_FRAME_TOLERANCE_SHARE = 0.05;
const MIN_SCALE = 1 / 8;
const REPEATED_PROBE_SLOP = 2;

/** Record the window's nearest turn on each side of the target, closer ones first. */
function updateBracket(
  bracket: HomingBracket,
  mounted: readonly MountedTurn[],
  target: number,
  height: number,
): void {
  const below = [...mounted].reverse().find((turn) => turn.index < target);
  const above = mounted.find((turn) => turn.index > target);
  if (below) bracket.below = { ...below, height };
  if (above) bracket.above = { ...above, height };
  // Sides that no longer bracket anything: the one not seen now is stale.
  if (bracket.below && bracket.above && bracket.below.center >= bracket.above.center) {
    if (above) bracket.below = below && { ...below, height };
    else bracket.above = undefined;
  }
}

function usable(side: SeenTurn | undefined, height: number, tolerance: number): side is SeenTurn {
  return !!side && Math.abs(side.height - height) <= tolerance;
}

export function estimateHoming(input: HomingEstimateInput): HomingEstimate {
  const { mounted, targetIndex, viewportHeight: view, scrollHeight: height } = input;
  if (!mounted.length) return { kind: 'wait' };
  const bracket = input.bracket ?? {};
  updateBracket(bracket, mounted, targetIndex, height);
  const first = mounted[0];
  const last = mounted[mounted.length - 1];
  const direction = targetIndex < first.index ? -1 : targetIndex > last.index ? 1 : 0;
  const anchorOffset = view * input.anchor;
  let center: number;
  const { below, above } = bracket;
  const bracketWidth = below && above ? above.center - below.center : 0;
  const frameTolerance = Math.max(
    view * FRAME_TOLERANCE_VIEWPORTS,
    Math.min(view * MAX_WIDE_FRAME_TOLERANCE_VIEWPORTS, bracketWidth * WIDE_FRAME_TOLERANCE_SHARE),
  );
  const bracketed =
    usable(below, height, frameTolerance) &&
    usable(above, height, frameTolerance) &&
    bracketWidth > 0;
  if (bracketed) {
    const share = (targetIndex - below.index) / Math.max(1, above.index - below.index);
    center = below.center + (above.center - below.center) * share;
  } else {
    const span = last.index - first.index;
    const pitch = Math.max(
      MIN_PITCH,
      span > 0 ? (last.center - first.center) / span : view * LONE_TURN_PITCH,
    );
    const edge = direction < 0 ? first : last;
    let scale = bracket.scale ?? 1;
    if (direction !== 0 && bracket.direction !== undefined && bracket.direction !== direction)
      scale = Math.max(MIN_SCALE, scale / 2);
    center = edge.center + (targetIndex - edge.index) * pitch * scale;
    bracket.scale = scale;
  }
  if (direction !== 0) bracket.direction = direction;
  // Every turn the host mounts lies on one side of an unmounted target, so the
  // target is beyond the view in that direction. An estimate short of a probe
  // (a long reply spanning the view, #1116) would land on the same window
  // again; move at least a probe, which cannot pass a turn beyond the view.
  const probe = view * MIN_PROBE_VIEWPORTS;
  const line = input.offset + anchorOffset;
  if (direction > 0) center = Math.max(center, line + probe);
  else if (direction < 0) center = Math.min(center, line - probe);
  else if (Math.abs(center - line) < probe) {
    // ChatGPT can keep its newest turn mounted far outside the viewport. If
    // interpolating with that turn lands on the same window, probe past the
    // turn nearest the view in the direction of the missing target.
    const nearest = mounted.reduce((best, turn) =>
      Math.abs(turn.center - line) < Math.abs(best.center - line) ? turn : best,
    );
    center = line + Math.sign(targetIndex - nearest.index) * probe;
  }
  const top = center - anchorOffset;
  const maxTop = Math.max(0, height - view);
  if (direction < 0 && top <= 0 && input.offset <= EDGE_SLOP) return { kind: 'edge' };
  if (direction > 0 && top >= maxTop && input.offset >= maxTop - EDGE_SLOP) return { kind: 'edge' };
  const previous = bracket.lastProbe;
  bracket.lastProbe = { offset: input.offset, height };
  if (previous?.height === height) {
    const travel = input.offset - previous.offset;
    const distance = Math.abs(travel);
    const repeats = Math.abs(top - previous.offset) < REPEATED_PROBE_SLOP;
    const crosses = bracketed && (top - previous.offset) * travel < 0;
    // Both windows already missed the target. Probe inside the gap instead of repeating them.
    if ((repeats || crosses) && distance > REPEATED_PROBE_SLOP && distance <= view * 2)
      center = (input.offset + previous.offset) / 2 + anchorOffset;
  }
  return { kind: 'jump', center, bracketed };
}
