import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { readContentStyle } from '@/tests/contentStyle';
import { setPageUrl } from '@/tests/pageUrl';
import { beforePaints, injectStyleText } from '@/tests/pseudoElementPaint';

const mocks = vi.hoisted(() => ({
  getTranslationSync: vi.fn((key: string) => key),
  initI18n: vi.fn(async () => undefined),
  closeGuides: [] as (() => void)[],
  showCoachmark: vi.fn(
    (_config: unknown) =>
      new Promise<string>((resolve) => {
        mocks.closeGuides.push(() => resolve('dismissed'));
      }),
  ),
  storageGet: vi.fn(async (defaults?: Record<string, unknown>) => defaults ?? {}),
  storageSet: vi.fn(async () => undefined),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      sync: { get: mocks.storageGet, set: mocks.storageSet },
    },
  },
}));

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: mocks.getTranslationSync,
  initI18n: mocks.initI18n,
}));

vi.mock('../../coachmark', () => ({ showCoachmark: mocks.showCoachmark }));

interface CapturedCoachmarkConfig {
  id: string;
  reveal: {
    mount: () => HTMLElement;
    unmount: (element: HTMLElement | null) => void;
  };
  toggle: {
    initial: boolean;
    onChange: (on: boolean) => Promise<void>;
  };
}

describe('ruler timeline coachmark', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    setPageUrl('https://gemini.google.com/');
  });

  afterEach(async () => {
    for (const close of mocks.closeGuides.splice(0)) close();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('previews the ruler wave and persists the inline style toggle', async () => {
    mocks.storageGet.mockResolvedValue({ [StorageKeys.TIMELINE_STYLE]: 'dots' });
    const { maybeShowRulerTimelineCoachmark } = await import('../rulerTimelineCoachmark');
    const liveTimeline = document.createElement('div');
    liveTimeline.className = 'gemini-timeline-bar';
    document.body.appendChild(liveTimeline);

    void maybeShowRulerTimelineCoachmark({ force: true });
    await vi.waitFor(() => expect(mocks.showCoachmark).toHaveBeenCalled());

    const config = mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;
    expect(config.id).toBe('timeline-ruler-style-intro-v1');
    expect(config.toggle.initial).toBe(true);

    const preview = config.reveal.mount();
    expect(preview.classList.contains('is-ruler')).toBe(true);
    expect(preview.querySelectorAll('span')).toHaveLength(14);
    expect(preview.querySelectorAll('span.active')).toHaveLength(1);
    expect(liveTimeline.classList.contains('gv-coach-timeline-hidden')).toBe(true);

    await config.toggle.onChange(false);
    expect(preview.classList.contains('is-dots')).toBe(true);
    await config.toggle.onChange(true);
    expect(preview.classList.contains('is-ruler')).toBe(true);

    await vi.waitFor(() => expect(mocks.storageSet).toHaveBeenCalledTimes(3));
    expect(mocks.storageSet).toHaveBeenNthCalledWith(1, {
      [StorageKeys.TIMELINE_STYLE]: 'ruler',
    });
    expect(mocks.storageSet).toHaveBeenNthCalledWith(2, {
      [StorageKeys.TIMELINE_STYLE]: 'dots',
    });
    expect(mocks.storageSet).toHaveBeenNthCalledWith(3, {
      [StorageKeys.TIMELINE_STYLE]: 'ruler',
    });

    config.reveal.unmount(preview);
    expect(preview.isConnected).toBe(false);
    expect(liveTimeline.classList.contains('gv-coach-timeline-hidden')).toBe(false);
  });

  it('previews the ruler without a rail, as the live ruler draws, and dots with one', async () => {
    const removeStyles = injectStyleText(readContentStyle());
    mocks.storageGet.mockResolvedValue({ [StorageKeys.TIMELINE_STYLE]: 'dots' });
    const { maybeShowRulerTimelineCoachmark } = await import('../rulerTimelineCoachmark');
    const liveTimeline = document.createElement('div');
    liveTimeline.className = 'gemini-timeline-bar';
    document.body.appendChild(liveTimeline);
    void maybeShowRulerTimelineCoachmark({ force: true });
    await vi.waitFor(() => expect(mocks.showCoachmark).toHaveBeenCalled());
    const config = mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;

    const preview = config.reveal.mount();
    expect(beforePaints(preview)).toBe(false);
    await config.toggle.onChange(false);
    expect(beforePaints(preview)).toBe(true);

    config.reveal.unmount(preview);
    removeStyles();
  });

  it('skips users who already use the ruler style', async () => {
    mocks.storageGet.mockResolvedValue({ [StorageKeys.TIMELINE_STYLE]: 'ruler' });
    const { maybeShowRulerTimelineCoachmark } = await import('../rulerTimelineCoachmark');

    await maybeShowRulerTimelineCoachmark();

    expect(mocks.showCoachmark).not.toHaveBeenCalled();
  });

  it('waits while node levels are on instead of switching their dots rail to ruler', async () => {
    mocks.storageGet.mockImplementation(async (defaults?: Record<string, unknown>) => ({
      ...defaults,
      [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    }));
    const { maybeShowRulerTimelineCoachmark, rulerTimelineCoachmarkStep } =
      await import('../rulerTimelineCoachmark');

    expect(await rulerTimelineCoachmarkStep.isEligible!()).toBe(false);
    expect(await maybeShowRulerTimelineCoachmark()).toBe('skipped');
    expect(mocks.showCoachmark).not.toHaveBeenCalled();
    expect(mocks.storageSet).not.toHaveBeenCalled();
  });

  it('can be forced from the page console through its debug event', async () => {
    const { RULER_TIMELINE_COACHMARK_DEBUG_EVENT } = await import('../rulerTimelineCoachmark');

    document.dispatchEvent(new Event(RULER_TIMELINE_COACHMARK_DEBUG_EVENT));

    await vi.waitFor(() => expect(mocks.showCoachmark).toHaveBeenCalled());
  });
});
