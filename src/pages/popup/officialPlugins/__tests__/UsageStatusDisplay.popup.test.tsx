import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import Popup from '../../Popup';
import { emitSyncChange, extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

/** The used/remaining choice comes from the manifest's `display` select, as every surface shows it. */
describe('usage status row: used or remaining', () => {
  const id = OFFICIAL_PLUGIN_IDS.geminiUsageStatus;
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };
  const select = () => popupRows(container).row(id)?.querySelector('select') ?? null;
  const pick = async (value: string) => {
    const element = select()!;
    await act(async () => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('offers the choice only while the plugin is on', async () => {
    await mount();
    expect(select()).toBeNull();

    await act(async () => popupRows(container).toggle(id).click());
    expect(select()!.value).toBe('used');
    expect([...select()!.options].map((option) => [option.value, option.text])).toEqual([
      ['used', 'Used'],
      ['remaining', 'Remaining'],
    ]);
    expect(select()!.closest('label')!.textContent).toContain('Bar shows');

    await act(async () => popupRows(container).toggle(id).click());
    expect(select()).toBeNull();
  });

  it('writes the synced display key, never plugin state, and follows a change made elsewhere', async () => {
    sync[StorageKeys.USAGE_STATUS_ENABLED] = true;
    await mount();
    await pick('remaining');
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.USAGE_STATUS_DISPLAY]: 'remaining',
    });
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();

    await act(async () => emitSyncChange({ [StorageKeys.USAGE_STATUS_DISPLAY]: 'remaining' }));
    expect(select()!.value).toBe('remaining');
    await act(async () => emitSyncChange({ [StorageKeys.USAGE_STATUS_DISPLAY]: 'used' }));
    expect(select()!.value).toBe('used');
  });
});
