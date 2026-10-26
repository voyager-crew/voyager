import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledGeminiTurnView } from '@/core/gemini/selectors/bundle';
import { StorageKeys } from '@/core/types/common';

import {
  geminiSelectorAttemptKey,
  geminiSelectorCacheKey,
  readCachedGeminiSelectorFile,
} from '../cache';
import { GEMINI_SELECTOR_CHECK_INTERVAL_MS } from '../policy';
import { GeminiSelectorRefresher } from '../refresh';
import {
  HOST,
  VERSION,
  cacheEntry,
  deferred,
  jsonResponse,
  memoryStorage,
  selectorFile,
} from './testKit';

afterEach(() => vi.useRealTimers());

describe('Gemini selector opt-in refresh', () => {
  it.each([undefined, false, 'true', 1])(
    'does not fetch for consent %s, even with force and an old accepted cache',
    async (consent) => {
      const boundary = memoryStorage({
        [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: consent,
        [geminiSelectorCacheKey(HOST)]: cacheEntry(),
      });
      const fetchImpl = vi.fn<typeof fetch>();
      const owner = new GeminiSelectorRefresher({ storage: boundary.storage, fetchImpl });
      await owner.refresh(HOST);
      expect(await owner.refresh(HOST, { force: true })).toMatchObject({
        enabled: false,
        cachedRevision: null,
        result: 'disabled',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(boundary.values[geminiSelectorAttemptKey(HOST)]).toBeUndefined();
    },
  );

  it.each([
    'aistudio.google.com',
    'aistudio.google.cn',
    'gemini.google.com.evil.test',
    'gemini.google.com:443',
  ])('never fetches an excluded host %s', async (host) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const owner = new GeminiSelectorRefresher({ storage: memoryStorage().storage, fetchImpl });
    expect(await owner.refresh(host, { force: true })).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shares one pending request between tabs and manual checks', async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    });
    const owner = new GeminiSelectorRefresher({
      storage: memoryStorage().storage,
      fetchImpl,
      bundledRevision: 10,
    });
    const first = owner.refresh(HOST);
    const second = owner.refresh(HOST, { force: true });
    await started.promise;
    expect(fetchImpl).toHaveBeenCalledOnce();
    response.resolve(jsonResponse());
    expect(await first).toMatchObject({ result: 'updated', cachedRevision: 11 });
    expect(await second).toMatchObject({ result: 'updated', cachedRevision: 11 });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://voyager.nagi.fun/catalog/gemini-selectors/v3/hosts/gemini.google.com.json',
    );
    expect(request).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-cache',
    });
    expect(request?.body).toBeUndefined();
    expect(request?.headers).toBeUndefined();
  });

  it('keeps the six-hour cadence through OFF, ON, and worker restart', async () => {
    let now = 1_000;
    const boundary = memoryStorage();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(selectorFile(11)));
    const options = { storage: boundary.storage, fetchImpl, now: () => now, bundledRevision: 10 };
    const owner = new GeminiSelectorRefresher(options);
    await owner.refresh(HOST);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await owner.setEnabled(HOST, false);
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
    expect(boundary.values[geminiSelectorAttemptKey(HOST)]).toEqual({ lastAttemptAt: 1_000 });
    await owner.setEnabled(HOST, true);
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'notDue', cachedRevision: null });
    const restarted = new GeminiSelectorRefresher(options);
    expect(await restarted.refresh(HOST)).toMatchObject({
      result: 'notDue',
      cachedRevision: null,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    now += GEMINI_SELECTOR_CHECK_INTERVAL_MS;
    expect(await restarted.refresh(HOST)).toMatchObject({ result: 'updated' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await restarted.refresh(HOST, { force: true })).toMatchObject({ result: 'upToDate' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps the last accepted patch after HTTP or shape failures', async () => {
    const original = cacheEntry();
    const boundary = memoryStorage({ [geminiSelectorCacheKey(HOST)]: original });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ ...selectorFile(12), plugins: [] }))
      .mockResolvedValueOnce(jsonResponse({ ...selectorFile(12), host: 'business.gemini.google' }));
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl,
      extensionVersion: VERSION,
      bundledRevision: 10,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await owner.refresh(HOST, { force: true })).toMatchObject({
        result: 'failed',
        cachedRevision: 11,
      });
      expect(boundary.values[geminiSelectorCacheKey(HOST)]).toEqual(original);
    }
    expect(boundary.values[geminiSelectorAttemptKey(HOST)]).toHaveProperty('lastAttemptAt');
  });

  it('requires a higher revision for rollback and replaces the entire old patch', async () => {
    const boundary = memoryStorage({
      [geminiSelectorCacheKey(HOST)]: cacheEntry(
        selectorFile(12, {
          'turn.user': ['.bad-user'],
          'turn.assistant': ['.old-assistant'],
        }),
      ),
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(selectorFile(11)))
      .mockResolvedValueOnce(jsonResponse(selectorFile(12)))
      .mockResolvedValueOnce(jsonResponse(selectorFile(13, { 'turn.user': ['.known-good-user'] })))
      .mockResolvedValueOnce(jsonResponse(selectorFile(14, {})))
      .mockResolvedValueOnce(jsonResponse(selectorFile(15, {})));
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl,
      extensionVersion: VERSION,
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({
      result: 'failed',
      cachedRevision: 12,
    });
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({
      result: 'failed',
      cachedRevision: 12,
    });
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({
      result: 'updated',
      cachedRevision: 13,
    });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toMatchObject({
      file: { selectors: { 'turn.user': ['.known-good-user'] } },
    });
    const accepted = boundary.values[geminiSelectorCacheKey(HOST)] as {
      file: { selectors: unknown };
    };
    expect(accepted.file.selectors).not.toHaveProperty('turn.assistant');
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({ result: 'updated' });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toMatchObject({
      file: { catalogRevision: 14, selectors: {} },
    });
    expect(
      readCachedGeminiSelectorFile(boundary.values[geminiSelectorCacheKey(HOST)], HOST, VERSION)
        ?.selectors,
    ).toEqual({});
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({
      result: 'upToDate',
      cachedRevision: 15,
    });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toMatchObject({
      file: { catalogRevision: 15, selectors: {} },
    });
  });

  it('persists a higher revision without requesting refresh when its effective ordered lists are unchanged', async () => {
    const boundary = memoryStorage({ [geminiSelectorCacheKey(HOST)]: cacheEntry() });
    const next = selectorFile(12, {
      'turn.user': ['.fixed-user'],
      // Explicitly supplying this bundled list changes the patch shape but no effective locator.
      'turn.assistant': getBundledGeminiTurnView().profiles['turn.assistant'],
    });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(next),
      bundledRevision: 10,
      extensionVersion: VERSION,
    });
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'upToDate', cachedRevision: 12 });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toMatchObject({ file: next });
  });

  it('does not adopt a response that merely ties the package revision', async () => {
    const boundary = memoryStorage();
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(selectorFile(10)),
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST)).toMatchObject({
      result: 'upToDate',
      cachedRevision: null,
    });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
  });

  it('times out an unresponsive transport without keeping its host permanently busy', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(jsonResponse());
    const owner = new GeminiSelectorRefresher({
      storage: memoryStorage().storage,
      fetchImpl,
      timeoutMs: 100,
      bundledRevision: 10,
    });
    const pending = owner.refresh(HOST);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ result: 'failed' });
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(await owner.refresh(HOST, { force: true })).toMatchObject({ result: 'updated' });
  });
});
