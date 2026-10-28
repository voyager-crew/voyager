import enMessages from '@locales/en/messages.json';

import { APP_LANGUAGES, type AppLanguage } from './language';

type RawLocaleMessages = typeof enMessages;
type MessageFile = Record<string, { message: string }>;

/**
 * A primitive's own strings live in `features/plugins/verbs/<name>/messages/<lang>.json`.
 * Its folder types their keys by merging its English fragment into this interface:
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
  '../features/plugins/verbs/*/messages/en.json',
  { eager: true, import: 'default' },
);
const localeFiles = import.meta.glob<MessageFile>(
  ['../locales/*/messages.json', '!../locales/en/messages.json'],
  { import: 'default' },
);
const primitiveMessageFiles = import.meta.glob<MessageFile>(
  ['../features/plugins/verbs/*/messages/*.json', '!../features/plugins/verbs/*/messages/en.json'],
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
        ...Object.entries(primitiveMessageFiles)
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
