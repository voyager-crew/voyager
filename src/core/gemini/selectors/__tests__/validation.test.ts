import { describe, expect, it } from 'vitest';

import { readGeminiSelectorFile } from '../validation';

function file(selectors: unknown): Record<string, unknown> {
  return {
    format: 1,
    site: 'gemini',
    host: 'gemini.google.com',
    catalogRevision: 20,
    selectors,
  };
}

describe('Gemini selector file validation', () => {
  it('preserves list order and accepts an empty withdrawal patch', () => {
    expect(
      readGeminiSelectorFile(file({ 'turn.user': ['.second', '.first'] }), 'gemini.google.com')
        ?.selectors['turn.user'],
    ).toEqual(['.second', '.first']);
    expect(readGeminiSelectorFile(file({}), 'gemini.google.com')?.selectors).toEqual({});
  });

  it('rejects capabilities, CSS and unknown profile keys instead of carrying them through', () => {
    expect(
      readGeminiSelectorFile({ ...file({}), capabilities: [] }, 'gemini.google.com'),
    ).toBeNull();
    expect(readGeminiSelectorFile({ ...file({}), css: 'body{}' }, 'gemini.google.com')).toBeNull();
    expect(
      readGeminiSelectorFile(file({ 'chatWidth.userTurn': ['.user'] }), 'gemini.google.com'),
    ).toBeNull();
    expect(
      readGeminiSelectorFile(file({ 'turn.future': ['.user'] }), 'gemini.google.com'),
    ).toBeNull();
  });

  it('rejects the wrong host, AI Studio and non-integer revisions', () => {
    expect(readGeminiSelectorFile(file({}), 'business.gemini.google')).toBeNull();
    expect(
      readGeminiSelectorFile({ ...file({}), host: 'aistudio.google.com' }, 'aistudio.google.com'),
    ).toBeNull();
    for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '20']) {
      expect(
        readGeminiSelectorFile({ ...file({}), catalogRevision: revision }, 'gemini.google.com'),
      ).toBeNull();
    }
  });

  it('rejects empty, oversized, non-string and control-character entries', () => {
    for (const value of [
      [],
      [''],
      ['  '],
      [null],
      ['.a\u0000'],
      ['a'.repeat(2049)],
      Array(33).fill('.a'),
    ]) {
      expect(readGeminiSelectorFile(file({ 'turn.user': value }), 'gemini.google.com')).toBeNull();
    }
    expect(readGeminiSelectorFile(file({ 'turn.user': '.a' }), 'gemini.google.com')).toBeNull();
  });

  it('bounds cached UTF-8 bytes as well as individual UTF-16 strings', () => {
    expect(
      readGeminiSelectorFile(
        file({ 'turn.user': Array(32).fill('界'.repeat(2048)) }),
        'gemini.google.com',
      ),
    ).toBeNull();
  });
});
