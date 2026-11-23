import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { startUsageStatusRuntime } from '../runtime';
import type { UsageSnapshot } from '../usageSnapshot';
import { flushUsagePlugin } from './usagePluginHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn(async () => undefined),
  getCurrentLanguage: vi.fn(async () => 'en'),
  // Unknown keys fall back to the English strings in the pill.
  getTranslationSync: (key: string) => key,
}));

type Listener = Parameters<typeof chrome.storage.onChanged.addListener>[0];

const now = new Date(2026, 6, 18, 10).getTime();
const cached: UsageSnapshot = {
  accountKey: 'u/0',
  daily: { percent: 7, resetLabel: '2:00 PM', resetEpoch: Math.floor(now / 1000) + 4 * 3600 },
  weekly: null,
  tier: 'PRO',
  sourceStartedAt: now - 1000,
  updatedAt: now,
};

const listeners = new Set<Listener>();
let run: AbortController | undefined;

const pct = () => document.querySelector<HTMLElement>('#gv-usage-pill .gv-usage-pct')!;
const fill = () => document.querySelector<HTMLElement>('#gv-usage-pill .gv-usage-fill')!;

async function start(sync: Record<string, unknown>): Promise<void> {
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => sync);
  run = new AbortController();
  await startUsageStatusRuntime({ signal: run.signal });
  await flushUsagePlugin();
}

async function syncChange(key: string, newValue: unknown): Promise<void> {
  for (const listener of listeners) listener({ [key]: { newValue } }, 'sync');
  await flushUsagePlugin();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  listeners.clear();
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((l) => listeners.add(l));
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((l) => listeners.delete(l));
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
    'gvUsageCache:u/0': cached,
  }));
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  setPageUrl('https://gemini.google.com/u/0/app');
  document.body.innerHTML = '';
});

afterEach(async () => {
  run?.abort();
  run = undefined;
  await flushUsagePlugin();
  vi.restoreAllMocks();
  resetPageUrl();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usage used/remaining display', () => {
  it('counts used by default, and says so to screen readers', async () => {
    await start({});
    expect(pct().textContent).toBe('7% (4h)');
    expect(pct().tagName).toBe('SPAN');
    expect(pct().getAttribute('aria-label')).toBe('7% used (4h)');
    expect(fill().style.width).toBe('7%');
  });

  it('shows only the remaining number and fills the bar to it when remaining is stored', async () => {
    await start({ [StorageKeys.USAGE_STATUS_DISPLAY]: 'remaining' });
    expect(pct().textContent).toBe('93% (4h)');
    expect(fill().style.width).toBe('93%');
    expect(pct().getAttribute('aria-label')).toBe('93% left (4h)');
    // The colour still follows the used share: 7% used is calm, not alarming.
    expect(pct().closest('.gv-usage-metric')!.className).toBe('gv-usage-metric');
  });

  it('re-renders when the popup changes the choice, and ignores clicks on the number', async () => {
    await start({});
    await syncChange(StorageKeys.USAGE_STATUS_DISPLAY, 'remaining');
    expect(pct().textContent).toBe('93% (4h)');
    expect(fill().style.width).toBe('93%');

    pct().click();
    expect(pct().textContent).toBe('93% (4h)');
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ gvUsageShowRemaining: expect.anything() }),
    );

    await syncChange(StorageKeys.USAGE_STATUS_DISPLAY, undefined);
    expect(pct().textContent).toBe('7% (4h)');
  });
});
