import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { setCachedLanguage } from '@/utils/i18n';

import { createPromptI18n } from '../promptI18n';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test-extension' },
    storage: { sync: { set: vi.fn() }, local: { set: vi.fn() } },
  },
}));

vi.mock('@/utils/i18n', () => ({
  getCurrentLanguage: vi.fn(async () => 'en'),
  getTranslationSync: vi.fn((key: string) => key),
  setCachedLanguage: vi.fn(async () => true),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setCachedLanguage).mockResolvedValue(true);
  vi.mocked(browser.storage.sync.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('prompt manager language preference', () => {
  it('saves a successfully applied language to sync storage', async () => {
    await createPromptI18n().set('ja');

    expect(browser.storage.sync.set).toHaveBeenCalledWith({ [StorageKeys.LANGUAGE]: 'ja' });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not save a selection superseded by a newer language', async () => {
    vi.mocked(setCachedLanguage).mockResolvedValueOnce(false);

    await createPromptI18n().set('ja');

    expect(browser.storage.sync.set).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not turn a failed language load into a local preference', async () => {
    vi.mocked(setCachedLanguage).mockRejectedValueOnce(new Error('locale chunk unavailable'));

    await createPromptI18n().set('ja');

    expect(browser.storage.sync.set).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('retains the local fallback when saving an applied language to sync fails', async () => {
    vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error('sync unavailable'));

    await createPromptI18n().set('ja');

    expect(browser.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.LANGUAGE]: 'ja' });
  });
});
