import { initializeGeminiSelectors, type GeminiSelectorFile } from '@/core/gemini/selectors';

/** Real shared guard and page hydration; tests retire their snapshot after use. */
export async function installGeminiSelectorPatch(
  selectors: GeminiSelectorFile['selectors'],
): Promise<() => void> {
  const lifetime = new AbortController();
  const initialized = initializeGeminiSelectors({
    host: 'gemini.google.com',
    doc: document,
    lifetime: lifetime.signal,
    bundledRevision: 0,
    read: async () => ({
      format: 3,
      site: 'gemini',
      host: 'gemini.google.com',
      catalogRevision: 1,
      selectors,
    }),
  });
  await initialized.ready;
  return () => lifetime.abort();
}
