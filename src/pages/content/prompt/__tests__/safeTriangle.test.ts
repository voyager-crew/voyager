import { describe, expect, it } from 'vitest';

import { distanceToBox, isInsideTriangle, triangleToward } from '../safeTriangle';

const card = { left: 100, top: 100, right: 300, bottom: 200 };

describe('safe triangle geometry', () => {
  it('aims at the bottom edge of a card above the pointer', () => {
    expect(triangleToward(card, { x: 150, y: 400 })).toEqual([
      { x: 150, y: 400 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('aims at the near side edge of a card beside the pointer, on either side', () => {
    expect(triangleToward(card, { x: 20, y: 150 })?.slice(1)).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
    ]);
    // RTL, or no room on the right: the card sits on the pointer's left.
    expect(triangleToward(card, { x: 380, y: 150 })?.slice(1)).toEqual([
      { x: 300, y: 100 },
      { x: 300, y: 200 },
    ]);
  });

  it('spans the diagonal of a card off a corner, so both visible edges are in reach', () => {
    // Below and to the right, as when a list is wider than the card above it.
    const triangle = triangleToward(card, { x: 400, y: 300 })!;
    expect(triangle.slice(1)).toEqual([
      { x: 300, y: 100 },
      { x: 100, y: 200 },
    ]);
    expect(isInsideTriangle(triangle, { x: 250, y: 210 })).toBe(true);
    expect(isInsideTriangle(triangle, { x: 310, y: 150 })).toBe(true);
  });

  it('has no triangle once the pointer is on the card', () => {
    expect(triangleToward(card, { x: 200, y: 150 })).toBeNull();
  });

  it('counts a point just outside an edge as inside, and no further', () => {
    const triangle = triangleToward(card, { x: 200, y: 400 })!;
    expect(isInsideTriangle(triangle, { x: 200, y: 300 })).toBe(true);
    // The left edge runs from (200, 400) to (100, 200); one pixel outside it.
    expect(isInsideTriangle(triangle, { x: 149, y: 300 }, 3)).toBe(true);
    expect(isInsideTriangle(triangle, { x: 140, y: 300 }, 3)).toBe(false);
    // Straight back down, away from the card.
    expect(isInsideTriangle(triangle, { x: 200, y: 420 }, 3)).toBe(false);
  });

  it('measures distance to the nearest point of the card', () => {
    expect(distanceToBox(card, { x: 200, y: 150 })).toBe(0);
    expect(distanceToBox(card, { x: 200, y: 260 })).toBe(60);
    expect(distanceToBox(card, { x: 340, y: 230 })).toBe(50);
  });
});
