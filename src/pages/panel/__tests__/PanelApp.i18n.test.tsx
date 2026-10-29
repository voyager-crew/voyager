import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { AppLanguage } from '@/utils/language';
import { loadTranslations } from '@/utils/translations';

import { featuresOnLabel } from '../panelText';
import {
  GEMINI,
  click,
  container,
  en,
  flush,
  mount,
  query,
  tab,
  writeElsewhere,
} from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

type MessageFile = Record<string, { message: string }>;
const fragments = import.meta.glob<MessageFile>('../messages/*.json', {
  eager: true,
  import: 'default',
});
const LOCALES: readonly AppLanguage[] = [
  'en',
  'ar',
  'es',
  'fr',
  'ja',
  'ko',
  'pt',
  'ru',
  'zh',
  'zh_TW',
];
const own = (locale: AppLanguage, key: string) =>
  fragments[`../messages/${locale}.json`][key].message;

/** Every string the open panel shows or announces. */
function shownStrings(): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) texts.push(node.textContent.trim());
  }
  for (const element of container.querySelectorAll('*')) {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(name);
      if (value) texts.push(value);
    }
  }
  return texts;
}

describe('panel copy', () => {
  it.each(LOCALES)('renders in %s from its own messages, with no raw key', async (locale) => {
    await mount(GEMINI, locale);
    const keys = new Set(Object.keys(en));

    expect(tab('features').textContent).toBe(own(locale, 'panelTabFeatures'));
    expect(tab('sites').textContent).toBe(own(locale, 'panelTabSites'));
    expect(query('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      own(locale, 'panelTabsLabel'),
    );
    expect(query('.search input')?.getAttribute('placeholder')).toBe(own(locale, 'panelSearch'));
    expect(query('[data-group="entry"] .gl')?.textContent).toBe(own(locale, 'panelEntryGroup'));
    expect(query('[data-row] .rn')?.textContent).toBe(own(locale, 'panelFloatingButton'));
    expect(query('.kbd')?.getAttribute('title')).toBe(own(locale, 'panelShortcutHint'));
    expect(
      Array.from(container.querySelectorAll('.ib')).some(
        (button) => button.getAttribute('aria-label') === own(locale, 'panelFullSettings'),
      ),
    ).toBe(true);
    expect(shownStrings().filter((text) => keys.has(text))).toEqual([]);

    await click(tab('sites'));
    const groups = Array.from(container.querySelectorAll('.gl'), (label) => label.textContent);
    expect(groups[0]).toBe(own(locale, 'panelSupportedSites'));
    expect(groups[1]).not.toContain('{websites}');
    expect(container.textContent).toContain(own(locale, 'panelNotEnabled'));
    expect(shownStrings().filter((text) => keys.has(text) || /\{\w+\}/.test(text))).toEqual([]);
  });

  it('follows a change of Voyager language while open', async () => {
    const zh = await loadTranslations('zh');
    await mount(GEMINI, 'en');
    expect(tab('features').textContent).toBe(en.panelTabFeatures);

    await writeElsewhere('sync', { [StorageKeys.LANGUAGE]: 'zh' });
    await vi.waitFor(async () => {
      await act(flush);
      expect(tab('features').textContent).toBe(zh.panelTabFeatures);
    });
    expect(query('[data-row] .rn')?.textContent).toBe(zh.panelFloatingButton);
  });
});

describe('counts', () => {
  it.each([
    [1, 'Включена 1 функция'],
    [3, 'Включены 3 функции'],
    [5, 'Включено 5 функций'],
    [21, 'Включена 21 функция'],
  ])('ru picks its form for %i', async (count, text) => {
    await loadTranslations('ru');
    expect(featuresOnLabel('ru', count)).toBe(text);
  });

  it.each([
    [1, '1 on'],
    [2, '2 on'],
  ])('en reads %i as "%s"', (count, text) => {
    expect(featuresOnLabel('en', count)).toBe(text);
  });
});
