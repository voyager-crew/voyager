/**
 * Which Gemini model Create mode will talk to, read without opening a menu.
 * Measured on gemini.google.com: Flash ignored the create page, invented a
 * plugin format and then said it only generates text, so the panel warns
 * before the user writes. The model names live in Gemini's site folder
 * (`catalog/sites/gemini/create-mode.json`), the one place to update them.
 *
 * Each fact comes from the first source that has it:
 * 1. the model button, as the default-model feature reads it: its first line
 *    is the model, a second line the thinking level (Gemini shows none at its
 *    default level);
 * 2. the default model and thinking level, while that feature applies them
 *    to new chats on this page; a stored thinking level only for the model it
 *    was stored with;
 * 3. nothing: no warning.
 */
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import createModeData from '@/features/plugins/catalog/sites/gemini/create-mode.json';
import type { CreateModelWarning } from '@/features/plugins/local/creation/messages';

import { readModelTrigger } from '../defaultModel/modelPickerOperations';
import type { DefaultModelPreferences } from '../defaultModel/preferences';
import { appliedDefaultModel } from '../defaultModel/runtime';

interface CreateModeModels {
  readonly weakModels: readonly string[];
  readonly suggestedModel: string;
}

function parseModels(value: unknown): CreateModeModels {
  const data = value as Partial<Record<keyof CreateModeModels, unknown>>;
  const weak = Array.isArray(data.weakModels) ? data.weakModels : [];
  return {
    weakModels: weak.filter((name): name is string => typeof name === 'string' && name !== ''),
    suggestedModel: typeof data.suggestedModel === 'string' ? data.suggestedModel : '',
  };
}

export const GEMINI_CREATE_MODELS = parseModels(createModeData);

export interface ModelFacts {
  readonly model: string | null;
  readonly thinking: string | null;
}

/** Whole words, any case: "Flash" covers the button's "Flash" and the menu's "3.8 Flash". */
export function isWeakModel(label: string, weak = GEMINI_CREATE_MODELS.weakModels): boolean {
  return weak.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(label);
  });
}

function shownLines(): string[] {
  try {
    return readModelTrigger(getGeminiSelectorView()).value.lines;
  } catch {
    return [];
  }
}

export function readModelFacts(
  lines: readonly string[] = shownLines(),
  defaults: DefaultModelPreferences | null = appliedDefaultModel(),
): ModelFacts {
  const [shown, ...rest] = lines;
  const stored = defaults?.model ?? null;
  const model = shown ?? (stored ? (stored.pill ?? stored.name) : null);
  const shownThinking = rest.join(' ').trim() || null;
  const storedThinking =
    defaults?.thinking && stored && model && defaults.modelMatchesLines(stored, [model])
      ? defaults.thinking.label
      : null;
  return { model, thinking: shownThinking ?? storedThinking };
}

export function geminiModelWarning(facts: ModelFacts): CreateModelWarning | null {
  const { suggestedModel } = GEMINI_CREATE_MODELS;
  if (!facts.model || !suggestedModel || !isWeakModel(facts.model)) return null;
  return { model: facts.model, thinking: facts.thinking, suggested: suggestedModel };
}

/** The reader for `siteId`; null on a site whose models Voyager does not know. */
export function createModelWarningReader(siteId: string): (() => CreateModelWarning | null) | null {
  return siteId === 'gemini' ? () => geminiModelWarning(readModelFacts()) : null;
}
