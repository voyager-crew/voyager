import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

const mocks = vi.hoisted(() => ({
  getTranslationSync: vi.fn((key: string) => key),
  initI18n: vi.fn(async () => undefined),
  showCoachmark: vi.fn(async (_config: unknown) => 'dismissed'),
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

vi.mock('@/pages/content/coachmark', () => ({
  showCoachmark: mocks.showCoachmark,
}));

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

describe('compact timeline coachmark', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      value: { hostname: 'gemini.google.com' },
      configurable: true,
      writable: true,
    });
  });

  it('previews the compact rail and persists the inline style toggle', async () => {
    mocks.storageGet.mockResolvedValue({ [StorageKeys.TIMELINE_STYLE]: 'dots' });
    const { maybeShowTimelineStyleCoachmark } = await import('../timelineStyleCoachmark');
    const liveTimeline = document.createElement('div');
    liveTimeline.className = 'gemini-timeline-bar';
    document.body.appendChild(liveTimeline);

    await maybeShowTimelineStyleCoachmark({ force: true });

    const config = mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;
    expect(config.id).toBe('timeline-compact-style-intro-v2');
    expect(config.toggle.initial).toBe(true);

    const preview = config.reveal.mount();
    expect(preview.classList.contains('gv-timeline-style-preview')).toBe(true);
    expect(preview.classList.contains('is-compact')).toBe(true);
    expect(liveTimeline.classList.contains('gv-coach-timeline-hidden')).toBe(true);
    expect(preview.querySelectorAll('span')).toHaveLength(14);
    expect(preview.querySelectorAll('span.active')).toHaveLength(1);

    await config.toggle.onChange(false);
    expect(preview.classList.contains('is-dots')).toBe(true);
    await config.toggle.onChange(true);
    expect(preview.classList.contains('is-compact')).toBe(true);

    await vi.waitFor(() => expect(mocks.storageSet).toHaveBeenCalledTimes(3));
    expect(mocks.storageSet).toHaveBeenNthCalledWith(1, {
      [StorageKeys.TIMELINE_STYLE]: 'compact',
    });
    expect(mocks.storageSet).toHaveBeenNthCalledWith(2, {
      [StorageKeys.TIMELINE_STYLE]: 'dots',
    });
    expect(mocks.storageSet).toHaveBeenNthCalledWith(3, {
      [StorageKeys.TIMELINE_STYLE]: 'compact',
    });

    config.reveal.unmount(preview);
    expect(preview.isConnected).toBe(false);
    expect(liveTimeline.classList.contains('gv-coach-timeline-hidden')).toBe(false);
  });

  async function mountGuideOver(liveTimeline: HTMLElement): Promise<CapturedCoachmarkConfig> {
    document.body.appendChild(liveTimeline);
    const { maybeShowTimelineStyleCoachmark } = await import('../timelineStyleCoachmark');
    await maybeShowTimelineStyleCoachmark({ force: true });
    return mocks.showCoachmark.mock.calls[0]![0] as CapturedCoachmarkConfig;
  }

  it('previews the rail where the user placed it, at its width, without a hidden container', async () => {
    const liveTimeline = document.createElement('div');
    liveTimeline.className =
      'gemini-timeline-bar timeline-no-container gv-timeline-ruler-inward-right';
    liveTimeline.style.top = '90px';
    liveTimeline.style.left = '40px';
    liveTimeline.style.setProperty('--timeline-bar-width', '10px');

    const preview = (await mountGuideOver(liveTimeline)).reveal.mount();

    expect(preview.style.top).toBe('90px');
    expect(preview.style.left).toBe('40px');
    expect(preview.style.getPropertyValue('--timeline-bar-width')).toBe('10px');
    expect(preview.classList.contains('gv-no-rail')).toBe(true);
    expect(preview.classList.contains('gv-inward-right')).toBe(true);
  });

  it("the guide's rail stays on screen when the window narrows", async () => {
    const liveTimeline = document.createElement('div');
    liveTimeline.className = 'gemini-timeline-bar';
    liveTimeline.style.top = '120px';
    liveTimeline.style.left = '1376px';
    const config = await mountGuideOver(liveTimeline);
    const preview = config.reveal.mount();
    expect(preview.style.left).toBe('1376px');

    // The hidden live rail re-places itself for the narrower viewport.
    liveTimeline.style.left = '936px';
    await vi.waitFor(() => expect(preview.style.left).toBe('936px'));

    config.reveal.unmount(preview);
    liveTimeline.style.left = '500px';
    await Promise.resolve();
    expect(preview.style.left).toBe('936px');
  });

  it('does not interrupt users who already use the compact style', async () => {
    mocks.storageGet.mockResolvedValue({ [StorageKeys.TIMELINE_STYLE]: 'compact' });
    const { maybeShowTimelineStyleCoachmark } = await import('../timelineStyleCoachmark');

    await maybeShowTimelineStyleCoachmark();

    expect(mocks.showCoachmark).not.toHaveBeenCalled();
  });

  it('can be forced from the normal page console via a DOM event', async () => {
    const { TIMELINE_STYLE_COACHMARK_DEBUG_EVENT } = await import('../timelineStyleCoachmark');

    document.dispatchEvent(new Event(TIMELINE_STYLE_COACHMARK_DEBUG_EVENT));

    await vi.waitFor(() => expect(mocks.showCoachmark).toHaveBeenCalled());
  });
});
