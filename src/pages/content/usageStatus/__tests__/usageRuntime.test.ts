import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';
import { getCurrentLanguage } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';

import { startUsageStatusRuntime } from '../runtime';
import type { UsageSnapshot } from '../usageSnapshot';
import { flushUsagePlugin, startUsagePlugin } from './usagePluginHarness';

const storageListeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn(async () => undefined),
  getCurrentLanguage: vi.fn(async () => 'en'),
  getTranslationSync: (key: string) => key,
}));

const now = new Date(2026, 6, 18, 10).getTime();
const resetEpoch = Math.floor(now / 1000) + 4 * 3600;
let stored: Record<string, unknown>;
let runs: AbortController[];
let stopPlugin: (() => void) | undefined;

function setPath(pathname: string): void {
  setPageUrl(pathname);
}

function navigate(pathname: string): void {
  setPath(pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function cached(percent: number, accountKey: string): UsageSnapshot {
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

function replayIds(): number[] {
  return vi
    .mocked(window.postMessage)
    .mock.calls.flatMap(([data]) => (data.type === 'replay' ? [data.payload.id as number] : []));
}

function pill(): HTMLElement | null {
  return document.getElementById('gv-usage-pill');
}

function shownPercent(): string | null | undefined {
  return pill()?.querySelector('.gv-usage-pct')?.textContent;
}

function cacheWrites(key: string): unknown[] {
  return vi
    .mocked(chrome.storage.local.set)
    .mock.calls.flatMap(([items]) =>
      key in (items as Record<string, unknown>) ? [(items as Record<string, unknown>)[key]] : [],
    );
}

async function storageChange(
  key: string,
  newValue: unknown,
  areaName: 'local' | 'sync' = 'local',
  persisted = true,
): Promise<void> {
  if (areaName === 'local' && persisted) {
    if (newValue === undefined) delete stored[key];
    else stored[key] = newValue;
  }
  for (const listener of storageListeners) listener({ [key]: { newValue } }, areaName);
  await flushUsagePlugin();
}

function liveStorageListeners(): number {
  return (
    vi.mocked(chrome.storage.onChanged.addListener).mock.calls.length -
    vi.mocked(chrome.storage.onChanged.removeListener).mock.calls.length
  );
}

function mountUsagePage(percent: number): void {
  document.body.innerHTML = `<usage-metrics-window><div class="gxu-currently">${percent}% used</div></usage-metrics-window>`;
}

async function startRun(): Promise<AbortController> {
  const controller = new AbortController();
  runs.push(controller);
  await startUsageStatusRuntime({ signal: controller.signal });
  return controller;
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  setPageUrl('https://gemini.google.com/u/2/app');
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  stored = { 'gvUsageCache:u/2': cached(7, 'u/2') };
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => stored);
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    [StorageKeys.USAGE_STATUS_ENABLED]: false,
  }));
  runs = [];
  document.body.innerHTML = '';
});

afterEach(async () => {
  for (const run of runs) run.abort();
  stopPlugin?.();
  stopPlugin = undefined;
  await flushUsagePlugin();
  vi.restoreAllMocks();
  resetPageUrl();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usage status account and route epoch', () => {
  it('drops a scheduled usage scrape when the account changes before it fires', async () => {
    setPath('/u/2/usage');
    mountUsagePage(12);
    await startRun();
    // Gemini switched accounts; the route poller has not run yet and the old
    // account's usage page is still in the DOM.
    setPath('/u/3/usage');
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheWrites('gvUsageCache:u/3')).toEqual([]);
    expect(cacheWrites(StorageKeys.GV_USAGE_CACHE)).toEqual([]);
  });

  it('disconnects the usage page observer as soon as the route leaves the account', async () => {
    setPath('/u/2/usage');
    mountUsagePage(12);
    await startRun();
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheWrites('gvUsageCache:u/2')).toEqual([
      expect.objectContaining({ daily: expect.objectContaining({ percent: 12 }) }),
    ]);
    vi.mocked(chrome.storage.local.set).mockClear();
    // The next account's cache read is still in flight when the old page re-renders.
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => pending<never>().promise);
    navigate('/u/3/usage');
    document.querySelector('.gxu-currently')!.textContent = '50% used';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('keeps a usage page that mutates after a pushState account switch out of the new account cache', async () => {
    setPath('/u/2/usage');
    mountUsagePage(12);
    await startRun();
    // Past the first scrape and the route poller's tick, so its next tick is 400ms away.
    await vi.advanceTimersByTimeAsync(401);
    vi.mocked(chrome.storage.local.set).mockClear();
    // Gemini's router moves to another account with pushState: no popstate.
    setPath('/u/3/usage');
    document.querySelector('.gxu-currently')!.textContent = '50% used';
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheWrites('gvUsageCache:u/3')).toEqual([]);
    expect(cacheWrites(StorageKeys.GV_USAGE_CACHE)).toEqual([]);
  });

  it("shows the current account's cache when the account changes during the startup read", async () => {
    stored['gvUsageCache:u/3'] = cached(80, 'u/3');
    const startupRead = pending<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => startupRead.promise);
    const controller = new AbortController();
    runs.push(controller);
    const started = startUsageStatusRuntime({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    setPath('/u/3/app');
    startupRead.resolve({ 'gvUsageCache:u/2': cached(7, 'u/2') });
    await started;
    expect(pill()!.querySelector('.gv-usage-empty')?.hasAttribute('hidden')).toBe(false);
    expect(shownPercent()).not.toContain('7%');
    await vi.advanceTimersByTimeAsync(250);
    expect(shownPercent()).toContain('80%');
  });
});

describe('usage status replay identity', () => {
  it('ignores a replay reply addressed to a request of a stopped usage runtime', async () => {
    const first = await startRun();
    pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const oldRequest = replayIds().at(-1)!;
    first.abort();
    await startRun();
    pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const currentRequest = replayIds().at(-1)!;
    observer('replay-result', { id: oldRequest, body: response(80) });
    expect(shownPercent()).toContain('7%');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    observer('replay-result', { id: currentRequest, body: response(20) });
    expect(shownPercent()).toContain('20%');
  });

  it('drops a replay result that lands after the usage runtime stopped', async () => {
    const controller = await startRun();
    pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    const request = replayIds().at(-1)!;
    controller.abort();
    observer('replay-result', { id: request, body: response(20) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pill()).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('usage status runtime lifetime', () => {
  it('removes the drag listeners when usage stops in the middle of a drag', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const controller = await startRun();
    const el = pill()!;
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10 }));
    expect(el.classList.contains('gv-usage-dragging')).toBe(true);
    controller.abort();
    const live = (type: string): number => {
      const gone = new Set(removed.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn));
      return new Set(
        added.mock.calls.filter(([t, fn]) => t === type && !gone.has(fn)).map(([, fn]) => fn),
      ).size;
    };
    expect(live('pointermove')).toBe(0);
    expect(live('pointerup')).toBe(0);
    expect(live('resize')).toBe(0);
    expect(el.classList.contains('gv-usage-dragging')).toBe(false);
  });

  it('starts the usage runtime again when it is turned off and on before the first start finished', async () => {
    const language = pending<AppLanguage>();
    vi.mocked(getCurrentLanguage).mockImplementationOnce(() => language.promise);
    const first = new AbortController();
    runs.push(first);
    const firstStart = startUsageStatusRuntime({ signal: first.signal });
    first.abort();
    const second = await startRun();
    language.resolve('en');
    await firstStart;
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('#gv-usage-pill')).toHaveLength(1);
    expect(shownPercent()).toContain('7%');
    expect(liveStorageListeners()).toBe(1);
    second.abort();
    expect(pill()).toBeNull();
    expect(liveStorageListeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps stored usage while off and shows it before collecting when the official switch turns on', async () => {
    setPath('/u/2/usage');
    mountUsagePage(12);
    stopPlugin = await startUsagePlugin();
    document.querySelector('.gxu-currently')!.textContent = '14% used';
    observer('capture', {
      accountKey: 'u/2',
      sourcePath: '/u/2/usage',
      sourceStartedAt: Date.now(),
      body: response(14),
      rpcid: 'offRpc',
      args: '[]',
    });
    observer('generation-complete');
    // A queued older storage event need not match the newer value now held by storage.
    await storageChange(
      'gvUsageCache:u/2',
      { ...cached(3, 'u/2'), sourceStartedAt: now - 2000 },
      'local',
      false,
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(pill()).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(stored['gvUsageCache:u/2']).toEqual(cached(7, 'u/2'));
    expect(replayIds()).toEqual([]);

    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(shownPercent()).toContain('7%');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(cacheWrites('gvUsageCache:u/2')).toEqual([
      expect.objectContaining({
        accountKey: 'u/2',
        daily: expect.objectContaining({ percent: 14 }),
      }),
    ]);
    expect(replayIds()).toEqual([]);

    vi.mocked(chrome.storage.local.set).mockClear();
    document.querySelector('.gxu-currently')!.textContent = '15% used';
    await vi.advanceTimersByTimeAsync(0); // queue a scrape while still enabled
    const refreshButton = pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!;
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, false, 'sync');
    refreshButton.click();
    observer('capture', {
      accountKey: 'u/2',
      sourcePath: '/u/2/usage',
      sourceStartedAt: Date.now(),
      body: response(15),
      rpcid: 'offRpc',
      args: '[]',
    });
    observer('generation-complete');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(pill()).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(replayIds()).toEqual([]);
  });

  it.each(['language', 'switch', 'cache'] as const)(
    'keeps a live official switch change when the initial %s read finishes late',
    async (boundary) => {
      const initialOn = boundary !== 'switch';
      const liveOn = !initialOn;
      vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
        [StorageKeys.USAGE_STATUS_ENABLED]: initialOn,
      }));
      let release: () => void = () => {};
      if (boundary === 'language') {
        const read = pending<AppLanguage>();
        vi.mocked(getCurrentLanguage).mockImplementationOnce(() => read.promise);
        release = () => read.resolve('en');
      } else if (boundary === 'switch') {
        const read = pending<Record<string, unknown>>();
        vi.mocked(chrome.storage.sync.get).mockImplementationOnce(() => read.promise);
        release = () => read.resolve({ [StorageKeys.USAGE_STATUS_ENABLED]: initialOn });
      } else {
        const read = pending<Record<string, unknown>>();
        let held = false;
        vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
          if (!held && Array.isArray(keys) && keys.includes('gvUsageCache:u/2')) {
            held = true;
            return read.promise;
          }
          return stored;
        });
        release = () => read.resolve(stored);
      }
      const starting = startUsagePlugin();
      await vi.advanceTimersByTimeAsync(0);
      await storageChange(StorageKeys.USAGE_STATUS_ENABLED, liveOn, 'sync');
      release();
      stopPlugin = await starting;
      await vi.advanceTimersByTimeAsync(300);
      if (liveOn) expect(shownPercent()).toContain('7%');
      else expect(pill()).toBeNull();
      expect(replayIds()).toEqual([]);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    },
  );

  it('keeps live cache and preferences when startup storage answers with older values', async () => {
    const read = pending<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => read.promise);
    const controller = new AbortController();
    runs.push(controller);
    const starting = startUsageStatusRuntime({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    await storageChange('gvUsageCache:u/2', cached(20, 'u/2'));
    await storageChange(StorageKeys.GV_USAGE_RECIPE, { rpcid: 'liveRpc', args: '[1]' });
    await storageChange(StorageKeys.GV_USAGE_POS, { x: 140, y: 160 });
    // Equal timestamps do not make the pending old read newer than this live event.
    read.resolve({ 'gvUsageCache:u/2': cached(90, 'u/2') });
    await starting;
    expect(shownPercent()).toContain('20%');
    expect(pill()!.style.left).toBe('140px');
    pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!.click();
    expect(vi.mocked(window.postMessage).mock.calls.at(-1)![0].payload).toMatchObject({
      rpcid: 'liveRpc',
      args: '[1]',
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('drops a previous enable cycle cache read after the official switch turns off and on', async () => {
    stopPlugin = await startUsagePlugin();
    const oldRead = pending<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => oldRead.promise);
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, false, 'sync');
    stored['gvUsageCache:u/2'] = { ...cached(30, 'u/2'), sourceStartedAt: now + 1 };
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(shownPercent()).toContain('30%');
    // Even a newer timestamp from the abandoned read belongs to its old enable cycle.
    oldRead.resolve({ 'gvUsageCache:u/2': { ...cached(90, 'u/2'), sourceStartedAt: now + 2 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(shownPercent()).toContain('30%');
    expect(replayIds()).toEqual([]);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('renders stale stored usage before asking the bridge to refresh on reopen', async () => {
    stopPlugin = await startUsagePlugin();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    const shownAtRequest: string[] = [];
    vi.mocked(window.postMessage).mockImplementation((data) => {
      if (data.type === 'replay') shownAtRequest.push(shownPercent() ?? 'missing');
    });
    await storageChange(StorageKeys.USAGE_STATUS_ENABLED, true, 'sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(shownAtRequest).toEqual([expect.stringContaining('7%')]);
    expect(replayIds()).toHaveLength(1);
  });
});
