/** Gemini vocabulary facade over the shared site locator validator. */
import {
  MAX_SITE_SELECTOR_BYTES,
  MAX_SITE_SELECTOR_LENGTH,
  MAX_SITE_SELECTOR_LIST_LENGTH,
  readSiteSelectorProfiles,
  readSiteSelectorProfileGroup,
} from '../../selectors/validation';
import {
  GEMINI_SELECTOR_PROFILE_KEYS,
  type GeminiSelectorPatch,
  type GeminiSelectorProfileKey,
} from './types';

export const MAX_GEMINI_SELECTOR_BYTES = MAX_SITE_SELECTOR_BYTES;
export const MAX_GEMINI_SELECTOR_LENGTH = MAX_SITE_SELECTOR_LENGTH;
export const MAX_GEMINI_SELECTOR_LIST_LENGTH = MAX_SITE_SELECTOR_LIST_LENGTH;

export function isGeminiSelectorProfileKey(key: string): key is GeminiSelectorProfileKey {
  return (GEMINI_SELECTOR_PROFILE_KEYS as readonly string[]).includes(key);
}

export function readGeminiSelectorProfiles(value: unknown): GeminiSelectorPatch | null {
  return readSiteSelectorProfiles('gemini', value);
}

export function readGeminiSelectorProfileGroup<Key extends GeminiSelectorProfileKey>(
  value: unknown,
  keys: readonly Key[],
): Readonly<Record<Key, readonly string[]>> | null {
  return readSiteSelectorProfileGroup('gemini', value, keys);
}
