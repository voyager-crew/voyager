/**
 * The packaged Gemini turn profiles, read from `selector-data/turn.json` (also the published
 * online file, so the two cannot drift). The plugin adapter `catalog/sites/gemini/site.json`
 * carries `turn.userWithHosts`/`turn.assistantWithHosts` joined into one string, and
 * `sites/adapters/gemini.parity.test.ts` binds the two; never hand an owner that depends on order
 * the adapter's joined string instead.
 *
 * The keys differ on purpose. Each one keeps the entries and order its owners used before the
 * lists were merged, because order is behavior in two places:
 * - timeline detection takes the first selector that matches and stores that single string;
 * - highlight concatenates matches selector by selector without re-sorting them.
 * Other owners join their list into one query or CSS rule, or only check that something matches
 * (export's readiness wait), so order does not change what they find. An online patch replaces
 * a list whole, in its own order, and never merges entries.
 */
import turnProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/turn.json';

import { GEMINI_TURN_PROFILE_KEYS, type GeminiTurnProfiles, type GeminiTurnView } from './types';
import { readGeminiSelectorFile } from './validation';

function readBundle(): GeminiTurnProfiles {
  const file = readGeminiSelectorFile(
    {
      format: 1,
      site: 'gemini',
      host: 'gemini.google.com',
      catalogRevision: 1,
      selectors: turnProfiles,
    },
    'gemini.google.com',
  );
  if (!file || GEMINI_TURN_PROFILE_KEYS.some((key) => !file.selectors[key])) {
    throw new Error('Invalid bundled Gemini turn profiles');
  }
  return file.selectors as GeminiTurnProfiles;
}

const BUNDLED_VIEW: GeminiTurnView = Object.freeze({
  profiles: readBundle(),
  remoteKeys: new Set<never>(),
  revision: null,
});

export function getBundledGeminiTurnView(): GeminiTurnView {
  return BUNDLED_VIEW;
}

export function getGeminiBundledRevision(): number {
  const value = Number(import.meta.env.VOYAGER_CATALOG_REVISION);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
