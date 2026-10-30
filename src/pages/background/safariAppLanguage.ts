/**
 * The Voyager macOS app shows its own window, in the language chosen in Voyager rather than the
 * system's. The background hands that language to the native side when it starts and whenever it
 * changes; the app reads it at launch.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { sendSafariAppLanguage } from '@/core/utils/safariAppLanguage';
import type { AppLanguage } from '@/utils/language';
import { getCurrentLanguage } from '@/utils/languagePreference';

export function startSafariAppLanguageHandoff(): void {
  let handedOver: AppLanguage | null = null;
  // One read at a time, so a slower read can never hand over an older choice last.
  let queue: Promise<void> = Promise.resolve();
  const handOver = (): void => {
    queue = queue.then(async () => {
      const language = await getCurrentLanguage();
      if (language === handedOver) return;
      try {
        await sendSafariAppLanguage(language);
        handedOver = language;
      } catch (error) {
        // A temporary extension has no native side; the next start or change tries again.
        logger.warn('[SafariAppLanguage] Could not hand the language to the Voyager app', {
          error: String(error),
        });
      }
    });
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if ((areaName === 'sync' || areaName === 'local') && StorageKeys.LANGUAGE in changes) {
      handOver();
    }
  });
  handOver();
}
