import { initializeGeminiSelectors, type GeminiSelectorFile } from '@/core/gemini/selectors';

/** Install a real validated page snapshot; each test owns and retires its lifetime. */
export async function installGeminiTurnPatch(
  selectors: GeminiSelectorFile['selectors'],
): Promise<() => void> {
  const lifetime = new AbortController();
  const initialized = initializeGeminiSelectors({
    host: 'gemini.google.com',
    doc: document,
    lifetime: lifetime.signal,
    bundledRevision: 0,
    read: async () => ({
      format: 1,
      site: 'gemini',
      host: 'gemini.google.com',
      catalogRevision: 1,
      selectors,
    }),
  });
  await initialized.ready;
  return () => lifetime.abort();
}
