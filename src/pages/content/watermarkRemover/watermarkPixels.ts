/**
 * Watermark Pixel Removal Module
 *
 * This module is ported from gemini-watermark-remover by journey-ad (Jad),
 * itself based on GeminiWatermarkTool by AllenK (Kwyshell).
 * Original: https://github.com/journey-ad/gemini-watermark-remover/blob/main/src/core/watermarkEngine.js
 * License: MIT - Copyright (c) 2025 Jad; Copyright (c) 2024 AllenK (Kwyshell)
 * Full retained notice: see /THIRD_PARTY_NOTICES.md
 *
 * Owns anchor trials, safe pixel removal, and residual cleanup.
 */
import { type WatermarkPosition, removeWatermark } from './blendModes';
import {
  assessDifficultWatermarkRemovalCandidate,
  assessWatermarkRemovalCandidate,
  getWatermarkSignalStrength,
  hasGradientRemovalEvidence,
  hasReliableWatermarkSignal,
  hasResidualWatermarkEdges,
  hasSafeSupportedReliabilityTransition,
  measureSevereUndershootRatio,
  measureWatermarkSignal,
} from './watermarkDetector';

type WatermarkPresence = 'reliable' | 'difficult' | 'none';

export interface WatermarkConfig {
  logoSize: number;
  marginRight: number;
  marginBottom: number;
  alphaVariant?: WatermarkAlphaVariant;
}

export type WatermarkAlphaVariant = '20260520' | '20260520-small';

export interface WatermarkAnchorOption {
  config: WatermarkConfig;
  alphaMap: Float32Array;
}

const WATERMARK_MAX_REMOVAL_PASSES = 3;

/**
 * Calculate watermark position in image based on image size and watermark configuration
 * @param imageWidth - Image width
 * @param imageHeight - Image height
 * @param config - Watermark configuration {logoSize, marginRight, marginBottom}
 * @returns Watermark position {x, y, width, height}
 */
export function calculateWatermarkPosition(
  imageWidth: number,
  imageHeight: number,
  config: WatermarkConfig,
): WatermarkPosition {
  const { logoSize, marginRight, marginBottom } = config;

  return {
    x: imageWidth - marginRight - logoSize,
    y: imageHeight - marginBottom - logoSize,
    width: logoSize,
    height: logoSize,
  };
}

export function chooseWatermarkAnchorOption(
  imageData: ImageData,
  options: WatermarkAnchorOption[],
): WatermarkAnchorOption {
  if (options.length <= 1) {
    return options[0];
  }

  let strongestReliable:
    | { option: WatermarkAnchorOption; signal: ReturnType<typeof measureWatermarkSignal> }
    | undefined;

  for (const option of getSnappedWatermarkAnchorOptions(options)) {
    const position = calculateWatermarkPosition(imageData.width, imageData.height, option.config);
    const signal = measureWatermarkSignal(imageData, option.alphaMap, position);
    if (!hasReliableWatermarkSignal(signal)) continue;
    if (
      !strongestReliable ||
      getWatermarkSignalStrength(signal) > getWatermarkSignalStrength(strongestReliable.signal)
    ) {
      strongestReliable = { option, signal };
    }
  }

  return strongestReliable?.option ?? options[0];
}

function snapshotWatermarkRegion(
  imageData: ImageData,
  position: WatermarkPosition,
): Uint8ClampedArray {
  const snapshot = new Uint8ClampedArray(position.width * position.height * 4);
  for (let row = 0; row < position.height; row++) {
    const sourceStart = ((position.y + row) * imageData.width + position.x) * 4;
    const targetStart = row * position.width * 4;
    snapshot.set(
      imageData.data.subarray(sourceStart, sourceStart + position.width * 4),
      targetStart,
    );
  }
  return snapshot;
}

function restoreWatermarkRegion(
  imageData: ImageData,
  position: WatermarkPosition,
  snapshot: Uint8ClampedArray,
): void {
  for (let row = 0; row < position.height; row++) {
    const sourceStart = row * position.width * 4;
    const targetStart = ((position.y + row) * imageData.width + position.x) * 4;
    imageData.data.set(
      snapshot.subarray(sourceStart, sourceStart + position.width * 4),
      targetStart,
    );
  }
}

function isWatermarkPositionInBounds(imageData: ImageData, position: WatermarkPosition): boolean {
  return (
    position.width > 0 &&
    position.height > 0 &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.x + position.width <= imageData.width &&
    position.y + position.height <= imageData.height
  );
}

function getSnappedWatermarkAnchorOptions(
  options: WatermarkAnchorOption[],
): WatermarkAnchorOption[] {
  return options.flatMap((option) => {
    const snapOffsets =
      option.config.alphaVariant === '20260520-small' ? [-3, -2, -1, 0, 1, 2, 3] : [0];

    return snapOffsets.flatMap((offsetX) =>
      snapOffsets.map((offsetY) =>
        offsetX === 0 && offsetY === 0
          ? option
          : {
              ...option,
              config: {
                ...option.config,
                marginRight: option.config.marginRight - offsetX,
                marginBottom: option.config.marginBottom - offsetY,
              },
            },
      ),
    );
  });
}

export function chooseDifficultWatermarkAnchorOption(
  imageData: ImageData,
  options: WatermarkAnchorOption[],
): WatermarkAnchorOption | undefined {
  let best:
    | {
        option: WatermarkAnchorOption;
        suppression: number;
      }
    | undefined;

  for (const option of getSnappedWatermarkAnchorOptions(options)) {
    const position = calculateWatermarkPosition(imageData.width, imageData.height, option.config);
    if (!isWatermarkPositionInBounds(imageData, position)) continue;

    const originalSignal = measureWatermarkSignal(imageData, option.alphaMap, position);
    const severeUndershootRatio = measureSevereUndershootRatio(
      imageData,
      option.alphaMap,
      position,
    );
    const snapshot = snapshotWatermarkRegion(imageData, position);
    let finalSignal: ReturnType<typeof measureWatermarkSignal>;

    try {
      removeWatermark(imageData, option.alphaMap, position);
      finalSignal = measureWatermarkSignal(imageData, option.alphaMap, position);
    } finally {
      restoreWatermarkRegion(imageData, position, snapshot);
    }

    const assessment = assessDifficultWatermarkRemovalCandidate(
      originalSignal,
      finalSignal,
      severeUndershootRatio,
    );
    if (!assessment.eligible) continue;
    if (!best || assessment.suppression > best.suppression) {
      best = {
        option,
        suppression: assessment.suppression,
      };
    }
  }

  return best?.option;
}

/**
 * Last resort for the V2 star at its exact anchor: trial one pass per anchor
 * on the original pixels and keep the one whose edges it erased most, when
 * the edge evidence alone proves a watermark was there.
 */
function removeOnGradientEvidence(
  imageData: ImageData,
  anchorOptions: WatermarkAnchorOption[],
): boolean {
  const candidates = anchorOptions.filter((option) => option.config.alphaVariant === '20260520');
  if (candidates.length === 0) return false;
  const original = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  let best: { option: WatermarkAnchorOption; residual: number } | undefined;

  for (const option of candidates) {
    const position = calculateWatermarkPosition(imageData.width, imageData.height, option.config);
    if (!isWatermarkPositionInBounds(imageData, position)) continue;

    const snapshot = snapshotWatermarkRegion(imageData, position);
    try {
      removeWatermark(imageData, option.alphaMap, position);
      const assessment = assessWatermarkRemovalCandidate(
        original,
        imageData,
        option.alphaMap,
        position,
      );
      if (!hasGradientRemovalEvidence(assessment)) continue;
      const residual = Math.abs(assessment.candidateSignal.gradientScore);
      if (!best || residual < best.residual) best = { option, residual };
    } finally {
      restoreWatermarkRegion(imageData, position, snapshot);
    }
  }

  if (!best) return false;
  removeWatermark(
    imageData,
    best.option.alphaMap,
    calculateWatermarkPosition(imageData.width, imageData.height, best.option.config),
  );
  return true;
}

export function removeWatermarkFromAnchorOptions(
  imageData: ImageData,
  anchorOptions: WatermarkAnchorOption[],
): WatermarkPresence {
  const trustedOption = chooseWatermarkAnchorOption(imageData, anchorOptions);
  const trustedPosition = calculateWatermarkPosition(
    imageData.width,
    imageData.height,
    trustedOption.config,
  );
  const trustedSignal = measureWatermarkSignal(imageData, trustedOption.alphaMap, trustedPosition);

  if (hasReliableWatermarkSignal(trustedSignal)) {
    // Gemini can stack multiple transparent marks after iterative edits, so
    // trusted candidates retain the iterative safety rollback. Only the exact
    // full-size V2 preset may use its narrower first-pass transition evidence.
    const allowSupportedReliabilityTransition =
      trustedOption.config.logoSize === 96 && trustedOption.config.alphaVariant === '20260520';
    const passes = removeWatermarkWithResidualCheck(
      imageData,
      trustedOption.alphaMap,
      trustedPosition,
      allowSupportedReliabilityTransition,
    );
    if (passes === 0) removeOnGradientEvidence(imageData, anchorOptions);
    return 'reliable';
  }

  // Only fall back after every known anchor misses the trusted thresholds.
  // Each difficult candidate is trialed against, and restored to, the same
  // original pixels before the strongest safe suppression is applied once.
  const difficultOption = chooseDifficultWatermarkAnchorOption(imageData, anchorOptions);
  if (!difficultOption) {
    return removeOnGradientEvidence(imageData, anchorOptions) ? 'difficult' : 'none';
  }

  const difficultPosition = calculateWatermarkPosition(
    imageData.width,
    imageData.height,
    difficultOption.config,
  );
  removeWatermark(imageData, difficultOption.alphaMap, difficultPosition);
  return 'difficult';
}

function createGaussianKernel(radius: number, sigma: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index++) kernel[index] /= sum;
  return kernel;
}

function blurScalarField(
  values: Float32Array,
  width: number,
  height: number,
  radius: number,
  sigma: number,
): Float32Array {
  const kernel = createGaussianKernel(radius, sigma);
  const horizontal = new Float32Array(values.length);
  const result = new Float32Array(values.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        sum += values[y * width + sampleX] * kernel[offset + radius];
      }
      horizontal[y * width + x] = sum;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        sum += horizontal[sampleY * width + x] * kernel[offset + radius];
      }
      result[y * width + x] = sum;
    }
  }

  return result;
}

function createResidualCleanupWeights(
  alphaMap: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const gradient = new Float32Array(alphaMap.length);
  let maxGradient = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gradientX =
        -alphaMap[index - width - 1] -
        2 * alphaMap[index - 1] -
        alphaMap[index + width - 1] +
        alphaMap[index - width + 1] +
        2 * alphaMap[index + 1] +
        alphaMap[index + width + 1];
      const gradientY =
        -alphaMap[index - width - 1] -
        2 * alphaMap[index - width] -
        alphaMap[index - width + 1] +
        alphaMap[index + width - 1] +
        2 * alphaMap[index + width] +
        alphaMap[index + width + 1];
      const magnitude = Math.hypot(gradientX, gradientY);
      gradient[index] = magnitude;
      maxGradient = Math.max(maxGradient, magnitude);
    }
  }
  if (maxGradient === 0) return gradient;

  const expanded = new Float32Array(alphaMap.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxWeight = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY++) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        for (let offsetX = -2; offsetX <= 2; offsetX++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          maxWeight = Math.max(
            maxWeight,
            Math.sqrt(gradient[sampleY * width + sampleX] / maxGradient),
          );
        }
      }
      expanded[y * width + x] = maxWeight;
    }
  }

  const smoothed = blurScalarField(expanded, width, height, 4, 2);
  for (let index = 0; index < smoothed.length; index++) {
    smoothed[index] = Math.min(1, smoothed[index] * 0.85);
  }
  return smoothed;
}

function softenWatermarkResidual(
  imageData: ImageData,
  alphaMap: Float32Array,
  position: WatermarkPosition,
): void {
  if (alphaMap.length !== position.width * position.height) return;

  const weights = createResidualCleanupWeights(alphaMap, position.width, position.height);
  const blurRadius = 10;
  const kernel = createGaussianKernel(blurRadius, 8);
  const original = new Uint8ClampedArray(imageData.data);

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const weight = weights[row * position.width + col];
      if (weight <= 0.01) continue;

      const imageX = position.x + col;
      const imageY = position.y + row;
      const targetIndex = (imageY * imageData.width + imageX) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let blurred = 0;
        for (let offsetY = -blurRadius; offsetY <= blurRadius; offsetY++) {
          const sampleY = Math.max(0, Math.min(imageData.height - 1, imageY + offsetY));
          const weightY = kernel[offsetY + blurRadius];
          for (let offsetX = -blurRadius; offsetX <= blurRadius; offsetX++) {
            const sampleX = Math.max(0, Math.min(imageData.width - 1, imageX + offsetX));
            const sampleIndex = (sampleY * imageData.width + sampleX) * 4 + channel;
            blurred += original[sampleIndex] * weightY * kernel[offsetX + blurRadius];
          }
        }
        imageData.data[targetIndex + channel] = Math.round(
          original[targetIndex + channel] * (1 - weight) + blurred * weight,
        );
      }
    }
  }
}

export function removeWatermarkWithResidualCheck(
  imageData: ImageData,
  alphaMap: Float32Array,
  position: WatermarkPosition,
  allowSupportedReliabilityTransition = false,
): number {
  let passes = 0;
  let currentSignal = measureWatermarkSignal(imageData, alphaMap, position);
  if (!hasReliableWatermarkSignal(currentSignal)) return passes;

  const originalImageData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );

  while (passes < WATERMARK_MAX_REMOVAL_PASSES) {
    const previousRegion = snapshotWatermarkRegion(imageData, position);
    const severeUndershootRatio = measureSevereUndershootRatio(imageData, alphaMap, position);
    removeWatermark(imageData, alphaMap, position);
    const assessment = assessWatermarkRemovalCandidate(
      originalImageData,
      imageData,
      alphaMap,
      position,
      currentSignal,
      severeUndershootRatio,
    );
    const supportedReliabilityTransition =
      allowSupportedReliabilityTransition &&
      passes === 0 &&
      hasSafeSupportedReliabilityTransition(assessment);
    if (!assessment.safe && !supportedReliabilityTransition) {
      restoreWatermarkRegion(imageData, position, previousRegion);
      break;
    }

    passes++;
    currentSignal = assessment.candidateSignal;
    if (!hasReliableWatermarkSignal(currentSignal)) break;
  }

  if (passes > 0 && hasResidualWatermarkEdges(currentSignal)) {
    softenWatermarkResidual(imageData, alphaMap, position);
  }

  return passes;
}
