import { GEMINI_SELECTOR_HOSTS, type GeminiSelectorFile } from '@/core/gemini/selectors/types';
import { readGeminiSelectorFile } from '@/core/gemini/selectors/validation';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';

import { isGeminiSelectorRemoteEnabledAtBuild } from './config';
import {
  type GeminiSelectorStorage,
  geminiSelectorStorage,
  isGeminiSelectorConsentEnabled,
} from './settings';

export interface GeminiSelectorCacheEntry {
  readonly format: 1;
  readonly host: string;
  readonly extensionVersion: string;
  readonly fetchedAt: number;
  readonly file: GeminiSelectorFile;
}

export function geminiSelectorCacheKey(host: string): string {
  return `${StorageKeys.GEMINI_SELECTOR_CACHE_PREFIX}${host}`;
}

export function geminiSelectorAttemptKey(host: string): string {
  return `${StorageKeys.GEMINI_SELECTOR_ATTEMPT_PREFIX}${host}`;
}

export function readGeminiSelectorAttempt(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const attempt = (value as { lastAttemptAt?: unknown }).lastAttemptAt;
  return typeof attempt === 'number' && Number.isSafeInteger(attempt) && attempt >= 0
    ? attempt
    : null;
}

export function readCachedGeminiSelectorFile(
  value: unknown,
  host: string,
  extensionVersion: string = EXTENSION_VERSION,
): GeminiSelectorFile | null {
  if (!isGeminiSelectorHost(host) || typeof value !== 'object' || value === null) return null;
  const entry = value as Partial<GeminiSelectorCacheEntry>;
  if (
    entry.format !== 1 ||
    entry.host !== host ||
    entry.extensionVersion !== extensionVersion ||
    typeof entry.fetchedAt !== 'number' ||
    !Number.isSafeInteger(entry.fetchedAt) ||
    entry.fetchedAt < 0
  ) {
    return null;
  }
  return readGeminiSelectorFile(entry.file, host);
}

export async function clearGeminiSelectorCaches(
  storage: GeminiSelectorStorage = geminiSelectorStorage(),
): Promise<void> {
  // Attempt metadata is separate so OFF -> ON cannot trigger a fresh automatic check.
  await storage.remove(GEMINI_SELECTOR_HOSTS.map(geminiSelectorCacheKey));
}

export async function loadGeminiSelectorSnapshot(
  host: string,
  extensionVersion: string = EXTENSION_VERSION,
): Promise<{ enabled: boolean; file: GeminiSelectorFile | null }> {
  if (!isGeminiSelectorHost(host) || !isGeminiSelectorRemoteEnabledAtBuild()) {
    return { enabled: false, file: null };
  }
  try {
    const cacheKey = geminiSelectorCacheKey(host);
    const values = await chrome.storage.local.get([
      StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES,
      cacheKey,
    ]);
    const enabled = isGeminiSelectorConsentEnabled(
      values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES],
    );
    return {
      enabled,
      file: enabled ? readCachedGeminiSelectorFile(values[cacheKey], host, extensionVersion) : null,
    };
  } catch (error) {
    logger.warn('Gemini selector snapshot could not be read', { error: String(error) });
    return { enabled: false, file: null };
  }
}
