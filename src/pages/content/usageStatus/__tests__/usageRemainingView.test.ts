// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';

import { type LifecycleHarness, installLifecycleHarness } from '../../__tests__/lifecycleHarness';
import { registerBuiltinNativeHandlers } from '../../pluginNativeRegistration';
import { type UsageSnapshot, usageCacheKeyForAccount } from '../usageSnapshot';
import { flushUsagePlugin } from './usagePluginHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn(async () => undefined),
  getCurrentLanguage: vi.fn(async () => 'en'),
  // Unknown keys fall back to the English strings in the pill.
  getTranslationSync: (key: string) => key,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiUsageStatus;
const now = new Date(2026, 6, 18, 10).getTime();
const cached: UsageSnapshot = {
  accountKey: 'u/0',
  daily: { percent: 7, resetLabel: '2:00 PM', resetEpoch: Math.floor(now / 1000) + 4 * 3600 },
  weekly: null,
  tier: 'PRO',
  sourceStartedAt: now - 1000,
  updatedAt: now,
};

let harness: LifecycleHarness;
let host: PluginHost | null = null;

const pill = () => document.getElementById('gv-usage-pill');
const pct = () => pill()!.querySelector<HTMLElement>('.gv-usage-pct')!;
const fill = () => pill()!.querySelector<HTMLElement>('.gv-usage-fill')!;
const status = () => host!.getStatuses().find((entry) => entry.id === ID)?.kind;

/** Mounts the real official plugin through the host, with `display` as stored. */
async function start(display?: unknown): Promise<void> {
  harness.storage.sync.set(StorageKeys.USAGE_STATUS_ENABLED, true);
  if (display !== undefined) harness.storage.sync.set(StorageKeys.USAGE_STATUS_DISPLAY, display);
  const admission = createOfficialAdmission();
  admission.admit('gemini', 'usageStatus');
  admission.close();
  host = new PluginHost({
    url: location.href,
    doc: document,
    sources: [new BuiltinPluginSource()],
    admission,
    isTopFrame: true,
    requestCatalogRefresh: () => {},
  });
  await host.start();
  await flushUsagePlugin();
}

/** The popup or the in-page panel writes the choice; Chrome reports the change. */
async function choose(display: unknown): Promise<void> {
  const oldValue = harness.storage.sync.get(StorageKeys.USAGE_STATUS_DISPLAY);
  if (display === undefined) harness.storage.sync.delete(StorageKeys.USAGE_STATUS_DISPLAY);
  else harness.storage.sync.set(StorageKeys.USAGE_STATUS_DISPLAY, display);
  harness.emitStorageChange(
    { [StorageKeys.USAGE_STATUS_DISPLAY]: { oldValue, newValue: display } },
    'sync',
  );
  await flushUsagePlugin();
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  history.replaceState({}, '', '/u/0/app');
  document.body.innerHTML = '';
  harness = installLifecycleHarness();
  harness.storage.local.set(usageCacheKeyForAccount('u/0'), cached);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(async () => {
  host?.stop();
  host = null;
  await flushUsagePlugin();
  harness.restore();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usage used/remaining display, as the plugin setting', () => {
  it('counts used by default, and says so to screen readers', async () => {
    await start();
    expect(pct().textContent).toBe('7% (4h)');
    expect(pct().tagName).toBe('SPAN');
    expect(pct().getAttribute('aria-label')).toBe('7% used (4h)');
    expect(fill().style.width).toBe('7%');
  });

  it('shows only the remaining number and fills the bar to it when remaining is stored', async () => {
    await start('remaining');
    expect(pct().textContent).toBe('93% (4h)');
    expect(fill().style.width).toBe('93%');
    expect(pct().getAttribute('aria-label')).toBe('93% left (4h)');
    // The colour still follows the used share: 7% used is calm, not alarming.
    expect(pct().closest('.gv-usage-metric')!.className).toBe('gv-usage-metric');
  });

  it('switches in place when the setting changes, without remounting the plugin', async () => {
    await start();
    const mounted = pill();
    expect(status()).toBe('mounted');

    await choose('remaining');
    expect(pill()).toBe(mounted);
    expect(pct().textContent).toBe('93% (4h)');
    expect(fill().style.width).toBe('93%');

    // Clicking the number does nothing: the choice lives in the plugin's settings.
    pct().click();
    expect(pct().textContent).toBe('93% (4h)');

    await choose(undefined);
    expect(pill()).toBe(mounted);
    expect(status()).toBe('mounted');
    expect(pct().textContent).toBe('7% (4h)');
  });
});
