import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { isChangelogBadgeDue, startChangelog } from '../index';

// A release with no note folder: a silent patch.
vi.mock('@/core/utils/version', () => ({ EXTENSION_VERSION: '99.0.1' }));
vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: async () => 'en' }));

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function stored(mode: string, readVersion: string): void {
  vi.mocked(chrome.storage.local.get).mockResolvedValue({
    [StorageKeys.CHANGELOG_NOTIFY_MODE]: mode,
    [StorageKeys.CHANGELOG_DISMISSED_VERSION]: readVersion,
  } as never);
}

describe('silent patch release', () => {
  it('neither opens the changelog nor shows NEW when no release since the read one has a note', async () => {
    stored('popup', '99.0.0');
    stop = await startChangelog();
    expect(document.querySelector('.gv-changelog-overlay')).toBeNull();

    stored('badge', '99.0.0');
    expect(await isChangelogBadgeDue()).toBe(false);
  });

  it('still announces an unread note from an earlier release the update skipped past', async () => {
    stored('badge', '2.3.2');
    expect(await isChangelogBadgeDue()).toBe(true);
  });
});

describe('opening the changelog on a silent patch', () => {
  it('shows the newest note the release carries', async () => {
    stored('off', '99.0.1');
    const { openChangelog } = await import('../index');

    expect(await openChangelog()).toBe(true);
    expect(document.querySelector('.gv-changelog-body')?.textContent?.trim()).not.toBe('');
  });
});
