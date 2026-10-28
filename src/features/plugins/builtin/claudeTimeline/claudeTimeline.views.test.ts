import './__tests__/claudeTimelineHarness';
/** The Claude timeline's dots and compact view: rendering, the view guide, active dot and jumps. */
import { describe, expect, it, vi } from 'vitest';

import {
  startClaudeTimeline,
  updateClaudeTimelineSettings,
  type CapturedTimelineCoachmarkOptions,
  addTurn,
  queryDots,
  flush,
  requestPluginSetting,
  showTimelineStyleCoachmark,
  useClaudeTimelinePage,
} from './__tests__/claudeTimelineHarness';

describe('Claude timeline', () => {
  useClaudeTimelinePage();

  it('renders one dot per Claude user message, scrolls on click, and highlights active dot', async () => {
    addTurn('first prompt');
    addTurn('second prompt');

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    expect(dots).toHaveLength(2);

    dots[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(dots[0].classList.contains('active')).toBe(true);
    expect(dots[0].getAttribute('aria-current')).toBe('true');
  });

  it('shows the compact-view guide when the plugin starts for the first time', async () => {
    addTurn('first prompt');

    startClaudeTimeline({ compactView: false });
    await flush();

    expect(showTimelineStyleCoachmark).toHaveBeenCalledOnce();
    const options = showTimelineStyleCoachmark.mock
      .calls[0]![0] as CapturedTimelineCoachmarkOptions;
    expect(options.id).toBe('claude-timeline-compact-style-intro-v1');
    expect(options.enabled).toBe(false);

    await options.onStyleChange(true);

    expect(requestPluginSetting).toHaveBeenCalledWith(
      'voyager.claude-timeline',
      'compactView',
      true,
    );
    expect(
      document.querySelector('.gemini-timeline-bar')?.classList.contains('timeline-style-compact'),
    ).toBe(true);
  });

  it('suppresses the compact-view guide while an artifact iframe is open', async () => {
    addTurn('first prompt');
    const artifact = document.createElement('iframe');
    artifact.src = 'https://abc123.frame.claudeusercontent.com/artifact';
    document.body.appendChild(artifact);
    try {
      startClaudeTimeline({ compactView: false });
      await flush();

      expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();
      // The timeline itself still runs — only the guide is suppressed.
      expect(document.querySelector('.gemini-timeline-bar')).toBeTruthy();
    } finally {
      artifact.remove();
    }
  });

  it('switches live between node and compact hover-panel views', async () => {
    addTurn('first prompt');
    addTurn('second prompt');
    addTurn('third prompt');

    startClaudeTimeline({ compactView: true });
    await flush();

    const bar = document.querySelector<HTMLElement>('.gemini-timeline-bar')!;
    expect(bar.classList.contains('timeline-style-compact')).toBe(true);
    expect(bar.querySelector('.timeline-track')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.timeline-preview-panel-compact')).toBeTruthy();

    bar.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.timeline-preview-panel')?.classList.contains('visible')).toBe(
      true,
    );

    updateClaudeTimelineSettings({ compactView: false });

    expect(bar.classList.contains('timeline-style-compact')).toBe(false);
    expect(bar.querySelector('.timeline-track')?.hasAttribute('aria-hidden')).toBe(false);
    expect(queryDots().every((dot) => dot.style.getPropertyValue('--n') !== '')).toBe(true);
    expect(document.querySelector('.timeline-preview-panel-compact')).toBeNull();
    expect(document.querySelector('.timeline-preview-panel')?.classList.contains('visible')).toBe(
      false,
    );
  });

  it('navigates a compact preview item without showing a tooltip', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    startClaudeTimeline({ compactView: true });
    await flush();

    const bar = document.querySelector<HTMLElement>('.gemini-timeline-bar')!;
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    bar.dispatchEvent(new MouseEvent('mouseenter'));
    const items = document.querySelectorAll<HTMLElement>('.timeline-preview-item');
    items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(document.getElementById('gemini-timeline-tooltip')?.classList.contains('visible')).toBe(
      false,
    );
  });

  it('updates active dot from the current viewport', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const firstRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    const secondRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    first.getBoundingClientRect = firstRect;
    second.getBoundingClientRect = secondRect;
    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    expect(dots[0].classList.contains('active')).toBe(true);
    firstRect.mockClear();
    secondRect.mockClear();

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[1].classList.contains('active')).toBe(true);
    expect(firstRect).not.toHaveBeenCalled();
    expect(secondRect).not.toHaveBeenCalled();
  });

  it('activates the last dot when scrolled to the bottom', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    const third = addTurn('last prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(
      () => ({ top: 1580, bottom: 1620, height: 40 }) as DOMRect,
    );
    third.getBoundingClientRect = vi.fn(() => ({ top: 1950, bottom: 1990, height: 40 }) as DOMRect);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1400 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[2].classList.contains('active')).toBe(true);
    expect(dots[1].classList.contains('active')).toBe(false);
  });

  it('keeps clicked dot active while the jump settles', async () => {
    const first = addTurn('first prompt');
    const second = addTurn('second prompt');
    first.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 40, height: 40 }) as DOMRect);
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);

    startClaudeTimeline();
    await flush();

    const dots = queryDots();
    dots[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('scroll'));

    expect(dots[0].classList.contains('active')).toBe(true);
    expect(dots[1].classList.contains('active')).toBe(false);
  });

  it('scrolls clicked markers to the active anchor', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);

    startClaudeTimeline();
    await flush();

    queryDots()[1].click();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
  });

  it('jumps instantly when the reader asked for less motion', async () => {
    addTurn('first prompt');
    const second = addTurn('second prompt');
    second.getBoundingClientRect = vi.fn(() => ({ top: 700, bottom: 740, height: 40 }) as DOMRect);
    const media = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('reduced-motion'),
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      startClaudeTimeline();
      await flush();

      queryDots()[1].click();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'instant' });
    } finally {
      window.matchMedia = media;
    }
  });
});
