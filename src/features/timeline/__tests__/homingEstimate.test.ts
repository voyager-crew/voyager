import { describe, expect, it } from 'vitest';

import { type HomingBracket, type MountedTurn, estimateHoming } from '../homingEstimate';

const VIEW = 800;
const ANCHOR = 0.45;

/**
 * A loaded conversation whose turns vary wildly in height, as replies with
 * code or tables do: the window a jump mounts is every turn intersecting the
 * view, plus one of overscan on each side.
 */
function layout(heights: readonly number[]) {
  const centers: number[] = [];
  let y = 0;
  for (const height of heights) {
    centers.push(y + height / 2);
    y += height;
  }
  const window = (top: number, skip: number): MountedTurn[] => {
    const visible = heights
      .map((height, index) => ({
        index,
        start: centers[index] - height / 2,
        end: centers[index] + height / 2,
      }))
      .filter((turn) => turn.end >= top && turn.start <= top + VIEW)
      .map((turn) => turn.index);
    const from = Math.max(0, visible[0] - 1);
    const to = Math.min(heights.length - 1, visible[visible.length - 1] + 1);
    const turns: MountedTurn[] = [];
    for (let index = from; index <= to; index++)
      if (index !== skip) turns.push({ index, center: centers[index] });
    return turns;
  };
  return { centers, height: y, window };
}

/** Jumps until the target mounts; returns how many it took, or Infinity. */
function walk(heights: readonly number[], from: number, target: number) {
  const page = layout(heights);
  let top = Math.max(0, page.centers[from] - VIEW * ANCHOR);
  const bracket: HomingBracket = {};
  for (let jumps = 0; jumps < 20; jumps++) {
    const mounted = page.window(top, target);
    if (page.window(top, -1).some((turn) => turn.index === target)) return jumps;
    const plan = estimateHoming({
      targetIndex: target,
      mounted,
      offset: top,
      viewportHeight: VIEW,
      scrollHeight: page.height,
      anchor: ANCHOR,
      bracket,
    });
    if (plan.kind !== 'jump') return Infinity;
    top = Math.min(page.height - VIEW, Math.max(0, plan.center - VIEW * ANCHOR));
  }
  return Infinity;
}

// Short prompts with long replies between: the mounted window's pitch says little about the rest.
const HEIGHTS = [300, 4200, 260, 240, 5200, 300, 280, 3900, 260, 310, 6100, 240, 4800, 300, 260];

describe('estimated homing', () => {
  it('reaches a turn in a few jumps when replies vary wildly in height', () => {
    for (let from = 0; from < HEIGHTS.length; from++)
      for (let target = 0; target < HEIGHTS.length; target++) {
        if (from === target) continue;
        expect(walk(HEIGHTS, from, target), `${from} -> ${target}`).toBeLessThanOrEqual(6);
      }
  });

  it('reads a tall first turn at the start as the edge, never a jump down', () => {
    const plan = (offset: number) =>
      estimateHoming({
        targetIndex: 0,
        mounted: [{ index: 1, center: offset + 1100 }],
        offset,
        viewportHeight: VIEW,
        scrollHeight: 6000,
        anchor: ANCHOR,
      });
    expect(plan(0)).toEqual({ kind: 'edge' });
    const above = plan(140);
    expect(above.kind === 'jump' && above.center - VIEW * ANCHOR).toBeLessThan(140);
  });

  it('waits at the start of what is loaded instead of jumping again', () => {
    expect(
      estimateHoming({
        targetIndex: 0,
        mounted: [
          { index: 4, center: 200 },
          { index: 5, center: 700 },
        ],
        offset: 0,
        viewportHeight: VIEW,
        scrollHeight: 5000,
        anchor: ANCHOR,
      }),
    ).toEqual({ kind: 'edge' });
  });
});
