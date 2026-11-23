import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { createUsagePill } from '../usagePill';
import type { UsageSnapshot } from '../usageSnapshot';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({ getTranslationSync: (key: string) => key }));

const now = new Date(2026, 6, 18, 10).getTime();
const snapshot: UsageSnapshot = {
  accountKey: 'u/0',
  daily: { percent: 7, resetLabel: '2:00 PM', resetEpoch: Math.floor(now / 1000) + 4 * 3600 },
  weekly: null,
  tier: 'PRO',
  sourceStartedAt: now - 1000,
  updatedAt: now,
};

let pill: ReturnType<typeof createUsagePill>;
const pct = () => document.querySelector<HTMLButtonElement>('#gv-usage-pill .gv-usage-pct')!;
const fill = () => document.querySelector<HTMLElement>('#gv-usage-pill .gv-usage-fill')!;

async function show(stored: Record<string, unknown> = {}): Promise<void> {
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => stored);
  pill = createUsagePill(() => {});
  await pill.loadPosition();
  pill.render(true, snapshot);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
  setPageUrl('https://gemini.google.com/app');
});

afterEach(() => {
  pill.remove();
  resetPageUrl();
  vi.useRealTimers();
});

describe('usage used/remaining view', () => {
  it('flips to remaining on a percent click, remembers it, and follows other tabs', async () => {
    await show();
    expect(pct().textContent).toBe('7% (4h)');

    pct().click();
    expect(pct().textContent).toBe('93% left (4h)');
    expect(fill().style.width).toBe('93%');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [StorageKeys.GV_USAGE_SHOW_REMAINING]: true,
    });

    pill.adoptShowRemaining(false);
    expect(pct().textContent).toBe('7% (4h)');
    expect(fill().style.width).toBe('7%');
  });

  it('opens in the remaining view when that was the stored choice', async () => {
    await show({ [StorageKeys.GV_USAGE_SHOW_REMAINING]: true });
    expect(pct().textContent).toBe('93% left (4h)');
  });
});
