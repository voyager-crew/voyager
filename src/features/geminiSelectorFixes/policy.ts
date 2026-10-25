import type { GeminiSelectorHost } from '@/core/gemini/selectors/types';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';

export const GEMINI_SELECTOR_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const GEMINI_SELECTOR_TIMEOUT_MS = 15_000;
const GEMINI_SELECTOR_BASE_URL = 'https://voyager.nagi.fun/catalog/gemini-selectors/v1/hosts';

export function geminiSelectorHostFromUrl(url: string | undefined): GeminiSelectorHost | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) {
      return undefined;
    }
    return isGeminiSelectorHost(parsed.hostname) ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
}

export function geminiSelectorFileUrl(host: GeminiSelectorHost): string {
  return `${GEMINI_SELECTOR_BASE_URL}/${host}.json`;
}

export function isGeminiSelectorCheckDue(lastAttemptAt: number | null, now: number): boolean {
  return lastAttemptAt === null || now - lastAttemptAt >= GEMINI_SELECTOR_CHECK_INTERVAL_MS;
}
