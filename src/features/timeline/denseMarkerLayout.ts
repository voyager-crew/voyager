const DENSE_MAX_GAP_PX = 8;
const DENSE_MAX_SPAN_PX = 160;

/**
 * Vertical offsets (px from the rail's middle) for markers stacked by the dense
 * compact and ruler styles: an even gap that shrinks so long lists fit the span.
 * A short list stays a 160 px cluster; a long one spreads over the rail's
 * `availablePx` before its gap shrinks, so 100 turns do not merge into one bar
 * (#1120).
 */
export function denseMarkerOffsets(count: number, availablePx = 0): number[] {
  const span = Math.max(DENSE_MAX_SPAN_PX, availablePx);
  const gap = count > 1 ? Math.min(DENSE_MAX_GAP_PX, span / (count - 1)) : 0;
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, rank) => (rank - center) * gap);
}

const RULER_WAVE_SIGMA = 1.2;
const RULER_RESTING_SCALE = 0.29;
const RULER_QUIET_OPACITY = 0.42;
const RULER_CREST_OPACITY_GAIN = 0.5;

/**
 * The ruler's Gaussian crest: ticks `distance` markers from the reading position
 * grow from a resting scale and quiet opacity toward full size.
 */
export function rulerWaveTick(distance: number): { scale: number; opacity: number } {
  const crest = Math.exp(-(distance * distance) / (2 * RULER_WAVE_SIGMA * RULER_WAVE_SIGMA));
  return {
    scale: RULER_RESTING_SCALE + (1 - RULER_RESTING_SCALE) * crest,
    opacity: RULER_QUIET_OPACITY + RULER_CREST_OPACITY_GAIN * crest,
  };
}
