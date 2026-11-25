/**
 * One stepped homing run's progress and its per-hop decision (#1112): whether
 * to stop, wait a hop, or scroll one bounded step (`steppedHoming`) toward the
 * target. `VirtualizedTimelineNavigation` owns the timers, scrolling and
 * cancellation; this file holds what a hop reads and decides.
 */
import type { TimelineNavigationMarker } from './TimelineNavigation';
import { type StepDirection, planHomingStep } from './steppedHoming';

/** Hops without movement or new mounts before stepping gives up (an edge the turn is not behind). */
const STEPPED_STUCK_HOPS = 5;
/** Hops to wait for a mounted window that has caught up with the last step. */
const STEPPED_WINDOW_WAITS = 2;
/**
 * At the scroll edge in the travel direction, how long to wait without new
 * height or mounts: ChatGPT takes a second or two to load older turns there.
 */
const STEPPED_EDGE_PATIENCE_MS = 4000;
/** Re-aims at a target layout moved off the anchor after an align. */
const STEPPED_MAX_ALIGNS = 3;
/** Share of the view a settled target may sit from the anchor line. */
const STEPPED_ALIGN_TOLERANCE = 0.25;

export interface StepProgress {
  direction: StepDirection | 0;
  scale: number;
  stuck: number;
  waits: number;
  lastOffset: number | null;
  lastMounted: string;
  lastHeight: number;
  edgeSince: number | null;
  aligns: number;
}

export function newStepProgress(): StepProgress {
  return {
    direction: 0,
    scale: 1,
    stuck: 0,
    waits: 0,
    lastOffset: null,
    lastMounted: '',
    lastHeight: 0,
    edgeSince: null,
    aligns: 0,
  };
}

/** The scroller as one hop reads it. */
export interface SteppedHopView {
  /** Offset from the conversation's start. */
  readonly offset: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
  /** Where the active turn sits, as a share of the view from its top. */
  readonly anchor: number;
  readonly now: number;
  liveElement(marker: TimelineNavigationMarker): HTMLElement | null;
  inViewport(element: HTMLElement): boolean;
  centerOf(element: HTMLElement): number;
}

export type SteppedHop =
  | { readonly kind: 'stop' }
  | { readonly kind: 'wait' }
  /** Put this centre, in the scroller's own coordinates, on the anchor line. */
  | { readonly kind: 'scroll'; readonly center: number };

/**
 * The next hop toward an unmounted `marker`. Ends when steps stop moving the
 * scroller or mounting anything, except at the edge in the travel direction,
 * where it waits for the host to load more until a long silence.
 */
export function nextSteppedHop(
  progress: StepProgress,
  markers: readonly TimelineNavigationMarker[],
  marker: TimelineNavigationMarker,
  view: SteppedHopView,
): SteppedHop {
  const live = markers.map((item) => (item === marker ? null : view.liveElement(item)));
  const mountedIndexes = live.reduce<number[]>((acc, element, index) => {
    if (element) acc.push(index);
    return acc;
  }, []);
  const { offset, viewportHeight } = view;
  const signature = mountedIndexes.join(',');
  const height = view.scrollHeight;
  if (progress.lastOffset !== null) {
    const changed =
      Math.abs(offset - progress.lastOffset) >= 1 ||
      signature !== progress.lastMounted ||
      height !== progress.lastHeight;
    const atEdge =
      (progress.direction === -1 && offset <= 1) ||
      (progress.direction === 1 && offset >= height - viewportHeight - 1);
    if (changed) {
      progress.stuck = 0;
      progress.edgeSince = null;
    } else if (atEdge) {
      // The host loads more at its edge in its own time; only a long silence ends the wait.
      progress.edgeSince ??= view.now;
      if (view.now - progress.edgeSince > STEPPED_EDGE_PATIENCE_MS) return { kind: 'stop' };
    } else if (++progress.stuck >= STEPPED_STUCK_HOPS) {
      return { kind: 'stop' };
    }
  }
  progress.lastMounted = signature;
  progress.lastHeight = height;
  if (!mountedIndexes.length) {
    progress.lastOffset = offset;
    return { kind: 'wait' };
  }
  // A window that has not caught up with the last step still shows where it was.
  const windowCurrent = mountedIndexes.some((index) => view.inViewport(live[index]!));
  if (!windowCurrent && progress.waits < STEPPED_WINDOW_WAITS) {
    progress.waits += 1;
    progress.lastOffset = offset;
    return { kind: 'wait' };
  }
  progress.waits = 0;
  const targetIndex = markers.indexOf(marker);
  const anchorLine = offset + viewportHeight * view.anchor;
  let gapOffset: number | undefined;
  if (targetIndex > mountedIndexes[0] && targetIndex < mountedIndexes[mountedIndexes.length - 1]) {
    const before = [...mountedIndexes].reverse().find((index) => index < targetIndex)!;
    const after = mountedIndexes.find((index) => index > targetIndex)!;
    const gap = (view.centerOf(live[before]!) + view.centerOf(live[after]!)) / 2;
    gapOffset = gap - anchorLine;
  }
  const plan = planHomingStep({
    targetIndex,
    mountedIndexes,
    viewportHeight,
    previousDirection: progress.direction,
    scale: progress.scale,
    gapOffset,
  });
  progress.direction = plan.direction;
  progress.scale = plan.scale;
  progress.lastOffset = offset;
  return { kind: 'scroll', center: anchorLine + plan.direction * plan.distance };
}

/**
 * Whether an aligned target can stay where layout settled it: near the anchor,
 * held short of it by a scroll edge while in view, or out of re-aims.
 */
export function alignmentSettled(input: {
  readonly offFromAnchor: number;
  readonly viewportHeight: number;
  readonly scrollerMoved: boolean;
  readonly inViewport: boolean;
  readonly aligns: number;
}): boolean {
  return (
    input.offFromAnchor <= input.viewportHeight * STEPPED_ALIGN_TOLERANCE ||
    (!input.scrollerMoved && input.inViewport) ||
    input.aligns >= STEPPED_MAX_ALIGNS
  );
}
