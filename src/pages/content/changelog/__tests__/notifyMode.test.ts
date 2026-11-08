import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { openChangelog, startChangelog } from '../index';

const parseMarkdown = vi.hoisted(() => vi.fn(() => '<p>Notes</p>'));
vi.mock('marked', () => ({ marked: { parse: parseMarkdown } }));
vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: async () => 'en' }));

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function storeMode(mode: unknown): void {
  vi.mocked(chrome.storage.local.set).mockClear();
  vi.mocked(chrome.storage.local.get).mockResolvedValue({
    [StorageKeys.CHANGELOG_NOTIFY_MODE]: mode,
    [StorageKeys.CHANGELOG_DISMISSED_VERSION]: '0.0.1',
  } as never);
}

const overlay = () => document.querySelector('.gv-changelog-overlay');

describe('changelog notify mode', () => {
  it.each([['popup'], [undefined], ['bogus']])(
    'opens the changelog after an update when the stored mode is %s',
    async (mode) => {
      storeMode(mode);
      stop = await startChangelog();

      expect(overlay()).not.toBeNull();
      expect(document.querySelector('.gv-changelog-notify-hint')?.textContent).toContain(
        'General Options',
      );
    },
  );

  it.each([['badge'], ['off']])(
    'does not open the changelog on its own in %s mode',
    async (mode) => {
      storeMode(mode);
      stop = await startChangelog();

      expect(overlay()).toBeNull();
      expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [StorageKeys.CHANGELOG_DISMISSED_VERSION]: expect.anything() }),
      );
    },
  );

  it('still opens from the version badge in off mode, without the settings hint', async () => {
    storeMode('off');

    expect(await openChangelog()).toBe(true);
    expect(overlay()).not.toBeNull();
    expect(document.querySelector('.gv-changelog-notify-hint')).toBeNull();
  });
});
