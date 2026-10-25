import { type GeminiSelectorLifetime, initializeGeminiSelectors } from '@/core/gemini/selectors';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { loadGeminiSelectorSnapshot } from '@/features/geminiSelectorFixes/cache';
import { isGeminiSelectorRemoteEnabledAtBuild } from '@/features/geminiSelectorFixes/config';
import { GEMINI_SELECTOR_REFRESH_MESSAGE } from '@/features/geminiSelectorFixes/messages';
import { geminiSelectorHostFromUrl } from '@/features/geminiSelectorFixes/policy';

interface PageSelectorStartupInput {
  readonly url: string;
  readonly doc: Document;
  readonly lifetime: AbortSignal;
}

export interface PageSelectorStartup extends GeminiSelectorLifetime {
  readonly isCurrent: () => boolean;
}

/** Only PluginHost and feature admission wait; ping, theme and page services stay synchronous. */
export function startPageGeminiSelectors(input: PageSelectorStartupInput): PageSelectorStartup {
  let stopped = false;
  const isCurrent = () => !stopped && !input.lifetime.aborted;
  const host = geminiSelectorHostFromUrl(input.url);
  if (!host || !isGeminiSelectorRemoteEnabledAtBuild() || input.lifetime.aborted) {
    return {
      ready: Promise.resolve(),
      stop: () => {
        stopped = true;
      },
      isCurrent,
    };
  }

  let consentChanged = false;
  let enabled = false;
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES in changes) {
      // A read started before OFF must not install the cache that OFF is deleting.
      consentChanged = true;
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  const snapshot = initializeGeminiSelectors({
    host,
    doc: input.doc,
    lifetime: input.lifetime,
    read: async () => {
      const cached = await loadGeminiSelectorSnapshot(host);
      enabled = cached.enabled;
      return consentChanged ? null : cached.file;
    },
  });
  const removeListener = () => chrome.storage.onChanged.removeListener(onChanged);
  const ready = snapshot.ready.then(() => {
    removeListener();
    if (!enabled || consentChanged || !isCurrent()) return;
    // Downloads only prepare the next document; they never change this page's snapshot.
    try {
      void Promise.resolve(
        chrome.runtime.sendMessage({ type: GEMINI_SELECTOR_REFRESH_MESSAGE, host, force: false }),
      ).catch(() => logger.debug('Gemini selector due check unavailable'));
    } catch {
      logger.debug('Gemini selector due check unavailable');
    }
  });
  return {
    ready,
    isCurrent,
    stop: () => {
      // beforeunload cleanup need not abort pageLifetime, but it still retires this startup.
      stopped = true;
      removeListener();
      snapshot.stop();
    },
  };
}
