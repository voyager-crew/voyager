import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';

export interface GeminiSelectorStorage {
  get(keys: string | readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

export function geminiSelectorStorage(): GeminiSelectorStorage {
  return {
    get: (keys) => chrome.storage.local.get(typeof keys === 'string' ? keys : [...keys]),
    set: (values) => chrome.storage.local.set(values),
    remove: (keys) => chrome.storage.local.remove(typeof keys === 'string' ? keys : [...keys]),
  };
}

export function isGeminiSelectorConsentEnabled(value: unknown): boolean {
  return value === true;
}

export async function loadGeminiSelectorEnabled(
  storage: GeminiSelectorStorage = geminiSelectorStorage(),
): Promise<boolean> {
  try {
    const values = await storage.get(StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES);
    return isGeminiSelectorConsentEnabled(values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]);
  } catch (error) {
    // An unavailable preference is not permission to start a request.
    logger.warn('Gemini selector consent could not be read', { error: String(error) });
    return false;
  }
}
