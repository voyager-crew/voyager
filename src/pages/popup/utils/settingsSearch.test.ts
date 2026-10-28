import { afterEach, describe, expect, it, vi } from 'vitest';

import * as translations from '@/utils/translations';

import {
  getSettingsSearchMatches,
  matchesFuzzySearch,
  normalizePersistedSettingsSearchQuery,
} from './settingsSearch';

describe('settings search', () => {
  afterEach(() => vi.restoreAllMocks());

  it('restores only the last persisted query string', () => {
    expect(normalizePersistedSettingsSearchQuery('timeline')).toBe('timeline');
    expect(normalizePersistedSettingsSearchQuery(['timeline'])).toBe('');
    expect(normalizePersistedSettingsSearchQuery(undefined)).toBe('');
  });

  it('keeps every item for an empty query without loading search languages', async () => {
    const loadAll = vi.spyOn(translations, 'loadAllTranslations');
    const matches = await getSettingsSearchMatches(
      [{ id: 'general', keys: ['generalOptions'] }],
      '   ',
    );

    expect([...matches]).toEqual(['general']);
    expect(loadAll).not.toHaveBeenCalled();
  });

  it('matches section text across bundled languages', async () => {
    const matches = await getSettingsSearchMatches(
      [{ id: 'general', keys: ['responseCompleteNotification'] }],
      '思考完成',
    );

    expect(matches.has('general')).toBe(true);
  });

  it('matches small typos in feature names', () => {
    expect(matchesFuzzySearch('Response completion notifications', 'notifcation')).toBe(true);
  });

  it('matches nearby user wording through section aliases', async () => {
    const matches = await getSettingsSearchMatches(
      [
        {
          id: 'general',
          keys: ['generalOptions'],
          aliases: ['alert reminder notice 提醒 推送'],
        },
      ],
      '提醒',
    );

    expect(matches.has('general')).toBe(true);
  });

  it('does not match short CJK fragments inside the query', () => {
    expect(matchesFuzzySearch('输入选项 用 i Escape 切换模式', '用量')).toBe(false);
    expect(matchesFuzzySearch('Gemini 用量限额', '用量')).toBe(true);
  });

  it('keeps matches at option granularity inside the same section', async () => {
    const matches = await getSettingsSearchMatches(
      [
        { id: 'general:section', keys: ['generalOptions'] },
        { id: 'general:usage', keys: ['usageStatusToggle', 'usageStatusToggleHint'] },
        {
          id: 'general:notification',
          keys: ['responseCompleteNotification', 'responseCompleteNotificationHint'],
        },
      ],
      '用量',
    );

    expect(matches.has('general:usage')).toBe(true);
    expect(matches.has('general:notification')).toBe(false);
    expect(matches.has('general:section')).toBe(false);
  });

  it('finds the slash prompt toggle through its localized copy', async () => {
    const matches = await getSettingsSearchMatches(
      [
        {
          id: 'promptManager:slashPromptEnabled',
          keys: ['slashPromptEnabled', 'slashPromptEnabledHint'],
        },
      ],
      '斜杠',
    );

    expect(matches.has('promptManager:slashPromptEnabled')).toBe(true);
  });

  it('finds the changelog badge preference through update wording', async () => {
    const matches = await getSettingsSearchMatches(
      [
        {
          id: 'general:changelogBadgeMode',
          keys: ['changelog_badge_mode', 'changelog_badge_mode_hint'],
        },
      ],
      '更新日志',
    );

    expect(matches.has('general:changelogBadgeMode')).toBe(true);
  });

  it('does not match unrelated words', async () => {
    const matches = await getSettingsSearchMatches(
      [{ id: 'general', keys: ['responseCompleteNotification'] }],
      'watermark',
    );

    expect(matches.size).toBe(0);
  });
});
