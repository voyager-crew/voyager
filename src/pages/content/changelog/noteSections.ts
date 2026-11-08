/**
 * Where a release note lives and which language of it to show. Free of extension
 * APIs: the docs site builds its changelog pages from the same notes with this.
 *
 * Each release is a folder of one file per language,
 * `notes/{VERSION}/{lang}.md`, so no single note grows past the commit size gate.
 */

/** Every release ships these languages; `en` is the fallback. */
export const NOTE_LOCALES = [
  'en',
  'zh',
  'zh_TW',
  'ja',
  'fr',
  'es',
  'pt',
  'ar',
  'ko',
  'ru',
] as const;

export const FALLBACK_NOTE_LOCALE = 'en';

/** Path of one language of a note, relative to the notes folder. */
export function notePath(version: string, lang: string): string {
  return `${version}/${lang}.md`;
}

/** The language to show: `lang` when the note has it, else `en`, else none. */
export function pickNoteLocale(lang: string, has: (lang: string) => boolean): string | null {
  if (has(lang)) return lang;
  return has(FALLBACK_NOTE_LOCALE) ? FALLBACK_NOTE_LOCALE : null;
}

/** A note's text without optional front matter (--- ... ---), trimmed. */
export function noteBody(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return (match ? match[1] : raw).trim();
}

const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;

/**
 * `markdown` with `replace` applied to its prose only: inline code and fenced
 * blocks keep their text, which is how a note shows a marker's own syntax.
 */
export function mapNoteProse(markdown: string, replace: (prose: string) => string): string {
  return markdown
    .split(CODE)
    .map((part, index) => (index % 2 === 0 ? replace(part) : part))
    .join('');
}

/** Order two `x.y.z` versions: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** The most releases one popup gathers; anything older stays on the docs site. */
export const MAX_GATHERED_NOTES = 5;

/**
 * The noted releases after `seen` up to `current`, newest first: what a person
 * who last read `seen` has not read yet. Updating past a release skips its
 * popup, so its note joins the next one.
 */
export function unseenNoteVersions(
  noted: readonly string[],
  seen: string,
  current: string,
): string[] {
  return noted
    .filter(
      (version) => compareVersions(version, seen) > 0 && compareVersions(version, current) <= 0,
    )
    .sort((a, b) => compareVersions(b, a))
    .slice(0, MAX_GATHERED_NOTES);
}

/** A note without its opening quote, for a release shown below a newer one. */
export function withoutOpeningQuote(body: string): string {
  return body.replace(/^(?:>[^\n]*(?:\n|$))+/, '').trim();
}
