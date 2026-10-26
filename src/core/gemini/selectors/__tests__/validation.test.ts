import { describe, expect, it } from 'vitest';

import { readGeminiSelectorProfiles } from '../validation';

describe('Gemini catalog locator validation', () => {
  it('preserves list order and accepts an empty withdrawal', () => {
    expect(
      readGeminiSelectorProfiles({ 'turn.user': ['.second', '.first'] })?.['turn.user'],
    ).toEqual(['.second', '.first']);
    expect(readGeminiSelectorProfiles({})).toEqual({});
  });

  it.each(['capabilities', 'css', 'chatWidth.userTurn', 'turn.future'])(
    'rejects %s while accepting the consumed turn profile',
    (key) => {
      expect(readGeminiSelectorProfiles({ 'turn.user': ['.user'], [key]: ['.ignored'] })).toEqual({
        'turn.user': ['.user'],
      });
    },
  );

  it.each([[], [''], ['  '], [null], ['.a\u0000'], ['a'.repeat(2049)], Array(33).fill('.a'), '.a'])(
    'rejects malformed lists while leaving a valid profile readable: %j',
    (value) => {
      expect(readGeminiSelectorProfiles({ 'turn.user': value })).toBeNull();
      expect(readGeminiSelectorProfiles({ 'turn.user': ['.valid'] })?.['turn.user']).toEqual([
        '.valid',
      ]);
    },
  );

  it('bounds UTF-8 bytes as well as individual UTF-16 strings', () => {
    expect(
      readGeminiSelectorProfiles({ 'turn.user': Array(32).fill('界'.repeat(2048)) }),
    ).toBeNull();
    expect(readGeminiSelectorProfiles({ 'turn.user': ['界'.repeat(2048)] })?.['turn.user']).toEqual(
      ['界'.repeat(2048)],
    );
  });
});
