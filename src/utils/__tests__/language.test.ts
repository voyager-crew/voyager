import { describe, expect, it } from 'vitest';

import { APP_LANGUAGES, isAppLanguage, normalizeLanguage } from '@/utils/language';

describe('normalizeLanguage', () => {
  it('normalizes empty values to en', () => {
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage(null)).toBe('en');
  });

  it('normalizes common language codes', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('zh')).toBe('zh');
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage('ja-JP')).toBe('ja');
    expect(normalizeLanguage('ko')).toBe('ko');
    expect(normalizeLanguage('ko-KR')).toBe('ko');
  });

  it('normalizes traditional chinese variants', () => {
    expect(normalizeLanguage('zh-TW')).toBe('zh_TW');
    expect(normalizeLanguage('zh_TW')).toBe('zh_TW');
    expect(normalizeLanguage('zh-HK')).toBe('zh_TW');
    expect(normalizeLanguage('zh-Hant')).toBe('zh_TW');
  });

  it('falls back to en for unknown languages', () => {
    expect(normalizeLanguage('de-DE')).toBe('en');
    expect(normalizeLanguage('it-IT')).toBe('en');
  });
});

describe('isAppLanguage', () => {
  it('accepts exactly supported language tags', () => {
    for (const lang of APP_LANGUAGES) {
      expect(isAppLanguage(lang)).toBe(true);
    }
  });

  it('rejects non-canonical tags', () => {
    expect(isAppLanguage('en-US')).toBe(false);
    expect(isAppLanguage('zh-CN')).toBe(false);
    expect(isAppLanguage('ja-JP')).toBe(false);
    expect(isAppLanguage('')).toBe(false);
  });
});
