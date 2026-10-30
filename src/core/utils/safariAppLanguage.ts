import browser from 'webextension-polyfill';

import type { AppLanguage } from '@/utils/language';

const SAFARI_NATIVE_APP_ID = 'com.yourCompany.Gemini-Voyager';

/** Tells the Voyager macOS app which language to show its window in from its next launch. */
export async function sendSafariAppLanguage(language: AppLanguage): Promise<void> {
  const response: unknown = await browser.runtime.sendNativeMessage(SAFARI_NATIVE_APP_ID, {
    action: 'setAppLanguage',
    language,
  });
  const data =
    typeof response === 'object' && response !== null && 'data' in response ? response.data : null;
  const saved = typeof data === 'object' && data !== null && 'saved' in data && data.saved === true;
  if (!saved) throw new Error('The Voyager app did not save the language');
}
