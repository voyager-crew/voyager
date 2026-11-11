// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultModelPreferences } from '../../defaultModel/preferences';
import type { DefaultModelSetting, DefaultThinkingLevel } from '../../defaultModel/preferences';
import {
  GEMINI_CREATE_MODELS,
  createModelWarningReader,
  geminiModelWarning,
  isWeakModel,
  readModelFacts,
} from '../geminiModel';

/** Gemini's model button as measured: the model, then a thinking line when not at the default. */
function modelButton(text: string): void {
  document.body.innerHTML =
    '<button class="input-area-switch" aria-label="Open mode picker" gemmenutrigger></button>';
  document.querySelector('button')!.textContent = text;
}

function applied(model: DefaultModelSetting, thinking: DefaultThinkingLevel | null) {
  const preferences = new DefaultModelPreferences();
  vi.spyOn(preferences, 'model', 'get').mockReturnValue(model);
  vi.spyOn(preferences, 'thinking', 'get').mockReturnValue(thinking);
  return preferences;
}

const LOW: DefaultThinkingLevel = { index: 0, label: 'Low', mode: 'standard' };
const readWarning = createModelWarningReader('gemini')!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the Gemini model Create mode warns about', () => {
  it('keeps the names in Gemini’s site data, with a stronger model to suggest', () => {
    expect(GEMINI_CREATE_MODELS.weakModels).toEqual(['Flash', 'Flash-Lite']);
    expect(GEMINI_CREATE_MODELS.suggestedModel).toBe('Argon');
  });

  it.each(['Flash', '3.8 Flash', 'Flash-Lite', '3.5 Flash-Lite', 'flash'])(
    'calls %s weak',
    (label) => expect(isWeakModel(label)).toBe(true),
  );

  it.each(['Argon', '4 Carbon', '3.1 Pro', 'Flashy'])('does not call %s weak', (label) =>
    expect(isWeakModel(label)).toBe(false),
  );

  it('warns about Flash on the model button, without a thinking level it did not show', () => {
    modelButton('Flash');
    expect(readWarning()).toEqual({ model: 'Flash', thinking: null, suggested: 'Argon' });
  });

  it('names the thinking level the button shows', () => {
    modelButton('Flash\nHigh');
    expect(readWarning()).toMatchObject({ model: 'Flash', thinking: 'High' });
  });

  it('says nothing for a stronger model, or a page whose button it cannot read', () => {
    modelButton('Argon');
    expect(readWarning()).toBeNull();
    document.body.innerHTML = '';
    expect(readWarning()).toBeNull();
  });

  it('judges the applied default, the model the new chat will get, over the one shown', () => {
    const flash = applied({ kind: 'id', id: 'f', name: '3.8 Flash', pill: 'Flash' }, LOW);
    expect(geminiModelWarning(readModelFacts(['Argon'], flash))).toMatchObject({
      model: 'Flash',
      thinking: 'Low',
    });
    const argon = applied({ kind: 'id', id: 'a', name: '4 Argon' }, LOW);
    expect(geminiModelWarning(readModelFacts(['Flash'], argon))).toBeNull();
  });

  it('reads the button when no default is applied, and nothing when neither is there', () => {
    expect(readModelFacts(['Flash', 'High'], null)).toEqual({ model: 'Flash', thinking: 'High' });
    expect(readModelFacts([], null)).toEqual({ model: null, thinking: null });
  });

  it('reads no model on a site whose models it does not know', () => {
    expect(createModelWarningReader('chatgpt')).toBeNull();
  });
});
