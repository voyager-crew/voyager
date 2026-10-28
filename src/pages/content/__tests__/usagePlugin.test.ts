// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';

import { createGeminiBuiltinStartup } from '../geminiBuiltinStartup';
import { registerBuiltinNativeHandlers } from '../pluginNativeRegistration';
import { maybeShowUsageCoachmark } from '../usageStatus/usageCoachmark';
import { type UsageSnapshot, usageCacheKeyForAccount } from '../usageStatus/usageSnapshot';
import { type LifecycleHarness, installLifecycleHarness } from './lifecycleHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn(async () => undefined),
  getCurrentLanguage: vi.fn(async () => 'en'),
  getTranslationSync: (key: string) => key,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiUsageStatus;
let harness: LifecycleHarness;
let host: PluginHost | null;
let cleanup: CleanupManager;
const now = new Date('2026-10-13T00:00:00Z').getTime();
const resetEpoch = now / 1000 + 4 * 3600;

function cache(percent: number, accountKey: string): UsageSnapshot {
  return {
    accountKey,
    daily: { percent, resetLabel: '04:00', resetEpoch },
    weekly: null,
    tier: 'PRO',
    updatedAt: now,
    sourceStartedAt: now,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function flip(enabled: boolean): void {
  const oldValue = harness.storage.sync.get(StorageKeys.USAGE_STATUS_ENABLED);
  harness.storage.sync.set(StorageKeys.USAGE_STATUS_ENABLED, enabled);
  harness.emitStorageChange(
    { [StorageKeys.USAGE_STATUS_ENABLED]: { oldValue, newValue: enabled } },
    'sync',
  );
}

async function start(enabled: boolean): Promise<void> {
  harness.storage.sync.set(StorageKeys.USAGE_STATUS_ENABLED, enabled);
  const admission = createOfficialAdmission();
  const startup = createGeminiBuiltinStartup(admission, cleanup);
  await startup.startUsageStatus();
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    doc: document,
    admission,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  await flush();
}

function pill(): HTMLElement | null {
  return document.getElementById('gv-usage-pill');
}

function percent(): string | null | undefined {
  return pill()?.querySelector('.gv-usage-pct')?.textContent;
}

function observer(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { source: 'gv-usage-observer', type, payload },
    }),
  );
}

function response(value: number): string {
  return JSON.stringify([
    ['wrb.fr', 'jSf9Qc', JSON.stringify([2, [[2400, value / 100, 1, [[resetEpoch, 0]]]], false])],
  ]);
}

function replayIds(): number[] {
  return vi
    .mocked(window.postMessage)
    .mock.calls.flatMap(([data]) => (data.type === 'replay' ? [data.payload.id as number] : []));
}

beforeAll(registerBuiltinNativeHandlers);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  history.replaceState({}, '', '/u/0/app');
  document.body.innerHTML = '';
  harness = installLifecycleHarness();
  cleanup = new CleanupManager();
  host = null;
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 200,
    y: 200,
    left: 200,
    top: 200,
    right: 440,
    bottom: 232,
    width: 240,
    height: 32,
  } as DOMRect);
  // A stale enabled map entry must not override the old opt-in setting.
  harness.storage.local.set(StorageKeys.PLUGINS_STATE, {
    [ID]: { enabled: true, installedAt: 1 },
  });
});

afterEach(async () => {
  host?.stop();
  cleanup.executeCleanups();
  await flush();
  harness.restore();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usage through its registered official plugin', () => {
  it('mounts the real usage pill live when its coachmark switch writes the old setting', async () => {
    harness.storage.local.set(usageCacheKeyForAccount('u/0'), cache(12, 'u/0'));
    await start(false);
    expect(host!.getStatuses().find((entry) => entry.id === ID)?.kind).toBe('ready');
    expect(pill()).toBeNull();
    const guide = maybeShowUsageCoachmark({ force: true });
    await flush();
    const toggle = document.querySelector<HTMLButtonElement>('.gv-coach-switch')!;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush();
    expect(harness.storage.sync.get(StorageKeys.USAGE_STATUS_ENABLED)).toBe(true);
    // Chrome delivers onChanged after the coachmark's actual sync write.
    harness.emitStorageChange({ [StorageKeys.USAGE_STATUS_ENABLED]: { newValue: true } }, 'sync');
    await flush();
    expect(host!.getStatuses().find((entry) => entry.id === ID)?.kind).toBe('mounted');
    expect(percent()).toMatch(/^12%/);
    expect(document.querySelectorAll('#gv-usage-pill')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.gv-coach-dismiss')!.click();
    await vi.advanceTimersByTimeAsync(500);
    await guide;
  });

  it('stops recording and refreshing while off, preserves cache and shows it again on enable', async () => {
    history.replaceState({}, '', '/u/0/usage');
    const stored = cache(31, 'u/0');
    harness.storage.local.set(usageCacheKeyForAccount('u/0'), stored);
    harness.storage.local.set(StorageKeys.GV_USAGE_RECIPE, { rpcid: 'jSf9Qc', args: '[]' });
    await start(true);
    expect(percent()).toMatch(/^31%/);
    const oldRefresh = pill()!.querySelector<HTMLButtonElement>('.gv-usage-refresh')!;
    flip(false);
    await flush();
    expect(pill()).toBeNull();
    vi.mocked(chrome.storage.local.set).mockClear();
    vi.mocked(window.postMessage).mockClear();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<usage-metrics-window><div class="gxu-currently">90% used</div></usage-metrics-window>',
    );
    observer('capture', {
      accountKey: 'u/0',
      sourcePath: '/u/0/usage',
      sourceStartedAt: now,
      body: response(90),
      rpcid: 'jSf9Qc',
      args: '[]',
    });
    observer('generation-complete');
    oldRefresh.click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(replayIds()).toEqual([]);
    expect(harness.storage.local.get(usageCacheKeyForAccount('u/0'))).toEqual(stored);
    document.querySelector('usage-metrics-window')!.remove();
    flip(true);
    await flush();
    expect(percent()).toMatch(/^31%/);
    expect(replayIds()).toEqual([]);
  });
});
