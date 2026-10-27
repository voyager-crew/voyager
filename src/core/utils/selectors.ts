/**
 * DOM selector utilities
 * Centralized selectors (was duplicated in multiple files)
 */
import type { GeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';

/**
 * Gemini user-turn selectors, including Angular hosts, from the effective or explicit view.
 */
export function getUserTurnSelectors(view?: GeminiTurnView): string[] {
  return getGeminiTurnSelectors('turn.userWithHosts', view);
}

/**
 * Gemini assistant-turn selectors, including bare response hosts and the list-item fallback.
 */
export function getAssistantTurnSelectors(view?: GeminiTurnView): string[] {
  return getGeminiTurnSelectors('turn.assistantWithHosts', view);
}

/**
 * Build combined selector string
 */
export function combineSelectors(selectors: string[]): string {
  return selectors.join(', ');
}
