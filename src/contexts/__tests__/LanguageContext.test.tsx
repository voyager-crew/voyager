import React, { act, useLayoutEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';
import { setCachedLanguage } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';
import { getLoadedTranslations, loadTranslations } from '@/utils/translations';

import { LanguageProvider, useLanguage } from '../LanguageContext';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('en');
  vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('renders only ready translations for the saved language, selections and storage changes', async () => {
  let resolvePreference!: (value: Record<string, unknown>) => void;
  const preference = new Promise<Record<string, unknown>>((resolve) => {
    resolvePreference = resolve;
  });
  vi.mocked(browser.storage.sync.get).mockReturnValue(preference);
  const listeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  const renders: Array<{ language: AppLanguage; text: string }> = [];
  let context: ReturnType<typeof useLanguage> | undefined;
  function Probe() {
    const value = useLanguage();
    const text = value.t('pm_delete');
    useLayoutEffect(() => {
      context = value;
      renders.push({ language: value.language, text });
    });
    return <output lang={value.language}>{text}</output>;
  }

  expect(getLoadedTranslations('ja')).toBeUndefined();
  const preparedLanguage = prepareExtensionPageLanguage();
  expect(renders).toEqual([]);
  expect(container.textContent).toBe('');

  await act(async () => {
    resolvePreference({ [StorageKeys.LANGUAGE]: 'ja' });
    const initialLanguage = await preparedLanguage;
    root.render(
      <LanguageProvider initialLanguage={initialLanguage}>
        <Probe />
      </LanguageProvider>,
    );
  });
  expect(container.textContent).toBe('削除');
  expect(renders.every(({ language, text }) => language === 'ja' && text === '削除')).toBe(true);

  expect(getLoadedTranslations('fr')).toBeUndefined();
  let selection!: Promise<void>;
  act(() => {
    if (!context) throw new Error('The saved language did not mount the consumer');
    selection = context.setLanguage('fr');
  });
  expect(selection).toBeInstanceOf(Promise);
  expect(container.textContent).toBe('削除');
  await act(async () => {
    await selection;
  });
  expect(container.textContent).toBe('Supprimer');
  expect(chrome.storage.sync.set).toHaveBeenCalledWith({ [StorageKeys.LANGUAGE]: 'fr' });

  expect(getLoadedTranslations('ar')).toBeUndefined();
  act(() => {
    for (const listener of listeners) {
      listener({ [StorageKeys.LANGUAGE]: { oldValue: 'fr', newValue: 'ar' } }, 'sync');
    }
  });
  expect(container.textContent).toBe('Supprimer');
  await act(async () => {
    await loadTranslations('ar');
  });
  expect(container.textContent).toBe('حذف');
  // Another consumer may apply the global language before its storage event arrives.
  await act(async () => {
    await setCachedLanguage('ja');
    for (const listener of listeners) {
      listener({ [StorageKeys.LANGUAGE]: { oldValue: 'ar', newValue: 'ja' } }, 'sync');
    }
  });
  expect(container.textContent).toBe('削除');
  expect(new Set(renders.map(({ language, text }) => `${language}:${text}`))).toEqual(
    new Set(['ja:削除', 'fr:Supprimer', 'ar:حذف']),
  );
});
