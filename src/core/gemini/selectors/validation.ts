import {
  GEMINI_SELECTOR_PROFILE_KEYS,
  type GeminiSelectorPatch,
  type GeminiSelectorProfileKey,
} from './types';

export const MAX_GEMINI_SELECTOR_BYTES = 65_536;
export const MAX_GEMINI_SELECTOR_LENGTH = 2_048;
export const MAX_GEMINI_SELECTOR_LIST_LENGTH = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isGeminiSelectorProfileKey(key: string): key is GeminiSelectorProfileKey {
  return (GEMINI_SELECTOR_PROFILE_KEYS as readonly string[]).includes(key);
}

/** Catalog site data and bundled fragments share this shape/size guard. */
export function readGeminiSelectorProfiles(value: unknown): GeminiSelectorPatch | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > GEMINI_SELECTOR_PROFILE_KEYS.length) return null;
  const selectors: Partial<Record<GeminiSelectorProfileKey, readonly string[]>> = {};
  for (const [key, list] of entries) {
    if (
      !isGeminiSelectorProfileKey(key) ||
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
  return Object.freeze(selectors);
}

/** Each bundled fragment owns exactly its declared keys, including before fragments are merged. */
export function readGeminiSelectorProfileGroup<Key extends GeminiSelectorProfileKey>(
  value: unknown,
  keys: readonly Key[],
): Readonly<Record<Key, readonly string[]>> | null {
  const profiles = readGeminiSelectorProfiles(value);
  if (
    !profiles ||
    Object.keys(profiles).length !== keys.length ||
    keys.some((key) => !profiles[key])
  ) {
    return null;
  }
  return profiles as Readonly<Record<Key, readonly string[]>>;
}

/** C0 control characters other than tab, line feed, form feed and carriage return. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}
