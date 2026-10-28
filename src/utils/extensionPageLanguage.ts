import { getCachedLanguage, initI18n } from './i18n';
import type { AppLanguage } from './language';

/** Extension pages mount React only once their first frame can use the saved language. */
export async function prepareExtensionPageLanguage(): Promise<AppLanguage> {
  await initI18n();
  return getCachedLanguage() ?? 'en';
}
