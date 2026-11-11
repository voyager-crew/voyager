/**
 * A chat counts as a Create chat when a user message links a Voyager create
 * page (`createPageUrl`), which `buildCreationMessage` puts there. Nothing is
 * stored: the link in the chat is the marker, so it survives reloads and other
 * devices.
 */
import { createPageUrl } from '../authoring/skillLink';
import { authoringSites } from '../authoringSites';

const SCHEMES = ['https://', 'http://'] as const;
/** Characters that continue a URL: a marker after one is part of another URL. */
const URL_CHAR_BEFORE = /[\w.~%+\-/@:\\]/;
const URL_CHAR_AFTER = /[\w-]/;

function withoutScheme(url: string): string {
  const scheme = SCHEMES.find((prefix) => url.startsWith(prefix));
  return (scheme ? url.slice(scheme.length) : url).toLowerCase();
}

function markers(): readonly string[] {
  return authoringSites().map((site) => withoutScheme(createPageUrl(site.id)));
}

function linkStart(text: string, index: number): number {
  const scheme = SCHEMES.find((prefix) => text.endsWith(prefix, index));
  return scheme ? index - scheme.length : index;
}

function isStandaloneAt(text: string, index: number, length: number): boolean {
  const start = linkStart(text, index);
  const before = start > 0 ? text[start - 1] : '';
  const after = text[index + length] ?? '';
  return !URL_CHAR_BEFORE.test(before) && !URL_CHAR_AFTER.test(after);
}

/** True when `text` (a user message) links a create page, with or without its scheme. */
export function isCreationChatText(text: string): boolean {
  const lower = text.toLowerCase();
  return markers().some((marker) => {
    for (let at = lower.indexOf(marker); at >= 0; at = lower.indexOf(marker, at + 1)) {
      if (isStandaloneAt(lower, at, marker.length)) return true;
    }
    return false;
  });
}
