import './pluginManagerHarness';
import { act } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { NativeCatalogUpdatesCard } from '../NativeCatalogUpdatesCard';
import { container, flushEffects, renderManager, root } from './pluginManagerHarness';

describe('the shared online updates controls', () => {
  it.each(['native', 'plugin'] as const)(
    '%s settings keep manual checks disabled until online updates are enabled',
    async (surface) => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: false,
      } as never);
      const refresh = vi.fn();
      if (surface === 'native') {
        await act(async () => {
          root.render(
            <NativeCatalogUpdatesCard
              catalogHost="gemini.google.com"
              refreshing={false}
              onRefresh={refresh}
              visible
            />,
          );
        });
        await flushEffects();
      } else {
        await renderManager({ catalogHost: 'claude.ai', onRefresh: refresh });
      }

      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) =>
          candidate.getAttribute('aria-label') === 'pluginsRefresh' ||
          candidate.textContent === 'pluginsRefresh',
      );
      const toggle = container.querySelector<HTMLInputElement>(
        'input[aria-label="pluginsOnlineUpdates"]',
      );
      if (!button || !toggle) throw new Error('Expected shared catalog controls');
      expect(toggle.checked).toBe(false);
      expect(button.disabled).toBe(true);
      act(() => button.click());
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => toggle.click());
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
      });
      expect(button.disabled).toBe(false);
      act(() => button.click());
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
});
