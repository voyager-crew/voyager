import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { AppLanguage } from '@/utils/language';
import type { Translation } from '@/utils/translations';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

function registeredListener(): Listener {
  const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
  return calls[calls.length - 1][0] as Listener;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function delayedLanguages() {
  const translations = await import('@/utils/translations');
  const english = translations.getLoadedTranslations('en');
  if (!english) throw new Error('English translations must be eager');
  const loaded = new Map<AppLanguage, Translation>([['en', english]]);
  const japanese = Promise.withResolvers<Translation>();
  const french = Promise.withResolvers<Translation>();
  vi.spyOn(translations, 'getLoadedTranslations').mockImplementation((language) =>
    loaded.get(language),
  );
  vi.spyOn(translations, 'loadTranslations').mockImplementation((language) =>
    language === 'ja' ? japanese.promise : french.promise,
  );
  return { english, loaded, japanese, french };
}

describe('export locale loading', () => {
  it('loads English plus only the selected language, including primitive strings', async () => {
    const { createExportTranslator, loadExportDictionaries } = await import('../exportLocale');
    const dict = await loadExportDictionaries('fr');

    expect(Object.keys(dict).sort()).toEqual(['en', 'fr']);
    expect(createExportTranslator(dict, 'fr')('pm_export')).toBe('Exporter');
    expect(createExportTranslator(dict, 'fr')('quoteReplyAction')).toBe('Citer');
  });

  it('populates the selected dictionary before notifying labels to relabel', async () => {
    const { english, loaded, japanese } = await delayedLanguages();
    const { createExportTranslator, loadExportDictionaries, watchExportLanguage } =
      await import('../exportLocale');
    const dict = await loadExportDictionaries('en');
    const onChange = vi.fn((language: AppLanguage) =>
      createExportTranslator(dict, language)('pm_export'),
    );
    const stop = watchExportLanguage(onChange);
    registeredListener()({ [StorageKeys.LANGUAGE]: { newValue: 'ja' } }, 'sync');
    expect(onChange).not.toHaveBeenCalled();

    const next = { ...english, pm_export: 'Japanese export' };
    loaded.set('ja', next);
    japanese.resolve(next);
    await vi.waitFor(() => expect(onChange).toHaveReturnedWith('Japanese export'));
    expect(Object.keys(dict).sort()).toEqual(['en', 'ja']);
    stop();
  });

  it('does not let an older language request relabel over the latest selection', async () => {
    const { english, loaded, japanese, french } = await delayedLanguages();
    const { watchExportLanguage } = await import('../exportLocale');
    const onChange = vi.fn();
    const stop = watchExportLanguage(onChange);
    const listener = registeredListener();
    listener({ [StorageKeys.LANGUAGE]: { newValue: 'ja' } }, 'sync');
    listener({ [StorageKeys.LANGUAGE]: { newValue: 'fr' } }, 'sync');

    const newest = { ...english, pm_export: 'French export' };
    loaded.set('fr', newest);
    french.resolve(newest);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('fr'));
    const oldest = { ...english, pm_export: 'Japanese export' };
    loaded.set('ja', oldest);
    japanese.resolve(oldest);
    await japanese.promise;

    expect(onChange.mock.calls).toEqual([['fr']]);
    stop();
  });

  it('does not notify an unmounted export entry after its language chunk loads', async () => {
    const { english, loaded, japanese } = await delayedLanguages();
    const { watchExportLanguage } = await import('../exportLocale');
    const onChange = vi.fn();
    const stop = watchExportLanguage(onChange);
    registeredListener()({ [StorageKeys.LANGUAGE]: { newValue: 'ja' } }, 'sync');
    stop();

    loaded.set('ja', english);
    japanese.resolve(english);
    await japanese.promise;

    expect(onChange).not.toHaveBeenCalled();
  });
});
