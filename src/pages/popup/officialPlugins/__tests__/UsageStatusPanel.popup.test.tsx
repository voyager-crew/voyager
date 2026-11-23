import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { emitSyncChange, extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

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
  const choice = (label: string) =>
    [...(popupRows(container).row(id)?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find(
      (radio) => radio.textContent === label,
    );

  it('offers the choice only while the plugin is on', async () => {
    await mount();
    expect(choice(en.usageStatusDisplayUsed)).toBeUndefined();

    await act(async () => popupRows(container).toggle(id).click());
    expect(choice(en.usageStatusDisplayUsed)?.getAttribute('aria-checked')).toBe('true');
    expect(choice(en.usageStatusDisplayRemaining)?.getAttribute('aria-checked')).toBe('false');
    expect(
      popupRows(container)
        .row(id)!
        .querySelector('[role="radiogroup"]')!
        .getAttribute('aria-label'),
    ).toBe(en.usageStatusDisplay);

    await act(async () => popupRows(container).toggle(id).click());
    expect(choice(en.usageStatusDisplayUsed)).toBeUndefined();
  });

  it('writes the synced display key, and follows a change made elsewhere', async () => {
    sync[StorageKeys.USAGE_STATUS_ENABLED] = true;
    await mount();
    await act(async () => choice(en.usageStatusDisplayRemaining)!.click());
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.USAGE_STATUS_DISPLAY]: 'remaining',
    });
    expect(choice(en.usageStatusDisplayRemaining)!.getAttribute('aria-checked')).toBe('true');
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();

    await act(async () => emitSyncChange({ [StorageKeys.USAGE_STATUS_DISPLAY]: 'used' }));
    expect(choice(en.usageStatusDisplayUsed)!.getAttribute('aria-checked')).toBe('true');
  });
});
