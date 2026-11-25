/**
 * Where to jump for an unmounted turn on a host that loads its history in
 * pages (ChatGPT, #1112, #1116). Fetched turns it has not mounted keep an
 * estimated height, so a far jump inside what is loaded lands and mounts at
 * once; turns older than the loaded pages reserve nothing, and the host fetches
 * the next page only once the view reaches the top.
 *
 * The estimate places the target by its ordinal: interpolated between the
 * nearest turns seen on either side of it (the bracket), or extrapolated with
 * the mounted window's own pitch until both sides have been seen. The host's
 * estimated heights differ from measured ones, so extrapolation alone can
 * overshoot back and forth; the bracket only narrows, so the walk converges.
 */

export interface MountedTurn {
  readonly index: number;
  /** Centre in the scroller's own coordinates. */
  readonly center: number;
}

/** The nearest turns seen before and after the target during one walk. */
export interface HomingBracket {
  below?: MountedTurn;
  above?: MountedTurn;
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
  | { readonly kind: 'jump'; readonly center: number }
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

/**
 * Record the window's nearest turns on each side of the target. A side seen
 * now replaces the old one; the other side is dropped if the host's layout
 * moved so far that the two no longer bracket anything.
 */
function updateBracket(bracket: HomingBracket, mounted: readonly MountedTurn[], target: number) {
  const below = [...mounted].reverse().find((turn) => turn.index < target);
  const above = mounted.find((turn) => turn.index > target);
  if (below && (!bracket.below || below.index >= bracket.below.index || !above))
    bracket.below = below;
  if (above && (!bracket.above || above.index <= bracket.above.index || !below))
    bracket.above = above;
  if (bracket.below && bracket.above && bracket.below.center >= bracket.above.center) {
    if (above) bracket.below = below;
    else bracket.above = undefined;
  }
}

function between(before: MountedTurn, after: MountedTurn, target: number): number {
  const share = (target - before.index) / Math.max(1, after.index - before.index);
  return before.center + (after.center - before.center) * share;
}

export function estimateHoming(input: HomingEstimateInput): HomingEstimate {
  const { mounted, targetIndex } = input;
  if (!mounted.length) return { kind: 'wait' };
  const bracket = input.bracket ?? {};
  updateBracket(bracket, mounted, targetIndex);
  const first = mounted[0];
  const last = mounted[mounted.length - 1];
  const span = last.index - first.index;
  const pitch = Math.max(
    MIN_PITCH,
    span > 0 ? (last.center - first.center) / span : input.viewportHeight * LONE_TURN_PITCH,
  );
  let center: number;
  if (bracket.below && bracket.above) center = between(bracket.below, bracket.above, targetIndex);
  else if (targetIndex < first.index) center = first.center - (first.index - targetIndex) * pitch;
  else center = last.center + (targetIndex - last.index) * pitch;
  const anchorOffset = input.viewportHeight * input.anchor;
  // Every turn the host mounts lies on one side of an unmounted target, so the
  // target is beyond the view in that direction. An estimate short of a probe
  // (a long reply spanning the view, #1116) would land on the same window
  // again; move at least a probe, which cannot pass a turn beyond the view.
  const probe = input.viewportHeight * MIN_PROBE_VIEWPORTS;
  if (targetIndex > last.index) center = Math.max(center, input.offset + probe + anchorOffset);
  else if (targetIndex < first.index)
    center = Math.min(center, input.offset - probe + anchorOffset);
  const top = center - anchorOffset;
  const maxTop = Math.max(0, input.scrollHeight - input.viewportHeight);
  if (targetIndex < first.index && top <= 0 && input.offset <= EDGE_SLOP) return { kind: 'edge' };
  if (targetIndex > last.index && top >= maxTop && input.offset >= maxTop - EDGE_SLOP)
    return { kind: 'edge' };
  return { kind: 'jump', center };
}
