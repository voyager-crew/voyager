import type { GeminiSelectorFile, GeminiSelectorHost } from '@/core/gemini/selectors/types';
import {
  MAX_GEMINI_SELECTOR_BYTES,
  readGeminiSelectorFile,
} from '@/core/gemini/selectors/validation';

/** Fetch bodies are already decompressed; stop reading before decoded bytes exceed the budget. */
export async function readGeminiSelectorResponseBody(
  response: Response,
  host: GeminiSelectorHost,
  signal: AbortSignal,
): Promise<GeminiSelectorFile> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Empty Gemini selector response');
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Gemini selector request was aborted');
      const part = await reader.read();
      if (signal.aborted) throw new Error('Gemini selector request was aborted');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_GEMINI_SELECTOR_BYTES)
        throw new Error('Gemini selector response is too large');
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  const file = readGeminiSelectorFile(parsed, host);
  // v1 remains readable from an existing cache, but the v2 endpoint must serve its own format.
  if (!file || file.format !== 2) throw new Error('Invalid Gemini selector data');
  return file;
}
