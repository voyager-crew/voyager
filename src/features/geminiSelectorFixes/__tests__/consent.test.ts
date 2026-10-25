import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { geminiSelectorAttemptKey, geminiSelectorCacheKey } from '../cache';
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

describe('Gemini selector consent withdrawal', () => {
  it('aborts the request and removes the cache without deleting unrelated data or cadence', async () => {
    const boundary = memoryStorage({
      [geminiSelectorCacheKey(HOST)]: cacheEntry(),
      userData: { turns: ['keep me'] },
    });
    const response = deferred<Response>();
    const started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl,
      bundledRevision: 10,
      now: () => 200,
    });
    const pending = owner.refresh(HOST, { force: true });
    await started.promise;
    await owner.setEnabled(HOST, false);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(await pending).toMatchObject({ enabled: false, result: 'disabled' });
    // Even a transport that ignores AbortSignal cannot publish its late result.
    response.resolve(jsonResponse(selectorFile(12)));
    await Promise.resolve();
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
    expect(boundary.values[geminiSelectorAttemptKey(HOST)]).toEqual({ lastAttemptAt: 200 });
    expect(boundary.values.userData).toEqual({ turns: ['keep me'] });
  });

  it('cannot start a second check by turning OFF and ON before the aborted completion is saved', async () => {
    const boundary = memoryStorage();
    const baseSet = boundary.storage.set;
    const savingAttempt = deferred<void>();
    const finishSave = deferred<void>();
    boundary.storage.set = async (items) => {
      if (Object.hasOwn(items, geminiSelectorAttemptKey(HOST))) {
        savingAttempt.resolve();
        await finishSave.promise;
      }
      await baseSet(items);
    };
    const started = deferred<void>();
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    });
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl,
      now: () => 300,
      bundledRevision: 10,
    });
    const pending = owner.refresh(HOST);
    await started.promise;
    await owner.setEnabled(HOST, false);
    await savingAttempt.promise;
    await owner.setEnabled(HOST, true);
    const next = owner.refresh(HOST);
    expect(fetchImpl).toHaveBeenCalledOnce();
    finishSave.resolve();
    await Promise.all([pending, next]);
    expect((await owner.status(HOST)).lastAttemptAt).toBe(300);
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'notDue' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    response.resolve(jsonResponse());
  });

  it('removes a cache write that finishes after OFF acknowledged the deletion', async () => {
    const boundary = memoryStorage();
    const baseSet = boundary.storage.set;
    const savingCache = deferred<void>();
    const finishSave = deferred<void>();
    boundary.storage.set = async (items) => {
      if (Object.hasOwn(items, geminiSelectorCacheKey(HOST))) {
        savingCache.resolve();
        await finishSave.promise;
      }
      await baseSet(items);
    };
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl: async () => jsonResponse(),
      bundledRevision: 10,
    });
    const pending = owner.refresh(HOST);
    await savingCache.promise;
    await owner.setEnabled(HOST, false);
    finishSave.resolve();
    expect(await pending).toMatchObject({ result: 'disabled', cachedRevision: null });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
  });

  it('rejects a response when persisted consent is false at commit, without requiring an abort event', async () => {
    const boundary = memoryStorage();
    const started = deferred<void>();
    const response = deferred<Response>();
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      bundledRevision: 10,
      fetchImpl: async () => {
        started.resolve();
        return response.promise;
      },
    });
    const pending = owner.refresh(HOST);
    await started.promise;
    boundary.values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES] = false;
    response.resolve(jsonResponse());
    expect(await pending).toMatchObject({ result: 'disabled' });
    expect(boundary.values[geminiSelectorCacheKey(HOST)]).toBeUndefined();
  });

  it('ignores a previous extension cache without resetting its host attempt time', async () => {
    const boundary = memoryStorage({
      [geminiSelectorCacheKey(HOST)]: cacheEntry(),
      [geminiSelectorAttemptKey(HOST)]: { lastAttemptAt: 400 },
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const owner = new GeminiSelectorRefresher({
      storage: boundary.storage,
      fetchImpl,
      extensionVersion: `${VERSION}-next`,
      now: () => 401,
      bundledRevision: 10,
    });
    expect(await owner.refresh(HOST)).toMatchObject({ result: 'notDue', cachedRevision: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not treat an unreadable consent setting as permission for a manual check', async () => {
    const boundary = memoryStorage();
    boundary.storage.get = async () => {
      throw new Error('storage unavailable');
    };
    const fetchImpl = vi.fn<typeof fetch>();
    const owner = new GeminiSelectorRefresher({ storage: boundary.storage, fetchImpl });
    expect(await owner.refresh(HOST, { force: true })).toEqual({ ok: false, error: 'storage' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
