/**
 * Step planning for homing on a host that reserves no height for unmounted
 * turns (ChatGPT, #1112). Its scroll height grows as older turns mount, so a
 * remembered offset or a bisected one points nowhere; and a jump far from the
 * mounted window is snapped back. Each hop therefore scrolls a bounded step
 * toward the target's place in the marker list, judged from which markers are
 * mounted, and the host mounts what the step reaches.
 */

/** Steps per viewport when the target is a few turns away, and when it is near. */
export const FAR_STEP_VIEWPORTS = 2;
export const NEAR_STEP_VIEWPORTS = 0.8;
/** Turns away from the mounted window beyond which the far step applies. */
const NEAR_TURNS = 2;
/** A reversal halves the step, down to this share, so an overshoot converges. */
const MIN_STEP_SCALE = 0.25;

export type StepDirection = -1 | 1;

export interface HomingStepInput {
  readonly targetIndex: number;
  /** Indexes of the markers mounted now, ascending; never empty. */
  readonly mountedIndexes: readonly number[];
  readonly viewportHeight: number;
  /** The previous hop's direction, or 0 before the first. */
  readonly previousDirection: StepDirection | 0;
  readonly scale: number;
  /**
   * For a target inside the mounted range (a gap the host left), the signed
   * distance from the anchor line to the gap; the caller measures it.
   */
  readonly gapOffset?: number;
}

export interface HomingStep {
  readonly direction: StepDirection;
  /** Pixels to scroll, always positive. */
  readonly distance: number;
  readonly scale: number;
}

export function planHomingStep(input: HomingStepInput): HomingStep {
  const first = input.mountedIndexes[0];
  const last = input.mountedIndexes[input.mountedIndexes.length - 1];
  let direction: StepDirection;
  let turnsAway: number;
  if (input.targetIndex < first) {
    direction = -1;
    turnsAway = first - input.targetIndex;
  } else if (input.targetIndex > last) {
    direction = 1;
    turnsAway = input.targetIndex - last;
  } else {
    direction = (input.gapOffset ?? 1) < 0 ? -1 : 1;
    turnsAway = 1;
  }
  const scale =
    input.previousDirection !== 0 && input.previousDirection !== direction
      ? Math.max(MIN_STEP_SCALE, input.scale / 2)
      : input.scale;
  const viewports = turnsAway > NEAR_TURNS ? FAR_STEP_VIEWPORTS : NEAR_STEP_VIEWPORTS;
  let distance = Math.max(1, input.viewportHeight * viewports * scale);
  if (input.gapOffset !== undefined && input.targetIndex >= first && input.targetIndex <= last)
    distance = Math.max(1, Math.min(distance, Math.abs(input.gapOffset)));
  return { direction, distance, scale };
}
