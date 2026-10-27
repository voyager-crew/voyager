import { expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { openLegacySnapshotFeed } from '@/features/plugins/runtime/legacySnapshotFeed';

import { pageSelectorSettings } from '../pageSelectorSettings';

it('online update changes leave the plugin feed idle while visual choices still reach it', async () => {
  vi.clearAllMocks();
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
    [StorageKeys.GV_VISUAL_EFFECT]: 'off',
  } as never);
  const source = pageSelectorSettings('https://chatgpt.com/c/test');
  const reconcile = vi.fn();
  const feed = openLegacySnapshotFeed(source, reconcile);
  try {
    expect((await source.load())[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]).toBe(true);
    await Promise.resolve();
    expect(feed.current()?.[StorageKeys.GV_VISUAL_EFFECT]).toBe('off');
    const baseline = reconcile.mock.calls.length;
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: { newValue: false } }, 'sync');
    }
    expect(reconcile).toHaveBeenCalledTimes(baseline);
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ [StorageKeys.GV_VISUAL_EFFECT]: { newValue: 'snow' } }, 'sync');
    }
    expect(feed.current()?.[StorageKeys.GV_VISUAL_EFFECT]).toBe('snow');
    expect(reconcile).toHaveBeenCalledTimes(baseline + 1);
  } finally {
    feed.stop();
  }
});
