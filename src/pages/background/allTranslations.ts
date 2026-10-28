import arMessages from '@locales/ar/messages.json';
import enMessages from '@locales/en/messages.json';
import esMessages from '@locales/es/messages.json';
import frMessages from '@locales/fr/messages.json';
import jaMessages from '@locales/ja/messages.json';
import koMessages from '@locales/ko/messages.json';
import ptMessages from '@locales/pt/messages.json';
import ruMessages from '@locales/ru/messages.json';
import zhMessages from '@locales/zh/messages.json';
import zhTWMessages from '@locales/zh_TW/messages.json';

import { APP_LANGUAGES, type AppLanguage } from '@/utils/language';
import { getCurrentLanguage } from '@/utils/languagePreference';
import type { Translation, TranslationKey } from '@/utils/translations';

type MessageFile = Record<string, { message: string }>;

const baseMessages = {
  en: enMessages,
  zh: zhMessages,
  zh_TW: zhTWMessages,
  ja: jaMessages,
  fr: frMessages,
  es: esMessages,
  pt: ptMessages,
  ar: arMessages,
  ru: ruMessages,
  ko: koMessages,
} satisfies Record<AppLanguage, typeof enMessages>;

// MV3 service workers cannot use dynamic import(), including the content-page locale loader.
const primitiveMessages = import.meta.glob<MessageFile>(
  '../../features/plugins/verbs/*/messages/*.json',
  { eager: true, import: 'default' },
);

function buildTranslations(language: AppLanguage): Translation {
  const files = [
    baseMessages[language],
    ...Object.entries(primitiveMessages)
      .filter(([path]) => path.endsWith(`/messages/${language}.json`))
      .map(([, messages]) => messages),
  ];
  const translations: Record<string, string> = {};
  for (const file of files) {
    for (const [key, { message }] of Object.entries(file)) translations[key] = message;
  }
  // `bun run i18n:check` proves every base and primitive key in all supported languages.
  return translations as Translation;
}

const translationsByLanguage = new Map<AppLanguage, Translation>(
  APP_LANGUAGES.map((language) => [language, buildTranslations(language)]),
);

/** Background-only translations: every language is available through static imports. */
export async function getTranslation(key: TranslationKey): Promise<string> {
  const language = await getCurrentLanguage();
  return (
    translationsByLanguage.get(language)?.[key] ?? translationsByLanguage.get('en')?.[key] ?? key
  );
}
