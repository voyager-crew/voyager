import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { click, container, local, mount, sync, writeElsewhere } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiUsageStatus;
const chip = () =>
  container.querySelector<HTMLButtonElement>(`[data-row="${ID}"] button.chip`) ?? null;
/** The items of the open chip menu (every row's menu stays in the document, hidden). */
const items = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"]:not([hidden]) [role="menuitemradio"]'),
  );
const choices = () => items().map((item) => [item.textContent, item.getAttribute('aria-checked')]);

describe('usage status in the floating panel', () => {
  it('offers used or remaining from the manifest setting and writes the synced key', async () => {
    sync[StorageKeys.USAGE_STATUS_ENABLED] = true;
    await mount();
    expect(chip()!.getAttribute('aria-label')).toBe('Bar shows: Used');

    await click(chip());
    expect(choices()).toEqual([
      ['Used', 'true'],
      ['Remaining', 'false'],
    ]);
    await click(items().find((item) => item.textContent === 'Remaining') ?? null);
    expect(sync[StorageKeys.USAGE_STATUS_DISPLAY]).toBe('remaining');
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    expect(chip()!.getAttribute('aria-label')).toBe('Bar shows: Remaining');

    // The popup (or another device) switching back shows here too.
    await writeElsewhere('sync', { [StorageKeys.USAGE_STATUS_DISPLAY]: 'used' });
    expect(chip()!.getAttribute('aria-label')).toBe('Bar shows: Used');
  });
});
