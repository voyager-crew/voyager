import { describe, expect, it } from 'vitest';

import { getGeminiTurnSelectors, getGeminiUserTurnObserverScope } from '../turnSelectors';

const USER_KEYS = ['turn.user', 'turn.userWithHosts', 'chatWidth.userTurn'] as const;

describe('Gemini turn selectors', () => {
  it('hands out a copy that callers can change', () => {
    const first = getGeminiTurnSelectors('turn.user');
    first.unshift('.gv-test-override');
    expect(getGeminiTurnSelectors('turn.user')).not.toContain('.gv-test-override');
  });

  it('gives every bundled selector valid syntax', () => {
    const keys = [
      ...USER_KEYS,
      'turn.assistant',
      'turn.assistantFallback',
      'turn.assistantWithHosts',
      'chatWidth.assistantTurn',
    ] as const;
    for (const key of keys) {
      for (const selector of getGeminiTurnSelectors(key)) {
        expect(() => document.querySelector(selector)).not.toThrow();
      }
    }
  });

  it('watches the whole conversation for Angular turns and the parent for attribute turns', () => {
    for (const selector of [
      '.user-query-bubble-container',
      '.user-query-container',
      'user-query',
    ]) {
      expect(getGeminiUserTurnObserverScope(selector)).toBe('conversation');
    }
    for (const selector of ['div[aria-label="User message"]', 'article[data-turn="user"]']) {
      expect(getGeminiUserTurnObserverScope(selector)).toBe('parent');
    }
  });

  it('keeps chat width off the user bubble and list items it has never widened', () => {
    const widths = [
      ...getGeminiTurnSelectors('chatWidth.userTurn'),
      ...getGeminiTurnSelectors('chatWidth.assistantTurn'),
    ];
    expect(widths).toContain('.user-query-container');
    expect(widths).toContain('.presented-response-container');
    expect(widths.filter((selector) => /bubble-with-background|listitem/.test(selector))).toEqual(
      [],
    );
  });

  it('keeps the legacy name test for selectors Voyager does not bundle', () => {
    expect(getGeminiUserTurnObserverScope('USER-QUERY.legacy')).toBe('conversation');
    expect(getGeminiUserTurnObserverScope('.gv-test-custom-turn')).toBe('parent');
    expect(getGeminiUserTurnObserverScope('')).toBe('parent');
  });
});
