import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { click, local, mount, rowSwitch, sync } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiQuoteReply;
const KEY = StorageKeys.QUOTE_REPLY_ENABLED;

describe('Gemini Quote in the panel features tab', () => {
  it.each([
    ['never saved', undefined, false],
    ['saved off', false, false],
    ['saved on', true, true],
  ] as const)('shows and toggles the legacy choice when %s', async (_label, stored, enabled) => {
    if (stored !== undefined) sync[KEY] = stored;
    // A plugins backup must not override the legacy switch, even when it disagrees.
    const stale = { [ID]: { enabled: !enabled, installedAt: 1 } };
    local[StorageKeys.PLUGINS_STATE] = stale;
    await mount();

    expect(rowSwitch(ID).getAttribute('aria-checked')).toBe(String(enabled));
    expect(sync[KEY]).toBe(stored);
    await click(rowSwitch(ID));

    expect(rowSwitch(ID).getAttribute('aria-checked')).toBe(String(!enabled));
    expect(sync[KEY]).toBe(!enabled);
    expect(local[StorageKeys.PLUGINS_STATE]).toEqual(stale);
  });
});
