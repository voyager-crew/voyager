import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type WatermarkConfig,
  calculateWatermarkPosition,
  removeWatermarkFromAnchorOptions,
} from '../watermarkPixels';

beforeAll(() => {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());

const SIZE = 48;
const LOGO = 24;
const CONFIG: WatermarkConfig = {
  logoSize: LOGO,
  marginRight: 6,
  marginBottom: 6,
  alphaVariant: '20260520',
};

/** A four-pointed star with sharp edges, like Gemini's V2 mark. */
const STAR = Float32Array.from({ length: LOGO * LOGO }, (_, index) => {
  const dx = Math.abs((index % LOGO) - (LOGO - 1) / 2);
  const dy = Math.abs(Math.floor(index / LOGO) - (LOGO - 1) / 2);
  return Math.max(0, Math.min(0.5, (Math.sqrt(LOGO / 2) - Math.sqrt(dx) - Math.sqrt(dy)) * 0.5));
});

/** A pale wall with a soft dark object right under the star (a table leg, a frame corner). */
function createImage(shadowDepth: number, shadowSpread: number, watermarked: boolean): ImageData {
  const position = calculateWatermarkPosition(SIZE, SIZE, CONFIG);
  const centre = position.x + LOGO / 2;
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = (x - centre) ** 2 + (y - centre) ** 2;
      let value = 200 - shadowDepth * Math.exp(-distance / (2 * shadowSpread ** 2));
      const row = y - position.y;
      const col = x - position.x;
      if (watermarked && row >= 0 && col >= 0 && row < LOGO && col < LOGO) {
        const alpha = STAR[row * LOGO + col];
        value = 255 * alpha + value * (1 - alpha);
      }
      const index = (y * SIZE + x) * 4;
      data.fill(Math.round(value), index, index + 3);
      data[index + 3] = 255;
    }
  }
  return new ImageData(data, SIZE, SIZE);
}

function maxDifference(a: ImageData, b: ImageData): number {
  let max = 0;
  for (let index = 0; index < a.data.length; index++) {
    max = Math.max(max, Math.abs(a.data[index] - b.data[index]));
  }
  return max;
}

const anchors = [{ config: CONFIG, alphaMap: STAR }];

// Discussion #898: a dark background under the star skews the luminance match.
describe('watermark removal over a textured background', () => {
  it.each([
    ['the luminance match misses the star', 120, 8],
    ['the luminance match turns negative once the star is gone', 120, 9],
  ])('removes the star when %s', (_case, depth, spread) => {
    const image = createImage(depth, spread, true);

    expect(removeWatermarkFromAnchorOptions(image, anchors)).not.toBe('none');
    expect(maxDifference(image, createImage(depth, spread, false))).toBeLessThanOrEqual(1);
  });

  it('leaves the same background untouched when it has no watermark', () => {
    for (const [depth, spread] of [
      [120, 8],
      [120, 9],
    ]) {
      const image = createImage(depth, spread, false);
      const before = new Uint8ClampedArray(image.data);

      expect(removeWatermarkFromAnchorOptions(image, anchors)).toBe('none');
      expect(image.data).toEqual(before);
    }
  });
});
