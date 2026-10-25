import { describe, expect, it } from 'vitest';

import { MAX_GEMINI_SELECTOR_BYTES } from '@/core/gemini/selectors/validation';

import { readGeminiSelectorResponseBody } from '../response';
import { HOST, jsonResponse, selectorFile } from './testKit';

describe('Gemini selector response body', () => {
  it('cancels an oversized decompressed stream before reading the unbounded rest', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_GEMINI_SELECTOR_BYTES).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readGeminiSelectorResponseBody(new Response(stream), HOST, new AbortController().signal),
    ).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
  });

  it('rejects malformed UTF-8 before it can silently change a selector', async () => {
    const invalid = new Response(new Uint8Array([0xc3, 0x28]));
    await expect(
      readGeminiSelectorResponseBody(invalid, HOST, new AbortController().signal),
    ).rejects.toThrow();
  });

  it('cancels a stalled body reader when consent aborts the request', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const pending = readGeminiSelectorResponseBody(new Response(stream), HOST, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(cancelled).toBe(true);
  });

  it('keeps selector priority order from a valid response', async () => {
    const file = selectorFile(11, { 'turn.user': ['[data-role="user"]', '.query-text'] });
    expect(
      await readGeminiSelectorResponseBody(jsonResponse(file), HOST, new AbortController().signal),
    ).toEqual(file);
  });
});
