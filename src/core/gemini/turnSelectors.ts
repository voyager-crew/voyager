/**
 * Gemini turn selectors. The five ordered `turn.*` profiles live in `selector-data/turn.json`
 * (see `selectors/bundle.ts`); query consumers read the effective page snapshot and draft
 * deletion explicitly reads the bundle. Chat width keeps its separate packaged CSS order.
 */
import widthProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/chat-width-packaged.json';

import { getBundledGeminiTurnView, getGeminiTurnView } from './selectors';
import type { GeminiTurnView } from './selectors';

const viewProfiles = getBundledGeminiTurnView().profiles;
const BUNDLED_PROFILES = {
  'turn.user': viewProfiles['turn.user'],
  'turn.userWithHosts': viewProfiles['turn.userWithHosts'],
  'turn.assistant': viewProfiles['turn.assistant'],
  'turn.assistantFallback': viewProfiles['turn.assistantFallback'],
  'turn.assistantWithHosts': viewProfiles['turn.assistantWithHosts'],
} as const;

// Widths come from the packaged bundle only: an online patch never reaches CSS text.
const BUNDLED_GEMINI_TURN_SELECTORS = {
  ...BUNDLED_PROFILES,
  // Width CSS keeps host-first order and excludes fit-content bubbles, data-turn articles and list items.
  ...widthProfiles,
} as const satisfies Record<string, readonly string[]>;

export type GeminiTurnSelectorKey = keyof typeof BUNDLED_GEMINI_TURN_SELECTORS;

/** Query-time effective selectors; ordered lists are copied, never merged item by item. */
export function getGeminiTurnSelectors(
  key: GeminiTurnSelectorKey,
  view: GeminiTurnView = getGeminiTurnView(),
): string[] {
  if (key === 'chatWidth.userTurn' || key === 'chatWidth.assistantTurn') {
    return [...BUNDLED_GEMINI_TURN_SELECTORS[key]];
  }
  return [...view.profiles[key]];
}

/** Draft deletion needs independent packaged send evidence, never a remote match. */
export function getBundledGeminiTurnSelectors(key: GeminiTurnSelectorKey): string[] {
  return getGeminiTurnSelectors(key, getBundledGeminiTurnView());
}

/**
 * Where timeline observes once it has detected a user-turn selector.
 * - `conversation`: the Angular bubbles and hosts. Gemini wraps each turn in its own container, so
 *   the first turn's parent never holds the next one and the whole conversation must be watched.
 * - `parent`: attribute-based variants render turns as siblings under one parent.
 */
export type GeminiUserTurnObserverScope = 'conversation' | 'parent';

export function getGeminiUserTurnObserverScope(selector: string): GeminiUserTurnObserverScope {
  // Every Angular bubble and host names `user-query`; the attribute variants never do. The same
  // rule covers unbundled selectors, such as an Auto cache an older version wrote.
  return /user-query/i.test(selector) ? 'conversation' : 'parent';
}
