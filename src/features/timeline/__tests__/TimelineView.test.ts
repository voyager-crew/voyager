import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineStyle } from '@/core/types/common';
import { TimelineState } from '@/features/timeline/TimelineState';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';
import { beforePaints, injectStylesheets } from '@/tests/pseudoElementPaint';

import { TimelineHierarchyGeometry } from '../TimelineHierarchyGeometry';
import { TimelineView } from '../TimelineView';

const views: TimelineView[] = [];

function fixture(
  count = 2,
  options: { mountAnchor?: HTMLElement; storagePrefix?: string; position?: 'left' | 'right' } = {},
) {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientHeight', { value: 400 });
  const state = new TimelineState(() => {}, createGeminiTimelineStoragePolicy());
  state.replaceMarkers(
    Array.from({ length: count }, (_, index) => ({
      id: `s-${index}`,
      element: document.createElement('div'),
      summary: `Turn ${index}`,
      assistantSummary: '',
      baseN: index / Math.max(1, count - 1),
      starred: false,
    })),
  );
  const onResize = vi.fn();
  const geometry = new TimelineHierarchyGeometry(
    () => state.markers,
    (id) => state.hierarchy.getMarkerLevel(id),
    (id) => state.hierarchy.isMarkerCollapsed(id),
  );
  const view = new TimelineView(state, geometry, {
    ...options,
    getViewport: () => viewport,
    getActiveId: () => null,
    navigate: vi.fn(),
    search: vi.fn(),
    onStyleChange: vi.fn(),
    onResize,
  });
  views.push(view);
  view.mount();
  const { timelineBar: bar, track, trackContent, sliderHandle: handle } = view.ui;
  Object.defineProperty(bar, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(track, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(bar, 'setPointerCapture', { value: vi.fn() });
  Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
  vi.spyOn(bar!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 24, 400));
  state.markers.forEach((marker, index) => {
    Object.defineProperty(marker.element, 'offsetTop', {
      value: (index / Math.max(1, count - 1)) * 1000,
    });
  });
  view.measureMarkers(state.markers.map((marker) => marker.element));
  view.render();
  return {
    view,
    state,
    viewport,
    bar: bar!,
    track: track!,
    trackContent: trackContent!,
    handle: handle!,
    onResize,
  };
}

function pointer(type: string, clientX = 0, clientY = 0) {
  return new MouseEvent(type, { bubbles: true, clientX, clientY });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
});

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TimelineView', () => {
  it('owns its injected stylesheet and mounts controls in the requested anchor', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const { view, bar } = fixture(2, { mountAnchor: anchor });
    expect(bar.parentElement).toBe(anchor);
    expect(view.ui.slider?.parentElement).toBe(anchor);
    expect(anchor.querySelector('.timeline-preview-toggle')).not.toBeNull();
    const style = document.head.querySelector('[data-gv-timeline]');
    expect(style).not.toBeNull();
    view.destroy();
    expect(style?.isConnected).toBe(false);
    expect(anchor.children).toHaveLength(0);
  });

  it('persists plugin placement without changing Gemini placement keys', () => {
    const { view, bar } = fixture(2, { storagePrefix: 'claudeTimeline' });
    bar.dispatchEvent(pointer('pointerdown', 110));
    window.dispatchEvent(pointer('pointermove', 122));
    window.dispatchEvent(pointer('pointercancel'));
    view.placement.restorePosition({ top: 50, left: 100 });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ claudeTimelineBarWidth: 20 });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      claudeTimelinePosition: expect.objectContaining({ version: 2 }),
    });
    for (const [saved] of vi.mocked(chrome.storage.sync.set).mock.calls) {
      expect(saved).not.toHaveProperty('geminiTimelineBarWidth');
      expect(saved).not.toHaveProperty('geminiTimelinePosition');
    }
  });

  it('places the slider and preview inside the viewport beside an explicit left rail', () => {
    const { view, bar } = fixture(80, { position: 'left' });
    expect(bar.style.left).toBe('15px');
    expect(view.ui.slider?.style.left).toBe('132px');
    view.previewPanel?.open();
    const panel = document.querySelector<HTMLElement>('.timeline-preview-panel');
    expect(panel?.style.left).toBe('136px');
    expect(panel?.getAttribute('dir')).toBe('ltr');
  });

  it('keeps plugin preview and slider inside the viewport after switching to RTL', () => {
    const { view } = fixture(80, { position: 'right' });
    view.applyRTLUpdate('ar');
    expect(view.ui.slider?.style.left).toBe('132px');
    view.previewPanel?.open();
    expect(document.querySelector<HTMLElement>('.timeline-preview-panel')?.style.left).toBe(
      '136px',
    );
    view.applyRTLUpdate('en');
  });

  it('starts with the thinnest visual bar width without a saved width', () => {
    const { view, bar } = fixture();
    view.applyContainerVisibility();
    expect(view.placement.barWidth).toBe(view.placement.barWidthMin);
    expect(bar.style.getPropertyValue('--timeline-bar-width')).toBe('4px');
  });

  describe('rail film', () => {
    let removeStyles: () => void;
    beforeEach(() => {
      removeStyles = injectStylesheets('src/features/timeline/timeline.css');
    });
    afterEach(() => removeStyles());

    function show(view: TimelineView, style: TimelineStyle, hideContainer: boolean): void {
      view.timelineStyle = style;
      view.applyTimelineStyle();
      view.hideContainer = hideContainer;
      view.applyContainerVisibility();
    }

    it('unchecking hide outer container brings back the dots rail', () => {
      const { view, bar } = fixture();
      show(view, 'dots', false);
      expect(beforePaints(bar)).toBe(true);
      show(view, 'dots', true);
      expect(beforePaints(bar)).toBe(false);
      show(view, 'dots', false);
      expect(beforePaints(bar)).toBe(true);
    });

    it.each(['ruler', 'compact'] as const)(
      'the %s timeline paints no rail whether or not the outer container is hidden',
      (style) => {
        const { view, bar } = fixture();
        show(view, style, false);
        expect(beforePaints(bar)).toBe(false);
        show(view, style, true);
        expect(beforePaints(bar)).toBe(false);
        // The stored setting still applies on the way back to dots.
        show(view, 'dots', true);
        expect(beforePaints(bar)).toBe(false);
      },
    );
  });

  it('compact ticks stay centred as turns are added and removed', () => {
    const { view, state, trackContent } = fixture(3);
    view.timelineStyle = 'compact';
    view.applyTimelineStyle();
    const offsets = () =>
      Array.from(trackContent.querySelectorAll<HTMLElement>('.timeline-dot'), (dot) =>
        Number.parseFloat(dot.style.getPropertyValue('--timeline-compact-offset')),
      );
    expect(offsets()).toEqual([-8, 0, 8]);

    state.replaceMarkers([...state.markers, { ...state.markers[2], id: 'new-turn', baseN: 1 }]);
    view.render();
    expect(offsets()).toEqual([-12, -4, 4, 12]);

    state.replaceMarkers(state.markers.slice(0, 1));
    view.render();
    expect(offsets()).toEqual([0]);

    state.replaceMarkers([]);
    view.render();
    expect(offsets()).toEqual([]);
  });

  it.each(['left', 'right'] as const)(
    'resizing the %s compact rail keeps its ticks centred',
    (position) => {
      const { view, bar, track, trackContent } = fixture(60, { position });
      view.applyRTLUpdate('ar');
      view.timelineStyle = 'compact';
      view.applyTimelineStyle();
      const dots = (): HTMLElement[] =>
        Array.from(trackContent.querySelectorAll<HTMLElement>('.timeline-dot'));
      const ends = (): string[] => [dots()[0].style.top, dots().at(-1)!.style.top];
      // 60 ticks spread over the 400 px rail less its 12 px padding on each side.
      expect(ends()).toEqual(['calc(50% - 188px)', 'calc(50% + 188px)']);

      Object.defineProperty(bar, 'clientHeight', { value: 240, configurable: true });
      Object.defineProperty(track, 'clientHeight', { value: 240, configurable: true });
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(140);
      expect(ends()).toEqual(['calc(50% - 108px)', 'calc(50% + 108px)']);
      view.applyRTLUpdate('en');
    },
  );

  it('moves the runner with a compositor transform and reads the spring profile once', () => {
    const { view, trackContent } = fixture();
    const getItem = vi.spyOn(localStorage, 'getItem').mockReturnValue('ios');
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

    view.startRunner(0, 1, 600);
    const runner = trackContent.querySelector<HTMLElement>('.timeline-runner-ring')!;
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(runner.style.top).toBe('0px');
    expect(runner.style.transform).toMatch(/^translate3d\(-50%, /);
    expect(runner.style.willChange).toBe('transform, opacity');

    const start = runner.style.transform;
    vi.advanceTimersByTime(320);
    expect(runner.style.transform).not.toBe(start);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('updates the slider from scroll position without remeasuring geometry', () => {
    const { view, track, trackContent, handle } = fixture(80);
    const range = parseFloat(trackContent.style.height) - 400;
    track.scrollTop = range / 2;
    const measure = vi.spyOn(handle, 'getBoundingClientRect');
    view.updateSliderPosition();
    expect(measure).not.toHaveBeenCalled();
    expect(handle.style.top).toBe('79px');
  });

  it('ends bar-width resize on pointercancel and releases the move listener', () => {
    const { view, bar } = fixture();
    bar.dispatchEvent(pointer('pointerdown', 110));
    expect(bar.classList.contains('timeline-resizing')).toBe(true);
    window.dispatchEvent(pointer('pointermove', 122));
    expect(view.placement.barWidth).toBe(20);

    window.dispatchEvent(pointer('pointercancel'));
    expect(bar.classList.contains('timeline-resizing')).toBe(false);
    window.dispatchEvent(pointer('pointermove', 100));
    expect(view.placement.barWidth).toBe(20);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ geminiTimelineBarWidth: 20 });
  });

  it('resumes scroll synchronization after a slider pointercancel', () => {
    const { view, viewport, track, handle } = fixture(80);
    handle.dispatchEvent(pointer('pointerdown', 0, 80));
    const heldTop = track.scrollTop;
    viewport.scrollTop = 700;
    view.syncTimelineTrackToMain();
    expect(track.scrollTop).toBe(heldTop);

    window.dispatchEvent(pointer('pointercancel'));
    view.syncTimelineTrackToMain();
    expect(track.scrollTop).toBeGreaterThan(heldTop);
    const releasedTop = track.scrollTop;
    window.dispatchEvent(pointer('pointermove', 0, 200));
    expect(track.scrollTop).toBe(releasedTop);
  });

  it('ends bar position drag on pointercancel and releases the move listener', () => {
    const { view, bar } = fixture();
    view.toggleDraggable(true);
    bar.dispatchEvent(pointer('pointerdown', 101, 50));
    window.dispatchEvent(pointer('pointermove', 131, 80));
    expect(bar.style.left).toBe('130px');
    expect(bar.style.top).toBe('80px');

    window.dispatchEvent(pointer('pointercancel'));
    window.dispatchEvent(pointer('pointermove', 141, 90));
    expect(bar.style.left).toBe('130px');
    expect(bar.style.top).toBe('80px');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      geminiTimelinePosition: expect.objectContaining({ version: 2 }),
    });
  });

  it('reapplies the cached position without reading storage', () => {
    const { view, bar } = fixture();
    view.placement.savedPosition = { version: 2, topPercent: 10, leftPercent: 20 };
    view.reapplyPosition();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(bar.style.top).toBe(`${window.innerHeight * 0.1}px`);
    expect(bar.style.left).toBe(`${window.innerWidth * 0.2}px`);
  });

  it('leaves the CSS position alone when no position is cached', () => {
    const { view, bar } = fixture();
    view.reapplyPosition();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(bar.style.top).toBe('');
    expect(bar.style.left).toBe('');
  });

  it('shares one trailing resize debounce and cancels pending work on destroy', () => {
    const visualViewport = new EventTarget();
    vi.stubGlobal('visualViewport', visualViewport);
    const { view, bar, onResize } = fixture();
    view.placement.savedPosition = { version: 2, topPercent: 10, leftPercent: 20 };
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(70);
    visualViewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(139);
    expect(onResize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(bar.style.top).toBe(`${window.innerHeight * 0.1}px`);
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();

    visualViewport.dispatchEvent(new Event('resize'));
    view.destroy();
    vi.advanceTimersByTime(140);
    window.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(140);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases pointer listeners so detached controls cannot restart work after destroy', () => {
    const { view, bar, handle } = fixture();
    const slider = view.ui.slider!;
    view.toggleDraggable(true);
    view.destroy();
    expect(vi.getTimerCount()).toBe(0);
    const addListener = vi.spyOn(window, 'addEventListener');
    const oldPosition = bar.style.cssText;
    for (const element of [bar, slider, handle]) {
      element.dispatchEvent(pointer('pointerenter', 110, 50));
      element.dispatchEvent(pointer('pointerdown', 110, 50));
      element.dispatchEvent(pointer('pointermove', 122, 70));
      element.dispatchEvent(pointer('pointerleave', 122, 70));
    }
    window.dispatchEvent(pointer('pointermove', 140, 100));
    expect(addListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(bar.style.cssText).toBe(oldPosition);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});
