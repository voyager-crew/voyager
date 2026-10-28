import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPageUrl } from '@/tests/pageUrl';

const mocks = vi.hoisted(() => ({
  getTranslationSync: vi.fn((key: string) => key),
  initI18n: vi.fn(async () => undefined),
  showCoachmark: vi.fn(async () => 'dismissed'),
  storageGet: vi.fn(async (defaults?: Record<string, unknown>) => defaults ?? {}),
  storageSet: vi.fn(async () => undefined),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: {
        get: mocks.storageGet,
        set: mocks.storageSet,
      },
    },
  },
}));

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: mocks.getTranslationSync,
  initI18n: mocks.initI18n,
}));

vi.mock('../../coachmark', () => ({
  showCoachmark: mocks.showCoachmark,
}));

describe('usage coachmark debug trigger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    setPageUrl('https://gemini.google.com/');
  });

  it('can be forced from the normal page console via a DOM event', async () => {
    const { USAGE_COACHMARK_DEBUG_EVENT } = await import('../usageCoachmark');

    document.dispatchEvent(new Event(USAGE_COACHMARK_DEBUG_EVENT));

    await vi.waitFor(() => expect(mocks.showCoachmark).toHaveBeenCalledOnce());
  });
});
