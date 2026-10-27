import { describe, expect, it } from 'vitest';

import { distanceToBox, isInsideTriangle, triangleToward } from '../safeTriangle';

const card = { left: 100, top: 100, right: 300, bottom: 200 };

describe('safe triangle geometry', () => {
  it('reaches the whole bottom edge of a card above the pointer, and nothing beside it', () => {
    const triangle = triangleToward(card, { x: 150, y: 400 })!;
    expect(isInsideTriangle(triangle, { x: 105, y: 205 })).toBe(true);
    expect(isInsideTriangle(triangle, { x: 295, y: 205 })).toBe(true);
    expect(isInsideTriangle(triangle, { x: 300, y: 400 })).toBe(false);
    expect(isInsideTriangle(triangle, { x: 60, y: 250 })).toBe(false);
  });

  it('reaches the near side of a card beside the pointer, on either side', () => {
    const right = triangleToward(card, { x: 20, y: 150 })!;
    expect(isInsideTriangle(right, { x: 95, y: 105 })).toBe(true);
    expect(isInsideTriangle(right, { x: 95, y: 195 })).toBe(true);
    expect(isInsideTriangle(right, { x: 95, y: 250 })).toBe(false);
    // RTL, or no room on the right: the card sits on the pointer's left.
    const left = triangleToward(card, { x: 380, y: 150 })!;
    expect(isInsideTriangle(left, { x: 305, y: 105 })).toBe(true);
    expect(isInsideTriangle(left, { x: 305, y: 195 })).toBe(true);
    expect(isInsideTriangle(left, { x: 305, y: 250 })).toBe(false);
  });

  it('spans the diagonal of a card off a corner, so both visible edges are in reach', () => {
    // Below and to the right, as when a list is wider than the card above it.
    const triangle = triangleToward(card, { x: 400, y: 300 })!;
    expect(isInsideTriangle(triangle, { x: 120, y: 205 })).toBe(true);
    expect(isInsideTriangle(triangle, { x: 305, y: 110 })).toBe(true);
    expect(isInsideTriangle(triangle, { x: 400, y: 150 })).toBe(false);
    expect(isInsideTriangle(triangle, { x: 200, y: 290 })).toBe(false);
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
