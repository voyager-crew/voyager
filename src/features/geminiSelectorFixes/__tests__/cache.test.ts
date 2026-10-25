import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { loadSiteOverrideForHost } from '@/features/plugins/remote/siteOverride';

import {
  geminiSelectorCacheKey,
  loadGeminiSelectorSnapshot,
  readCachedGeminiSelectorFile,
} from '../cache';
import { GeminiSelectorRefresher } from '../refresh';
import { HOST, VERSION, cacheEntry, memoryStorage, selectorFile } from './testKit';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Gemini selector cached hydration', () => {
  it('reads consent and cached selectors in one local snapshot', async () => {
    vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
    vi.stubEnv('VOYAGER_GEMINI_SELECTOR_REMOTE', 'on');
    const get = vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: true,
      [geminiSelectorCacheKey(HOST)]: cacheEntry(),
    } as never);
    get.mockClear();
    expect(await loadGeminiSelectorSnapshot(HOST, VERSION)).toEqual({
      enabled: true,
      file: selectorFile(),
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith([
      StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES,
      geminiSelectorCacheKey(HOST),
    ]);
  });

  it('does not hydrate cached remote data without explicit consent', async () => {
    vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
    vi.stubEnv('VOYAGER_GEMINI_SELECTOR_REMOTE', 'on');
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [geminiSelectorCacheKey(HOST)]: cacheEntry(),
    } as never);
    expect(await loadGeminiSelectorSnapshot(HOST, VERSION)).toEqual({ enabled: false, file: null });
  });

  it.each(['VOYAGER_PLUGIN_CATALOG_REMOTE', 'VOYAGER_GEMINI_SELECTOR_REMOTE'])(
    'ignores cache and force when %s is compiled off',
    async (flag) => {
      vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
      vi.stubEnv('VOYAGER_GEMINI_SELECTOR_REMOTE', 'on');
      vi.stubEnv(flag, 'off');
      expect(await loadGeminiSelectorSnapshot(HOST, VERSION)).toEqual({
        enabled: false,
        file: null,
      });
      const fetchImpl = vi.fn<typeof fetch>();
      const owner = new GeminiSelectorRefresher({ storage: memoryStorage().storage, fetchImpl });
      expect(await owner.refresh(HOST, { force: true })).toMatchObject({
        buildEnabled: false,
        result: 'disabled',
        cachedRevision: null,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects another version, another host, invalid timestamps, and remote behavior fields', () => {
    const cached = cacheEntry();
    expect(readCachedGeminiSelectorFile(cached, HOST, 'old-version')).toBeNull();
    expect(readCachedGeminiSelectorFile(cached, 'business.gemini.google', VERSION)).toBeNull();
    expect(readCachedGeminiSelectorFile({ ...cached, fetchedAt: 1.5 }, HOST, VERSION)).toBeNull();
    expect(
      readCachedGeminiSelectorFile(
        { ...cached, file: { ...cached.file, capabilities: ['chat'] } },
        HOST,
        VERSION,
      ),
    ).toBeNull();
  });

  it.each([
    'gemini.google.com',
    'business.gemini.google',
    'aistudio.google.com',
    'aistudio.google.cn',
  ])('does not even read an old plugin adapter override for %s', async (host) => {
    const get = vi.mocked(chrome.storage.local.get);
    get.mockClear();
    expect(await loadSiteOverrideForHost(host)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
