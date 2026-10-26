import { afterEach, expect, it, vi } from 'vitest';

import { GeminiSelectorService } from '@/core/gemini/selectors';

import { hasExportSearchImages } from '../exportSearchImages';

afterEach(() => vi.restoreAllMocks());

it.each([
  { siteId: 'chatgpt', original: false },
  { siteId: 'chatgpt', original: true },
  { siteId: 'gemini', original: true },
])(
  '$siteId source choice (already detected: $original) works without a Gemini page snapshot',
  ({ siteId, original }) => {
    // These source choices predate the Gemini channel and must not depend on its state.
    vi.spyOn(GeminiSelectorService.prototype, 'getView').mockImplementation(() => {
      throw new Error('No Gemini page snapshot is available');
    });
    const turn = original
      ? { assistantContent: { html: 'attachment-container.search-images' } }
      : {};
    expect(hasExportSearchImages(turn, siteId)).toBe(original);
  },
);
