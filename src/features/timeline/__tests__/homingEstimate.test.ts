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

/**
 * Jumps until the target mounts; returns how many it took, or Infinity. With
 * `estimate`, unmounted turns stand at that height until they first mount, as
 * ChatGPT's virtual list does, so each landing re-lays out the page.
 */
function walk(heights: readonly number[], from: number, target: number, estimate?: number) {
  const measured = new Set<number>();
  const page = () =>
    layout(heights.map((real, index) => (estimate && !measured.has(index) ? estimate : real)));
  // The host clamps the offset to whatever height the page has now.
  const clamp = (top: number) => Math.max(0, Math.min(top, page().height - VIEW));
  const land = (top: number) => {
    for (const turn of page().window(clamp(top), -1)) measured.add(turn.index);
    return page();
  };
  let top = Math.max(0, page().centers[from] - VIEW * ANCHOR);
  const bracket: HomingBracket = {};
  for (let jumps = 0; jumps < 20; jumps++) {
    const current = land(top);
    top = clamp(top);
    if (current.window(top, -1).some((turn) => turn.index === target)) return jumps;
    const plan = estimateHoming({
      targetIndex: target,
      mounted: current.window(top, target),
      offset: top,
      viewportHeight: VIEW,
      scrollHeight: current.height,
      anchor: ANCHOR,
      bracket,
    });
    if (plan.kind !== 'jump') return Infinity;
    top = Math.min(current.height - VIEW, Math.max(0, plan.center - VIEW * ANCHOR));
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

  it('converges while mounting swaps estimated heights for measured ones', () => {
    for (let from = 0; from < HEIGHTS.length; from++)
      for (let target = 0; target < HEIGHTS.length; target++) {
        if (from === target) continue;
        expect(walk(HEIGHTS, from, target, 900), `${from} -> ${target}`).toBeLessThanOrEqual(8);
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

  it('moves past a long reply when the pinned newest turn estimates the current position', () => {
    const offset = 60_000;
    const line = offset + VIEW * ANCHOR;
    const plan = estimateHoming({
      targetIndex: 20,
      mounted: [
        { index: 19, center: line - 2_000 },
        { index: 54, center: line + 68_000 },
      ],
      offset,
      viewportHeight: VIEW,
      scrollHeight: 140_000,
      anchor: ANCHOR,
    });
    expect(plan.kind === 'jump' && plan.center - line).toBeGreaterThan(VIEW / 2);
  });

  it('keeps a long jump bracket usable after mounting changes the scroll height', () => {
    const bracket: HomingBracket = {};
    const input = { targetIndex: 7, viewportHeight: VIEW, anchor: ANCHOR, bracket };
    estimateHoming({
      ...input,
      mounted: [{ index: 26, center: 83_000 }],
      offset: 82_000,
      scrollHeight: 141_000,
    });
    const plan = estimateHoming({
      ...input,
      mounted: [{ index: 0, center: 1200 }],
      offset: 2400,
      scrollHeight: 143_400,
    });
    expect(plan.kind === 'jump' && plan.center).toBeGreaterThan(20_000);
    expect(plan.kind === 'jump' && plan.center).toBeLessThan(30_000);
  });

  it('probes between two landing windows instead of jumping back and forth', () => {
    const bracket: HomingBracket = {};
    const input = {
      targetIndex: 52,
      viewportHeight: VIEW,
      anchor: ANCHOR,
      bracket,
      scrollHeight: 10_000,
    };
    const from = 3150;
    const first = estimateHoming({
      ...input,
      mounted: [{ index: 51, center: 2400 }],
      offset: from,
    });
    expect(first.kind).toBe('jump');
    if (first.kind !== 'jump') throw new Error('Expected a jump to the other side');
    const to = first.center - VIEW * ANCHOR;
    const next = estimateHoming({ ...input, mounted: [{ index: 53, center: 4300 }], offset: to });
    expect(next.kind === 'jump' && next.center - VIEW * ANCHOR).toBeGreaterThan(from);
    expect(next.kind === 'jump' && next.center - VIEW * ANCHOR).toBeLessThan(to);
  });
});
