import enMessages from '@locales/en/messages.json';

import { APP_LANGUAGES, type AppLanguage, localeFromLanguage } from './language';

type RawLocaleMessages = typeof enMessages;
type MessageFile = Record<string, { message: string }>;

/**
 * Feature strings live in `features/plugins/verbs/<name>/messages/<lang>.json`,
 * `pages/content/panelShell/messages/<lang>.json` or `pages/panel/messages/<lang>.json`.
 * Each owner types its keys by merging its English fragment into this interface:
 *
 *   import type messages from './messages/en.json';
 *   declare module '@/utils/translations' {
 *     interface PrimitiveMessages { tableCopy: typeof messages }
 *   }
 */
export interface PrimitiveMessages {}

type PrimitiveMessageKey = {
  [Name in keyof PrimitiveMessages]: keyof PrimitiveMessages[Name] & string;
}[keyof PrimitiveMessages];

export type TranslationKey = keyof RawLocaleMessages | PrimitiveMessageKey;
export type Translation = Record<TranslationKey, string>;

const englishFragments = import.meta.glob<MessageFile>(
  [
    '../features/plugins/verbs/*/messages/en.json',
    '../pages/content/panelShell/messages/en.json',
    '../pages/panel/messages/en.json',
  ],
  { eager: true, import: 'default' },
);
const localeFiles = import.meta.glob<MessageFile>(
  ['../locales/*/messages.json', '!../locales/en/messages.json'],
  { import: 'default' },
);
const fragmentMessageFiles = import.meta.glob<MessageFile>(
  [
    '../features/plugins/verbs/*/messages/*.json',
    '../pages/content/panelShell/messages/*.json',
    '../pages/panel/messages/*.json',
    '!../features/plugins/verbs/*/messages/en.json',
    '!../pages/content/panelShell/messages/en.json',
    '!../pages/panel/messages/en.json',
  ],
  { import: 'default' },
);

function buildTranslations(files: MessageFile[]): Translation {
  const merged: Record<string, string> = {};
  for (const file of files) {
    for (const [key, { message }] of Object.entries(file)) merged[key] = message;
  }
  // `bun run i18n:check` proves the base and fragment keys for every language.
  return merged as Translation;
}

const englishTranslations = buildTranslations([enMessages, ...Object.values(englishFragments)]);
const loadedTranslations = new Map<AppLanguage, Translation>([['en', englishTranslations]]);
const translationLoads = new Map<AppLanguage, Promise<Translation>>();

/** English is always available; other tables appear only after their load completes. */
export function getLoadedTranslations(language: 'en'): Translation;
export function getLoadedTranslations(language: AppLanguage): Translation | undefined;
export function getLoadedTranslations(language: AppLanguage): Translation | undefined {
  if (language === 'en') return englishTranslations;
  return loadedTranslations.get(language);
}

/** Share in-flight work and retain the merged table for subsequent lookups. */
export function loadTranslations(language: AppLanguage): Promise<Translation> {
  const pending = translationLoads.get(language);
  if (pending) return pending;

  const loaded = loadedTranslations.get(language);
  const load = loaded
    ? Promise.resolve(loaded)
    : Promise.all([
        localeFiles[`../locales/${language}/messages.json`](),
        ...Object.entries(fragmentMessageFiles)
          .filter(([path]) => path.endsWith(`/messages/${language}.json`))
          .map(([, importMessages]) => importMessages()),
      ]).then((files) => {
        const translations = buildTranslations(files);
        loadedTranslations.set(language, translations);
        return translations;
      });
  translationLoads.set(language, load);
  // A transient chunk failure should not prevent a later language selection from retrying.
  void load.catch(() => translationLoads.delete(language));
  return load;
}

/** Settings search indexes every language, but ordinary pages never need to. */
export async function loadAllTranslations(): Promise<void> {
  await Promise.all(APP_LANGUAGES.map(loadTranslations));
}

export function isTranslationKey(value: string): value is TranslationKey {
  return value in englishTranslations;
}

export type PluralForm = 'one' | 'few' | 'many' | 'other';

export interface PluralTranslationOptions<Key extends string> {
  language: AppLanguage;
  key: Key;
  count: number;
  translations: Readonly<Record<string, string> & Record<`${Key}_other`, string>>;
}

/** Pass the Voyager language and its table, e.g. { language, key: 'panelCount', count, translations }. */
export function getPluralTranslation<Key extends string>({
  language,
  key,
  count,
  translations,
}: PluralTranslationOptions<Key>): string {
  const locale = localeFromLanguage(language);
  const category = new Intl.PluralRules(locale).select(count);
  const form: PluralForm =
    category === 'one' || category === 'few' || category === 'many' ? category : 'other';
  const selectedKey = `${key}_${form}`;
  const fallbackKey = `${key}_other`;
  const message = translations[selectedKey] ?? translations[fallbackKey];
  const formattedCount = new Intl.NumberFormat(locale).format(count);
  return message.replace(/\{count\}/g, formattedCount);
}

/** `language` comes from useLanguage() or getCachedLanguage(), never navigator.language. */
export function formatRelativeTime(
  language: AppLanguage,
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  return new Intl.RelativeTimeFormat(localeFromLanguage(language), options).format(value, unit);
}
