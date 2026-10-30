import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { CLAUDE, GEMINI, mount, sync, writeElsewhere } from './panelHarness';

vi.mock('webextension-polyfill', async () => ({
  default: (await import('./panelBrowserApi')).extensionApi,
}));

const accent = () => document.documentElement.style.getPropertyValue('--site-accent');

describe('accent', () => {
  it("takes the page site's brand", async () => {
    await mount(CLAUDE);
    expect(accent()).toBe('#d97757');
  });

  it('leaves Gemini to the sage default', async () => {
    await mount(GEMINI);
    expect(accent()).toBe('');
  });

  it('follows the color picked for the site, also when it changes elsewhere', async () => {
    sync[StorageKeys.ACCENT_COLORS] = { claude: '#3366cc' };
    await mount(CLAUDE);
    await vi.waitFor(() => expect(accent()).toBe('#3366cc'));

    await writeElsewhere('sync', { [StorageKeys.ACCENT_COLORS]: { claude: '#aa3377' } });
    await vi.waitFor(() => expect(accent()).toBe('#aa3377'));
  });
});
