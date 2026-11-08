import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { readPromptStartupSettings } from '../promptStartup';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('../../changelog/index', () => ({ hasUnreadChangelog: vi.fn(async () => true) }));

beforeEach(() => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
});

describe('prompt startup changelog mark', () => {
  it.each([
    ['badge', true],
    ['off', false],
    ['popup', false],
    [undefined, false],
  ])('marks the ball for unread notes in %s mode: %s', async (mode, marked) => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: mode,
    } as never);

    expect((await readPromptStartupSettings()).changelogBadgeActive).toBe(marked);
  });
});
