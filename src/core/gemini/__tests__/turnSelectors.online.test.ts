import { afterEach, describe, expect, it } from 'vitest';

import { initializeGeminiSelectors } from '../selectors';
import { getBundledGeminiTurnSelectors, getGeminiTurnSelectors } from '../turnSelectors';

let stop: (() => void) | undefined;
afterEach(() => stop?.());

describe('online turn profile getter', () => {
  it('reads all five effective lists while keeping draft evidence and width packaged', async () => {
    const initialized = initializeGeminiSelectors({
      host: 'gemini.google.com',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 0,
      read: async () => ({
        id: 'gemini',
        catalogRevision: 1,
        locators: {
          'turn.user': ['.online-user'],
          'turn.userWithHosts': ['.online-user-host'],
          'turn.assistant': ['.online-answer'],
          'turn.assistantFallback': ['.online-answer-fallback'],
          'turn.assistantWithHosts': ['.online-answer-host'],
        },
      }),
    });
    stop = initialized.stop;
    await initialized.ready;
    expect(getGeminiTurnSelectors('turn.user')).toEqual(['.online-user']);
    expect(getGeminiTurnSelectors('turn.userWithHosts')).toEqual(['.online-user-host']);
    expect(getGeminiTurnSelectors('turn.assistant')).toEqual(['.online-answer']);
    expect(getGeminiTurnSelectors('turn.assistantFallback')).toEqual(['.online-answer-fallback']);
    expect(getGeminiTurnSelectors('turn.assistantWithHosts')).toEqual(['.online-answer-host']);
    expect(getBundledGeminiTurnSelectors('turn.userWithHosts')).toContain('user-query');
    expect(getBundledGeminiTurnSelectors('turn.userWithHosts')).not.toContain('.online-user-host');
    // Width rules are CSS text: an online patch must not widen elements the bundle never listed.
    expect(getGeminiTurnSelectors('chatWidth.userTurn')).toContain('user-query');
    expect(getGeminiTurnSelectors('chatWidth.userTurn')).not.toContain('.online-user-host');
    expect(getGeminiTurnSelectors('chatWidth.assistantTurn')).toContain('model-response');
    expect(getGeminiTurnSelectors('chatWidth.assistantTurn')).not.toContain('.online-answer-host');
    const copy = getGeminiTurnSelectors('turn.user');
    copy.push('.caller-only');
    expect(getGeminiTurnSelectors('turn.user')).toEqual(['.online-user']);
  });
});
