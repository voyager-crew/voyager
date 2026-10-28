import { describe, expect, it, vi } from 'vitest';

import en from '@locales/en/messages.json';
import ja from '@locales/ja/messages.json';

import { StorageKeys } from '@/core/types/common';

import {
  emitStorageChange,
  openManager,
  prompt,
  setupPromptManagerTests,
} from './promptManagerHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));

setupPromptManagerTests();

describe('prompt manager language', () => {
  // i18n state lives for the whole file and this case needs Japanese not loaded yet, so it stays alone.
  it('relabels the open panel and its ball after a newly selected language finishes loading', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);
    const add = panel.querySelector<HTMLButtonElement>('.gv-pm-add')!;
    const ball = document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!;
    const picker = panel.querySelector<HTMLSelectElement>('.gv-pm-lang')!;
    expect(add.textContent).toBe(en.pm_add.message);
    expect(ball.getAttribute('aria-label')).toBe(en.promptManagerOptions.message);

    emitStorageChange({ [StorageKeys.LANGUAGE]: { newValue: 'ja' } }, 'sync');

    await vi.waitFor(() => expect(add.textContent).toBe(ja.pm_add.message));
    expect(ball.getAttribute('aria-label')).toBe(ja.promptManagerOptions.message);
    expect(picker.value).toBe('ja');
  });
});
