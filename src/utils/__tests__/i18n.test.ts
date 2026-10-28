import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { getCurrentLanguage, getTranslation } from '../i18n';

vi.mock('webextension-polyfill', () => {
  const storageArea = { get: vi.fn(), set: vi.fn() };
  return {
    default: {
      storage: {
        sync: storageArea,
        local: { get: vi.fn(), set: vi.fn() },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      i18n: { getUILanguage: vi.fn() },
    },
  };
});

describe('getCurrentLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses sync storage when available', async () => {
    const syncGet = browser.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const localGet = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const uiLang = browser.i18n.getUILanguage as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockResolvedValue({ language: 'zh' });
    localGet.mockResolvedValue({});
    uiLang.mockReturnValue('en-US');

    const lang = await getCurrentLanguage();

    expect(lang).toBe('zh');
  });

  it('falls back to local storage when sync is missing', async () => {
    const syncGet = browser.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const localGet = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const uiLang = browser.i18n.getUILanguage as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockResolvedValue({});
    localGet.mockResolvedValue({ language: 'es' });
    uiLang.mockReturnValue('en-US');

    const lang = await getCurrentLanguage();

    expect(lang).toBe('es');
  });

  it('falls back to chrome storage when browser storage throws', async () => {
    const syncGet = browser.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const localGet = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const uiLang = browser.i18n.getUILanguage as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockRejectedValue(new Error('sync failed'));
    localGet.mockRejectedValue(new Error('local failed'));
    uiLang.mockReturnValue('en-US');

    const chromeStorageGet = chrome.storage.sync.get as unknown as {
      mockImplementation: (fn: (key: string, callback: (result: unknown) => void) => void) => void;
    };
    chromeStorageGet.mockImplementation((key: string, callback: (result: unknown) => void) => {
      callback({ language: 'ja' });
    });

    const lang = await getCurrentLanguage();

    expect(lang).toBe('ja');
  });

  it('falls back to browser UI language when no storage value exists', async () => {
    const syncGet = browser.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const localGet = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const uiLang = browser.i18n.getUILanguage as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockResolvedValue({});
    localGet.mockResolvedValue({});
    uiLang.mockReturnValue('fr-FR');

    const lang = await getCurrentLanguage();

    expect(lang).toBe('fr');
  });

  it('translates response completion notifications using the saved app language', async () => {
    const syncGet = browser.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const localGet = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const uiLang = browser.i18n.getUILanguage as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockResolvedValue({ language: 'zh' });
    localGet.mockResolvedValue({});
    uiLang.mockReturnValue('en-US');

    await expect(getTranslation('responseCompleteNotificationMessage')).resolves.toBe(
      '{site} 思考完成',
    );
  });
});

describe('lazy language changes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses English until the selected language is loaded, then serves it synchronously', async () => {
    const { getTranslationSync, setCachedLanguage } = await import('../i18n');
    const { getLoadedTranslations } = await import('../translations');
    expect(getLoadedTranslations('ja')).toBeUndefined();
    const change = setCachedLanguage('ja');
    expect(getTranslationSync('commonClose')).toBe('Close');
    await change;
    expect(getTranslationSync('commonClose')).toBe('閉じる');
  });

  it('does not apply an older language when its chunk arrives after a newer selection', async () => {
    const { getCachedLocale, getTranslationSync, setCachedLanguage } = await import('../i18n');
    const previous = setCachedLanguage('ja');
    await setCachedLanguage('en');
    expect(await previous).toBe(false);
    // Await the real chunk as well, so a late application would be visible.
    const { loadTranslations } = await import('../translations');
    await loadTranslations('ja');
    expect(getCachedLocale()).toBe('en');
    expect(getTranslationSync('commonClose')).toBe('Close');
  });

  it('loads the saved language before initialization and storage notifications complete', async () => {
    const { default: currentBrowser } = await import('webextension-polyfill');
    vi.mocked(currentBrowser.storage.sync.get).mockResolvedValue({ language: 'ja' });
    const { getTranslationSync, initI18n, onCachedLanguageChange } = await import('../i18n');
    await initI18n();
    expect(getTranslationSync('commonClose')).toBe('閉じる');
    const seen: string[] = [];
    const stop = onCachedLanguageChange(() => seen.push(getTranslationSync('commonClose')));
    const listener = vi.mocked(currentBrowser.storage.onChanged.addListener).mock.calls[0][0];
    listener({ language: { newValue: 'zh' } }, 'sync');
    expect(getTranslationSync('commonClose')).toBe('閉じる');
    await vi.waitFor(() => expect(seen).toEqual(['关闭']));
    stop();
  });

  it('starts in English when the saved language chunk fails to load', async () => {
    const { default: currentBrowser } = await import('webextension-polyfill');
    vi.mocked(currentBrowser.storage.sync.get).mockResolvedValue({ language: 'ja' });
    vi.doMock('../translations', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../translations')>()),
      loadTranslations: () => Promise.reject(new Error('chunk failed')),
    }));
    try {
      const { getTranslationSync, initI18n } = await import('../i18n');
      await expect(initI18n()).resolves.toBeUndefined();
      expect(getTranslationSync('commonClose')).toBe('Close');
    } finally {
      vi.doUnmock('../translations');
    }
  });

  it('does not let a pending startup preference overwrite a later selection', async () => {
    const { default: currentBrowser } = await import('webextension-polyfill');
    let finishRead!: (value: { language: string }) => void;
    vi.mocked(currentBrowser.storage.sync.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const { getTranslationSync, initI18n, setCachedLanguage } = await import('../i18n');
    const starting = initI18n();
    await setCachedLanguage('en');
    finishRead({ language: 'ja' });
    await starting;
    expect(getTranslationSync('commonClose')).toBe('Close');
  });

  it('cancels a pending selection when storage switches back to the current language', async () => {
    const { default: currentBrowser } = await import('webextension-polyfill');
    vi.mocked(currentBrowser.storage.sync.get).mockResolvedValue({ language: 'en' });
    const { getTranslationSync, initI18n, setCachedLanguage } = await import('../i18n');
    await initI18n();
    const selection = setCachedLanguage('fr');
    const listener = vi.mocked(currentBrowser.storage.onChanged.addListener).mock.calls[0][0];
    listener({ language: { oldValue: 'ja', newValue: 'en' } }, 'sync');
    expect(await selection).toBe(false);
    const { loadTranslations } = await import('../translations');
    await loadTranslations('fr');
    expect(getTranslationSync('commonClose')).toBe('Close');
  });
});
