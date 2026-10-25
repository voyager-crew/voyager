import { initializeGeminiSelectors } from '@/core/gemini/selectors';
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

export interface PageSelectorStartup {
  readonly ready: Promise<void>;
  readonly stop: () => void;
  readonly isCurrent: () => boolean;
}

/** Only PluginHost and feature admission wait; ping, theme and page services stay synchronous. */
export function startPageGeminiSelectors(input: PageSelectorStartupInput): PageSelectorStartup {
  const host = geminiSelectorHostFromUrl(input.url);
  if (!host || !isGeminiSelectorRemoteEnabledAtBuild() || input.lifetime.aborted) {
    // Nothing is read here, so there is no phase to retire; stop only ends isCurrent.
    let stopped = false;
    return {
      ready: Promise.resolve(),
      stop: () => {
        stopped = true;
      },
      isCurrent: () => !stopped && !input.lifetime.aborted,
    };
  }

  let snapshot: ReturnType<typeof loadGeminiSelectorSnapshot> | null = null;
  const hydration = initializeGeminiSelectors({
    host,
    doc: input.doc,
    lifetime: input.lifetime,
    read: () => (snapshot = loadGeminiSelectorSnapshot(host)).then((cached) => cached.file),
    // A read started before OFF must not install the cache that OFF is deleting.
    invalidatedBy: (invalidate) => {
      const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES in changes) invalidate();
      };
      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    },
  });
  const ready = hydration.ready.then(async (settlement) => {
    // Only a read that finished in time says whether consent is on.
    if (settlement !== 'read' || !snapshot) return;
    const { enabled } = await snapshot;
    if (enabled && hydration.isCurrent()) requestDueCheck(host);
  });
  // beforeunload cleanup need not abort pageLifetime, but its stop still retires this startup.
  return { ready, stop: hydration.stop, isCurrent: hydration.isCurrent };
}

/** Downloads only prepare the next document; they never change this page's snapshot. */
function requestDueCheck(host: string): void {
  try {
    void Promise.resolve(
      chrome.runtime.sendMessage({ type: GEMINI_SELECTOR_REFRESH_MESSAGE, host, force: false }),
    ).catch(() => logger.debug('Gemini selector due check unavailable'));
  } catch {
    logger.debug('Gemini selector due check unavailable');
  }
}
