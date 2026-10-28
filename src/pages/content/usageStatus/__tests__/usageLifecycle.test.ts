import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';
import type { AppLanguage } from '@/utils/language';

import type { UsageSnapshot } from '../usageSnapshot';
import { flushUsagePlugin, startUsagePlugin } from './usagePluginHarness';

const storageListeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();

vi.mock('webextension-polyfill', () => ({ default: chrome }));
const language = vi.hoisted(() => ({
  current: 'en',
  subscribers: new Set<(language: string) => void>(),
}));
vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn(async () => undefined),
  onCachedLanguageChange: (callback: (language: string) => void) => {
    language.subscribers.add(callback);
    return () => language.subscribers.delete(callback);
  },
  getCurrentLanguage: vi.fn(async () => language.current),
  getTranslationSync: (key: string) => key,
}));

const now = new Date(2026, 6, 18, 10).getTime();
const resetEpoch = Math.floor(now / 1000) + 4 * 3600;
let stop: (() => void) | undefined;
let stored: Record<string, unknown>;

function navigate(pathname: string): void {
  setPageUrl(pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function cached(percent = 7, accountKey = 'u/2'): UsageSnapshot {
  return {
    accountKey,
    daily: { percent, resetLabel: '2:00 PM', resetEpoch },
    weekly: null,
    tier: 'PRO',
    sourceStartedAt: now - 1000,
    updatedAt: now,
  };
}

function response(percent: number): string {
  return JSON.stringify([
    ['wrb.fr', 'jSf9Qc', JSON.stringify([2, [[2400, percent / 100, 1, [[resetEpoch, 0]]]], false])],
  ]);
}

function observer(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { source: 'gv-usage-observer', type, payload },
    }),
  );
}

/** The shared i18n system has loaded a newly selected language. */
async function languageLoaded(next: AppLanguage): Promise<void> {
  language.current = next;
  for (const subscriber of language.subscribers) subscriber(next);
  await flushUsagePlugin();
}

async function storageChange(
  key: string,
  newValue: unknown,
  areaName: 'local' | 'sync' = 'local',
): Promise<void> {
  if (areaName === 'local') {
    if (newValue === undefined) delete stored[key];
    else stored[key] = newValue;
  }
  for (const listener of storageListeners) listener({ [key]: { newValue } }, areaName);
  await flushUsagePlugin();
}

function replayMessages(): Array<{ id: number; rpcid: string; args: string; sourcePath: string }> {
  return vi
    .mocked(window.postMessage)
    .mock.calls.flatMap(([data]) => (data.type === 'replay' ? [data.payload] : []));
}

function pill(): HTMLElement {
  return document.getElementById('gv-usage-pill')!;
}

async function start(enabled = true): Promise<void> {
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    [StorageKeys.USAGE_STATUS_ENABLED]: enabled,
  }));
  stop = await startUsagePlugin();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  storageListeners.clear();
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) =>
    storageListeners.add(listener),
  );
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) =>
    storageListeners.delete(listener),
  );
  language.current = 'en';
  setPageUrl('https://gemini.google.com/u/2/app');
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  stored = { 'gvUsageCache:u/2': cached() };
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => stored);
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
  document.body.innerHTML = '';
  document.documentElement.lang = 'en';
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await flushUsagePlugin();
  vi.restoreAllMocks();
  resetPageUrl();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usage feature lifecycle', () => {
  it('starts once, renders cached usage, and tears down without polling or writes', async () => {
    await start();
    expect(document.querySelectorAll('#gv-usage-pill')).toHaveLength(1);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toBe('7% (4h)');
    expect(pill().querySelector<HTMLAnchorElement>('.gv-usage-open')?.href).toBe(
      'https://gemini.google.com/u/2/usage',
    );
    const detachedRefresh = pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!;
    expect(replayMessages()).toHaveLength(0);
    stop!();
    stop = undefined;
    expect(document.getElementById('gv-usage-pill')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    detachedRefresh.click();
    observer('generation-complete');
    observer('replay-result', { body: response(20) });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(replayMessages()).toHaveLength(0);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(storageListeners.size).toBe(0);
  });

  it('shows an empty account-scoped link and replays the default recipe without a cache', async () => {
    stored = {};
    await start();
    expect(pill().querySelector('.gv-usage-empty')?.hasAttribute('hidden')).toBe(false);
    expect(pill().querySelector<HTMLAnchorElement>('.gv-usage-empty')?.href).toBe(
      'https://gemini.google.com/u/2/usage',
    );
    expect(replayMessages()).toEqual([
      { id: expect.any(Number), rpcid: 'jSf9Qc', args: '[]', sourcePath: '/u/2/usage' },
    ]);
  });

  it('manual refresh immediately accepts a lower value and clears the loading indicator', async () => {
    await start();
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    expect(pill().classList.contains('gv-usage-loading')).toBe(true);
    const request = replayMessages().at(-1)!;
    observer('replay-result', { id: request.id, body: response(1) });
    expect(pill().classList.contains('gv-usage-loading')).toBe(false);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toBe('1% (4h)');
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      'gvUsageCache:u/2': expect.objectContaining({ regressionVerified: true, accountKey: 'u/2' }),
      [StorageKeys.GV_USAGE_CACHE]: expect.objectContaining({
        daily: expect.objectContaining({ percent: 1 }),
      }),
    });
  });

  it('finishes a refresh and a post-generation refresh across a same-account conversation switch', async () => {
    await start();
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    navigate('/u/2/app/other-chat');
    await vi.advanceTimersByTimeAsync(1000);
    observer('replay-result', { id: replayMessages().at(-1)!.id, body: response(3) });
    expect(pill().classList.contains('gv-usage-loading')).toBe(false);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('3%');

    observer('generation-complete');
    navigate('/u/2/app/third-chat');
    await vi.advanceTimersByTimeAsync(4000);
    expect(replayMessages()).toHaveLength(2);
  });

  it('does not leave the refresh spinner running when an account switch cancels the refresh', async () => {
    await start();
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    navigate('/u/3/app');
    // Before the new account settles and starts its own refresh.
    await vi.advanceTimersByTimeAsync(10);
    expect(pill().classList.contains('gv-usage-loading')).toBe(false);
  });

  it('debounces generation events and confirms an automatic decrease with a second fresh replay', async () => {
    await start();
    observer('generation-complete');
    await vi.advanceTimersByTimeAsync(2000);
    observer('generation-complete');
    await vi.advanceTimersByTimeAsync(3999);
    expect(replayMessages()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    observer('replay-result', { id: replayMessages().at(-1)!.id, body: response(1) });
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('7%');
    await vi.advanceTimersByTimeAsync(1999);
    expect(replayMessages()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    observer('replay-result', { id: replayMessages().at(-1)!.id, body: response(1) });
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('1%');
  });

  it('mirrors enable/disable and recipe changes while cancelling generation work', async () => {
    await start(false);
    expect(document.getElementById('gv-usage-pill')).toBeNull();
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    expect(pill()).not.toBeNull();
    await storageChange(StorageKeys.GV_USAGE_RECIPE, { rpcid: 'newRpc', args: '[1]' });
    observer('generation-complete');
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, false, 'sync');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(document.getElementById('gv-usage-pill')).toBeNull();
    expect(replayMessages()).toHaveLength(0);
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(replayMessages().at(-1)).toMatchObject({ rpcid: 'newRpc', args: '[1]' });
  });

  it('keeps account caches isolated and reloads them when the route changes', async () => {
    await start();
    await storageChange(StorageKeys.GV_USAGE_CACHE, cached(80, 'u/3'));
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('7%');
    stored['gvUsageCache:u/3'] = cached(80, 'u/3');
    navigate('/u/3/app');
    await vi.advanceTimersByTimeAsync(250);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('80%');
    expect(pill().querySelector<HTMLAnchorElement>('.gv-usage-open')?.href).toBe(
      'https://gemini.google.com/u/3/usage',
    );
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('scrapes a late-mounted usage component, tracks mutations, and keeps the last non-empty data', async () => {
    setPageUrl('/u/2/usage');
    await start();
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <usage-metrics-window><div class="gxu-currently">12% used</div></usage-metrics-window>
    `,
    );
    await vi.advanceTimersByTimeAsync(800);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('12%');
    document.querySelector('.gxu-currently')!.textContent = '15% used';
    await vi.advanceTimersByTimeAsync(300);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('15%');
    document.querySelector('.gxu-currently')!.textContent = '';
    await vi.advanceTimersByTimeAsync(300);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('15%');
    expect(replayMessages()).toHaveLength(0);
  });

  it('calibrates captures only from the current account, route and collection with matching usage', async () => {
    setPageUrl('/u/2/usage');
    document.body.innerHTML =
      '<usage-metrics-window><div class="gxu-currently">7% used</div></usage-metrics-window>';
    await start();
    const source = { accountKey: 'u/2', sourcePath: '/u/2/usage', sourceStartedAt: now };
    observer('capture', { ...source, body: response(50), rpcid: 'badRpc', args: '[2]' });
    for (const metadata of [
      {},
      { ...source, accountKey: 'u/3' },
      { ...source, sourcePath: '/u/2/app' },
      { ...source, sourceStartedAt: now - 1 },
    ]) {
      observer('capture', { ...metadata, body: response(8), rpcid: 'lateRpc', args: '[2]' });
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    }
    observer('capture', { ...source, body: response(8), rpcid: 'calibratedRpc', args: '[3]' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [StorageKeys.GV_USAGE_RECIPE]: { rpcid: 'calibratedRpc', args: '[3]' },
    });
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    expect(replayMessages().at(-1)).toMatchObject({ rpcid: 'calibratedRpc', args: '[3]' });
  });

  it('mirrors stored placement and refreshes countdown/freshness without duplicating timers', async () => {
    stored[StorageKeys.GV_USAGE_POS] = { x: 100, y: 120 };
    await start();
    expect(pill().style.left).toBe('100px');
    await storageChange(StorageKeys.GV_USAGE_POS, { x: 140, y: 160 });
    expect(pill().style.top).toBe('160px');
    const timers = vi.getTimerCount();
    await storageChange('gvUsageCache:u/2', cached(10));
    expect(vi.getTimerCount()).toBe(timers);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toBe('10% (3h59m)');
    expect(pill().title).toBe('Updated 1m ago');
    await storageChange(StorageKeys.GV_USAGE_POS, null);
    expect(pill().style.left).toBe('50%');
    expect(pill().style.transform).toBe('translateX(-50%)');
  });
  it('drags the pill and persists its position while leaving controls clickable', async () => {
    stored[StorageKeys.GV_USAGE_POS] = { x: 100, y: 120 };
    await start();
    const el = pill();
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(Number.parseFloat(el.style.left), Number.parseFloat(el.style.top), 240, 32),
    );
    const pointer = (type: string, x: number, y: number) =>
      new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    el.querySelector('.gv-usage-refresh')!.dispatchEvent(pointer('pointerdown', 110, 130));
    window.dispatchEvent(pointer('pointermove', 210, 230));
    window.dispatchEvent(pointer('pointerup', 210, 230));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    el.dispatchEvent(pointer('pointerdown', 110, 130));
    window.dispatchEvent(pointer('pointermove', 210, 230));
    expect(el.style.left).toBe('200px');
    expect(el.style.top).toBe('220px');
    window.dispatchEvent(pointer('pointerup', 210, 230));
    expect(el.classList.contains('gv-usage-dragging')).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [StorageKeys.GV_USAGE_POS]: { x: 200, y: 220 },
    });
    el.dispatchEvent(pointer('pointerdown', 210, 230));
    stop!();
    stop = undefined;
    vi.mocked(chrome.storage.local.set).mockClear();
    window.dispatchEvent(pointer('pointermove', 310, 330));
    window.dispatchEvent(pointer('pointerup', 310, 330));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('rejects a late older manual replay after a newer response was adopted', async () => {
    await start();
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const first = replayMessages().at(-1)!;
    await vi.advanceTimersByTimeAsync(1);
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const second = replayMessages().at(-1)!;
    observer('replay-result', { id: second.id, body: response(30) });
    observer('replay-result', { id: first.id, body: response(20) });
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('30%');
  });

  it('reformats cached reset labels when the Voyager language changes', async () => {
    await start();
    expect(pill().querySelector<HTMLElement>('.gv-usage-metric')?.title).toBe('Resets 2:00 PM');
    await languageLoaded('zh');
    expect(pill().querySelector<HTMLElement>('.gv-usage-metric')?.title).toBe('Resets 14:00');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('does not show or save a late replay from another account or a stopped session', async () => {
    navigate('/u/1/app');
    stored = { 'gvUsageCache:u/1': cached(7, 'u/1') };
    await start();
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const oldRequest = replayMessages().at(-1)!;
    navigate('/u/2/app');
    await vi.advanceTimersByTimeAsync(250);
    expect(pill().querySelector('.gv-usage-empty')?.hasAttribute('hidden')).toBe(false);
    observer('replay-result', { id: oldRequest.id, body: response(80) });
    expect(pill().querySelector('.gv-usage-empty')?.hasAttribute('hidden')).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    const currentRequest = replayMessages().at(-1)!;
    observer('replay-result', { id: currentRequest.id, body: response(20) });
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('20%');
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      'gvUsageCache:u/2': expect.objectContaining({
        accountKey: 'u/2',
        daily: expect.objectContaining({ percent: 20 }),
      }),
      [StorageKeys.GV_USAGE_CACHE]: expect.objectContaining({ accountKey: 'u/2' }),
    });
    pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const stoppedRequest = replayMessages().at(-1)!;
    stop!();
    await start();
    vi.mocked(chrome.storage.local.set).mockClear();
    observer('replay-result', { id: stoppedRequest.id, body: response(90) });
    expect(pill().querySelector('.gv-usage-empty')?.hasAttribute('hidden')).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not revive the pill or observer after stop or apply old loads to a restarted session', async () => {
    await start();
    navigate('/u/2/usage');
    stop!();
    stop = undefined;
    await languageLoaded('zh');
    await vi.advanceTimersByTimeAsync(800);
    expect(document.getElementById('gv-usage-pill')).toBeNull();
    language.current = 'en';
    expect(vi.getTimerCount()).toBe(0);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    navigate('/u/2/app');
    await start();
    let resolveCache!: (value: Record<string, unknown>) => void;
    const pendingCache = new Promise<Record<string, unknown>>((resolve) => {
      resolveCache = resolve;
    });
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => pendingCache);
    navigate('/u/2/usage');
    await vi.advanceTimersByTimeAsync(250);
    stop!();
    stop = undefined;
    expect(vi.getTimerCount()).toBe(0);
    navigate('/u/2/app');
    await start();
    resolveCache({ 'gvUsageCache:u/2': cached(42) });
    await vi.advanceTimersByTimeAsync(800);
    expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('7%');
    expect(pill().querySelector<HTMLElement>('.gv-usage-metric')?.title).toBe('Resets 2:00 PM');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    stop!();
    stop = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not throw on a null replay payload and still adopts a valid refresh', async () => {
    await start();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      observer('replay-result', null);
      observer('replay-result');
      expect(errors).toEqual([]);
      pill().querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
      observer('replay-result', { id: replayMessages().at(-1)!.id, body: response(20) });
      expect(pill().querySelector('.gv-usage-pct')?.textContent).toContain('20%');
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
