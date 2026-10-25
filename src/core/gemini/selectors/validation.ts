import {
  GEMINI_SELECTOR_HOSTS,
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorFile,
  type GeminiSelectorHost,
  type GeminiTurnProfileKey,
} from './types';

export const MAX_GEMINI_SELECTOR_BYTES = 65_536;
export const MAX_GEMINI_SELECTOR_LENGTH = 2_048;
export const MAX_GEMINI_SELECTOR_LIST_LENGTH = 32;

const ENVELOPE_KEYS = ['format', 'site', 'host', 'catalogRevision', 'selectors'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isGeminiTurnProfileKey(key: string): key is GeminiTurnProfileKey {
  return (GEMINI_TURN_PROFILE_KEYS as readonly string[]).includes(key);
}

/** Shared shape/size guard; the page checks native syntax before adopting any patch. */
export function readGeminiSelectorFile(
  value: unknown,
  expectedHost: string,
): GeminiSelectorFile | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).length !== ENVELOPE_KEYS.length ||
    !Object.keys(value).every((key) => (ENVELOPE_KEYS as readonly string[]).includes(key)) ||
    value.format !== 1 ||
    value.site !== 'gemini' ||
    value.host !== expectedHost ||
    !(GEMINI_SELECTOR_HOSTS as readonly string[]).includes(expectedHost) ||
    typeof value.catalogRevision !== 'number' ||
    !Number.isSafeInteger(value.catalogRevision) ||
    value.catalogRevision <= 0 ||
    !isRecord(value.selectors)
  ) {
    return null;
  }
  const entries = Object.entries(value.selectors);
  if (entries.length > GEMINI_TURN_PROFILE_KEYS.length) return null;
  const selectors: Partial<Record<GeminiTurnProfileKey, readonly string[]>> = {};
  for (const [key, list] of entries) {
    if (
      !isGeminiTurnProfileKey(key) ||
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > MAX_GEMINI_SELECTOR_LIST_LENGTH
    ) {
      return null;
    }
    const strings: string[] = [];
    for (const item of list) {
      if (
        typeof item !== 'string' ||
        item.trim().length === 0 ||
        item.length > MAX_GEMINI_SELECTOR_LENGTH ||
        hasControlCharacter(item)
      ) {
        return null;
      }
      strings.push(item);
    }
    selectors[key] = Object.freeze(strings);
  }
  // Serialization also bounds cache objects, not just the downloaded response bytes.
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_GEMINI_SELECTOR_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return Object.freeze({
    format: 1,
    site: 'gemini',
    host: expectedHost as GeminiSelectorHost,
    catalogRevision: value.catalogRevision,
    selectors: Object.freeze(selectors),
  });
}

/** C0 control characters other than tab, line feed, form feed and carriage return. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}
