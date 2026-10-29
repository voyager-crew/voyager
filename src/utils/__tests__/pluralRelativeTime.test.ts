import { describe, expect, it } from 'vitest';

import { formatRelativeTime, getPluralTranslation } from '@/utils/translations';

describe('plural translations in the Voyager language', () => {
  const russian = {
    count_one: '{count} функция',
    count_few: '{count} функции',
    count_many: '{count} функций',
    count_other: '{count} функции',
  };

  it.each([
    [1, '1 функция'],
    [3, '3 функции'],
    [5, '5 функций'],
    [21, '21 функция'],
  ])('uses the Russian plural form for %i', (count, expected) => {
    expect(
      getPluralTranslation({ language: 'ru', key: 'count', count, translations: russian }),
    ).toBe(expected);
  });

  it.each([
    [1, '1 feature'],
    [2, '2 features'],
  ])('uses the English plural form for %i', (count, expected) => {
    expect(
      getPluralTranslation({
        language: 'en',
        key: 'count',
        count,
        translations: { count_one: '{count} feature', count_other: '{count} features' },
      }),
    ).toBe(expected);
  });

  it('falls back to the other key when a selected form is absent', () => {
    expect(
      getPluralTranslation({
        language: 'ru',
        key: 'count',
        count: 3,
        translations: { count_other: '{count} всего' },
      }),
    ).toBe('3 всего');
  });

  it('maps Arabic zero and two to other', () => {
    for (const count of [0, 2]) {
      expect(
        getPluralTranslation({
          language: 'ar',
          key: 'count',
          count,
          translations: { count_one: 'عنصر', count_other: 'عناصر' },
        }),
      ).toBe('عناصر');
    }
  });
});

describe('relative time in the Voyager language', () => {
  it('uses the requested language rather than the browser locale', () => {
    expect(formatRelativeTime('en', -12, 'minute')).toBe('12 minutes ago');
    expect(formatRelativeTime('ru', -12, 'minute')).toBe('12 минут назад');
    expect(formatRelativeTime('en', 1, 'day', { numeric: 'auto' })).toBe('tomorrow');
    expect(formatRelativeTime('ru', 1, 'day', { numeric: 'auto' })).toBe('завтра');
  });

  it('accepts Voyager’s Traditional Chinese language setting', () => {
    expect(formatRelativeTime('zh_TW', -12, 'minute')).toBe('12 分鐘前');
  });
});
