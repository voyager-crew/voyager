import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { startUsageStatusRuntime } from '../runtime';
import type { UsageSnapshot } from '../usageSnapshot';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn(async () => undefined),
  getCurrentLanguage: vi.fn(async () => 'en'),
  getTranslationSync: (key: string) => key,
}));

const now = new Date(2026, 6, 18, 10).getTime();
let stopSelectors = () => {};
let lifetime: AbortController;
let stored: Record<string, unknown>;

function cached(percent: number, accountKey: string): UsageSnapshot {
  return {
    accountKey,
    daily: { percent, resetLabel: '2:00 PM' },
    weekly: null,
    tier: 'PRO',
    updatedAt: now,
  };
}

function navigate(pathname: string): void {
  history.replaceState(null, '', pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function content(percent: number): string {
  return `<div class="usage-metrics-header">PRO</div>
    <div class="gxu-currently">${percent}% used <p class="reset-time">Resets at 2:00 PM</p></div>`;
}

function shownPercent(): string | null | undefined {
  return document.querySelector('#gv-usage-pill .gv-usage-pct')?.textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  lifetime = new AbortController();
  setPageUrl('https://gemini.google.com/u/0/usage');
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  stored = { 'gvUsageCache:u/0': cached(7, 'u/0'), 'gvUsageCache:u/1': cached(80, 'u/1') };
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ ...stored }));
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    Object.assign(stored, items);
  });
});

afterEach(() => {
  lifetime.abort();
  stopSelectors();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetPageUrl();
});

describe('online usage cache', () => {
  it('keeps a reused repaired root retired when returning to the original account', async () => {
    document.body.innerHTML = `<section id="usage">${content(12)}</section>`;
    stopSelectors = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    await startUsageStatusRuntime({ signal: lifetime.signal });
    await vi.advanceTimersByTimeAsync(300);
    expect(stored['gvUsageCache:u/0']).toMatchObject({ daily: { percent: 12 } });

    const root = document.querySelector('#usage')!;
    navigate('/u/1/usage');
    root.innerHTML = content(99);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stored['gvUsageCache:u/1']).toEqual(cached(80, 'u/1'));

    navigate('/u/0/usage');
    await vi.advanceTimersByTimeAsync(1000);
    expect(stored['gvUsageCache:u/0']).toMatchObject({ daily: { percent: 12 } });
    expect(shownPercent()).toContain('12%');
    const nextRoot = document.createElement('section');
    nextRoot.id = 'usage';
    nextRoot.innerHTML = content(23);
    root.replaceWith(nextRoot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stored['gvUsageCache:u/0']).toMatchObject({ accountKey: 'u/0', daily: { percent: 23 } });
  });

  it('keeps the previous account’s repaired root out of a late startup cache read', async () => {
    document.body.innerHTML = `<section id="usage">${content(12)}</section>`;
    stopSelectors = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    let resolveRead: (value: Record<string, unknown>) => void = () => {};
    const read = new Promise<Record<string, unknown>>((resolve) => {
      resolveRead = resolve;
    });
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => read);
    const starting = startUsageStatusRuntime({ signal: lifetime.signal });
    await vi.advanceTimersByTimeAsync(0);
    navigate('/u/1/usage');
    resolveRead({ 'gvUsageCache:u/0': cached(7, 'u/0') });
    await starting;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stored['gvUsageCache:u/1']).toEqual(cached(80, 'u/1'));
    expect(shownPercent()).toContain('80%');

    const nextRoot = document.createElement('section');
    nextRoot.id = 'usage';
    nextRoot.innerHTML = content(23);
    document.querySelector('#usage')!.replaceWith(nextRoot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stored['gvUsageCache:u/1']).toMatchObject({ accountKey: 'u/1', daily: { percent: 23 } });
    expect(stored['gvUsageCache:u/0']).toEqual(cached(7, 'u/0'));
  });

  it.each(['empty render', 'query failure'])(
    'keeps the cache after a repaired-only usage root has a %s, then recovers',
    async (failure) => {
      document.body.innerHTML = `<section id="usage">${content(12)}</section>`;
      stopSelectors = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
      await startUsageStatusRuntime({ signal: lifetime.signal });
      await vi.advanceTimersByTimeAsync(300);
      const good = stored['gvUsageCache:u/0'];
      expect(good).toMatchObject({ accountKey: 'u/0', daily: { percent: 12 } });

      const root = document.querySelector('#usage')!;
      const query = document.querySelector.bind(document);
      const querySpy = vi.spyOn(document, 'querySelector').mockImplementation((selector) => {
        if (failure === 'query failure' && selector === '#usage') {
          throw new DOMException('query unavailable');
        }
        return query(selector);
      });
      // A nonempty render during a failed read must not replace the last verified value either.
      root.innerHTML = failure === 'empty render' ? '' : content(99);
      await vi.advanceTimersByTimeAsync(300);
      expect(stored['gvUsageCache:u/0']).toEqual(good);
      expect(stored[StorageKeys.GV_USAGE_CACHE]).toEqual(good);
      expect(shownPercent()).toContain('12%');

      querySpy.mockRestore();
      root.innerHTML = content(23);
      await vi.advanceTimersByTimeAsync(300);
      expect(stored['gvUsageCache:u/0']).toMatchObject({
        accountKey: 'u/0',
        daily: { percent: 23 },
      });
      expect(shownPercent()).toContain('23%');
    },
  );

  it.each(['app/conversation', 'usage'])(
    'keeps a repaired usage page from overwriting another account after navigating to %s',
    async (destination) => {
      document.body.innerHTML = `<section id="usage">${content(12)}</section>`;
      stopSelectors = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
      await startUsageStatusRuntime({ signal: lifetime.signal });
      await vi.advanceTimersByTimeAsync(300);
      expect(stored['gvUsageCache:u/0']).toMatchObject({ daily: { percent: 12 } });

      const root = document.querySelector('#usage')!;
      root.innerHTML = content(99);
      navigate(`/u/1/${destination}`);
      await vi.advanceTimersByTimeAsync(550);
      expect(stored['gvUsageCache:u/1']).toEqual(cached(80, 'u/1'));
      expect(shownPercent()).toContain('80%');

      const nextRoot = document.createElement('section');
      nextRoot.id = 'usage';
      nextRoot.innerHTML = content(23);
      root.replaceWith(nextRoot);
      navigate('/u/1/usage');
      await vi.advanceTimersByTimeAsync(1000);
      expect(stored['gvUsageCache:u/1']).toMatchObject({
        accountKey: 'u/1',
        daily: { percent: 23 },
      });
      expect(stored['gvUsageCache:u/0']).toMatchObject({
        accountKey: 'u/0',
        daily: { percent: 12 },
      });
    },
  );
});
