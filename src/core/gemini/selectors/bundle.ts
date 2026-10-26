/**
 * Packaged Gemini locators come from the same fragments the online publisher reads.
 * `selector-data/turn.json` keeps its original lists. The adapter `catalog/sites/gemini/site.json`
 * carries `turn.userWithHosts`/`turn.assistantWithHosts` joined into one string, and
 * `sites/adapters/gemini.parity.test.ts` binds the two; never hand an owner that depends on order
 * the adapter's joined string instead.
 *
 * The turn keys differ on purpose. Each keeps the entries and order its owners used before the
 * lists were merged. Among turn owners, order is behavior in two places:
 * - timeline detection takes the first selector that matches and stores that single string;
 * - highlight concatenates matches selector by selector without re-sorting them.
 * Other owners join their list into one query or CSS rule, or only check that something matches
 * (export's readiness wait), so order does not change what they find. An online patch replaces
 * a list whole, in its own order, and never merges entries.
 */
import modelPickerProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/model-picker.json';
import sidebarProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar.json';
import turnProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/turn.json';

import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from './modelPickerKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from './sidebarKeys';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorProfileKey,
  type GeminiSelectorProfiles,
  type GeminiSelectorView,
  type GeminiTurnView,
} from './types';
import { readGeminiSelectorFile, readGeminiSelectorProfileGroup } from './validation';

function readGroup<Key extends GeminiSelectorProfileKey>(
  value: unknown,
  keys: readonly Key[],
  name: string,
): Readonly<Record<Key, readonly string[]>> {
  const profiles = readGeminiSelectorProfileGroup(value, keys);
  if (!profiles) throw new Error(`Invalid bundled Gemini ${name} profiles`);
  return profiles;
}

function readBundle(): GeminiSelectorProfiles {
  const profiles = {
    ...readGroup(turnProfiles, GEMINI_TURN_PROFILE_KEYS, 'turn'),
    ...readGroup(sidebarProfiles, GEMINI_SIDEBAR_PROFILE_KEYS, 'sidebar'),
    ...readGroup(modelPickerProfiles, GEMINI_MODEL_PICKER_PROFILE_KEYS, 'model picker'),
  };
  const file = readGeminiSelectorFile(
    {
      format: 2,
      site: 'gemini',
      host: 'gemini.google.com',
      catalogRevision: 1,
      selectors: profiles,
    },
    'gemini.google.com',
  );
  if (!file) throw new Error('Combined bundled Gemini profiles exceed the shared contract');
  return file.selectors as GeminiSelectorProfiles;
}

const BUNDLED_VIEW: GeminiSelectorView = Object.freeze({
  profiles: readBundle(),
  remoteKeys: new Set<never>(),
  revision: null,
});

export function getBundledGeminiSelectorView(): GeminiSelectorView {
  return BUNDLED_VIEW;
}

export function getBundledGeminiTurnView(): GeminiTurnView {
  return BUNDLED_VIEW;
}

export function getGeminiBundledRevision(): number {
  const value = Number(import.meta.env.VOYAGER_CATALOG_REVISION);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
