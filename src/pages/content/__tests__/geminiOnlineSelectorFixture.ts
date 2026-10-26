import { initializeGeminiSelectors, type GeminiSelectorPatch } from '@/core/gemini/selectors';

/** Real shared guard and page hydration; tests retire their snapshot after use. */
export async function installGeminiSelectorPatch(
  selectors: GeminiSelectorPatch,
): Promise<() => void> {
  const lifetime = new AbortController();
  const initialized = initializeGeminiSelectors({
    host: 'gemini.google.com',
    doc: document,
    lifetime: lifetime.signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'gemini',
      catalogRevision: 1,
      locators: selectors,
    }),
  });
  await initialized.ready;
  return () => lifetime.abort();
}
