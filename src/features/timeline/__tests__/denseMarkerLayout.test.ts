import { describe, expect, it } from 'vitest';

import { denseMarkerOffsets } from '../denseMarkerLayout';

const gapOf = (offsets: number[]): number => offsets[1] - offsets[0];

describe('denseMarkerOffsets', () => {
  it('keeps a short conversation in the centred cluster', () => {
    const offsets = denseMarkerOffsets(10, 640);
    expect(gapOf(offsets)).toBe(8);
    expect(offsets[0]).toBe(-36);
  });

  it('spreads a long conversation over the rail instead of one merged bar (#1120)', () => {
    const offsets = denseMarkerOffsets(106, 640);
    expect(gapOf(offsets)).toBeGreaterThan(6);
    expect(offsets[105] - offsets[0]).toBeLessThanOrEqual(640);
  });

  it('falls back to the 160 px span when the rail height is unknown', () => {
    const offsets = denseMarkerOffsets(106);
    expect(offsets[105] - offsets[0]).toBeCloseTo(160);
  });
});
