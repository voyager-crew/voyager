import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineStyle } from '@/core/types/common';
import { TimelineState } from '@/features/timeline/TimelineState';
import { createGeminiTimelineStoragePolicy } from '@/pages/content/timeline/GeminiTimelineStorage';

import { TimelineDotLayer } from '../TimelineDotLayer';
import { TimelineHierarchyGeometry } from '../TimelineHierarchyGeometry';

const fixtures: Array<{ layer: TimelineDotLayer; state: TimelineState }> = [];

function fixture(
  positions = [0, 0.5, 1],
  getActiveId: () => string | null = () => null,
  getStyle: () => TimelineStyle = () => 'dots',
) {
  const bar = document.createElement('div');
  const track = document.createElement('div');
  const content = document.createElement('div');
  bar.style.setProperty('--timeline-track-padding', '10');
  bar.style.setProperty('--timeline-min-gap', '20');
  Object.defineProperty(bar, 'clientHeight', { value: 100 });
  Object.defineProperty(track, 'clientHeight', { value: 100 });
  track.appendChild(content);
  bar.appendChild(track);
  document.body.appendChild(bar);
  history.replaceState({}, '', '/app/dot-layer');
  const state = new TimelineState(
    () => {},
    createGeminiTimelineStoragePolicy('https://gemini.google.com/app/dot-layer'),
  );
  state.replaceMarkers(
    positions.map((baseN, index) => ({
      id: `turn-${index}`,
      element: document.createElement('div'),
      summary: `Turn ${index}`,
      assistantSummary: '',
      baseN,
      starred: false,
    })),
  );
  const geometry = new TimelineHierarchyGeometry(
    () => state.markers,
    (id) => state.hierarchy.getMarkerLevel(id),
    (id) => state.hierarchy.isMarkerCollapsed(id),
  );
  const layer = new TimelineDotLayer(() => state.markers, geometry, {
    getStyle,
    getViewport: () => null,
    getActiveId,
  });
  fixtures.push({ layer, state });
  layer.mount(bar, track, content);
  return { layer, state, geometry, content, bar };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
});

afterEach(() => {
  fixtures.splice(0).forEach(({ layer, state }) => {
    layer.destroy();
    state.destroy();
  });
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimelineDotLayer', () => {
  it('keeps prepended history in keyboard order while preserving surviving focused dots', () => {
    const { layer, state, content } = fixture();
    layer.layout();
    layer.render();
    const surviving = content.querySelector<HTMLButtonElement>('[data-target-turn-id="turn-0"]')!;
    surviving.focus();
    state.replaceMarkers([
      { ...state.markers[0], id: 'older-turn', summary: 'Earlier turn', baseN: 0 },
      ...state.markers.map((marker, index) => ({ ...marker, baseN: (index + 1) / 3 })),
    ]);
    layer.layout();
    layer.render();
    expect(
      Array.from(
        content.querySelectorAll<HTMLElement>('.timeline-dot'),
        (dot) => dot.dataset.targetTurnId,
      ),
    ).toEqual(['older-turn', 'turn-0', 'turn-1', 'turn-2']);
    expect(content.querySelector('[data-target-turn-id="turn-0"]')).toBe(surviving);
    expect(document.activeElement).toBe(surviving);
  });

  it('announces the current turn both on render and after navigation changes', () => {
    let activeId: string | null = 'turn-0';
    const { layer, content } = fixture(undefined, () => activeId);
    layer.layout();
    layer.render();
    const current = () =>
      Array.from(
        content.querySelectorAll<HTMLElement>('[aria-current="true"]'),
        (dot) => dot.dataset.targetTurnId,
      );
    expect(current()).toEqual(['turn-0']);
    activeId = 'turn-2';
    layer.updateActive();
    expect(current()).toEqual(['turn-2']);
    activeId = null;
    layer.updateActive();
    expect(current()).toEqual([]);
  });

  it('spaces only visible markers after collapse and uses pixel tops when CSS cannot resolve them', async () => {
    const { layer, state, geometry, content } = fixture([0, 0.001, 0.002, 0.003, 0.004, 1]);
    await state.hierarchy.init();
    geometry.markerLevelEnabled = true;
    state.hierarchy.setMarkerLevel('turn-1', 2);
    state.hierarchy.setMarkerLevel('turn-2', 3);
    state.hierarchy.toggleCollapse('turn-0');

    layer.layout();
    layer.render();

    expect(layer.contentHeight).toBe(100);
    expect(layer.yPositions).toEqual([10, -1, -1, 30, 50, 90]);
    const dots = Array.from(content.querySelectorAll<HTMLElement>('.timeline-dot'));
    expect(dots.map((dot) => dot.dataset.targetTurnId)).toEqual([
      'turn-0',
      'turn-3',
      'turn-4',
      'turn-5',
    ]);
    expect(dots.map((dot) => dot.style.top)).toEqual(['10px', '30px', '50px', '90px']);
    expect(dots[0].getAttribute('aria-expanded')).toBe('false');

    state.hierarchy.toggleCollapse('turn-0');
    layer.layout();
    layer.render();

    expect(layer.contentHeight).toBe(120);
    expect(layer.yPositions).toEqual([10, 30, 50, 70, 90, 110]);
    expect(content.querySelectorAll('.timeline-dot')).toHaveLength(6);
    expect(content.querySelector('[data-target-turn-id="turn-0"]')).toBe(dots[0]);
  });

  it('collapsed turns close up the remaining compact ticks', async () => {
    const { layer, state, geometry, content } = fixture(
      [0, 0.3, 0.6, 1],
      () => null,
      () => 'compact',
    );
    const offsets = () =>
      Array.from(content.querySelectorAll<HTMLElement>('.timeline-dot'), (dot) =>
        Number.parseFloat(dot.style.getPropertyValue('--timeline-compact-offset')),
      );
    await state.hierarchy.init();
    geometry.markerLevelEnabled = true;
    state.hierarchy.setMarkerLevel('turn-1', 2);
    state.hierarchy.setMarkerLevel('turn-2', 2);
    layer.layout();
    layer.render();
    expect(offsets()).toEqual([-12, -4, 4, 12]);

    state.hierarchy.toggleCollapse('turn-0');
    layer.layout();
    layer.render();
    expect(offsets()).toEqual([-4, 4]);

    state.hierarchy.toggleCollapse('turn-0');
    layer.layout();
    layer.render();
    expect(offsets()).toEqual([-12, -4, 4, 12]);
  });

  it('replaces a running animation without letting the old jump move or hide the runner', () => {
    const { layer, content } = fixture();
    layer.layout();
    layer.startRunner(0, 2, 1000);
    vi.advanceTimersByTime(200);
    const runner = content.querySelector<HTMLElement>('.timeline-runner-ring')!;
    const oldPosition = runner.style.transform;

    layer.startRunner(2, 0, 100);
    expect(content.querySelectorAll('.timeline-runner-ring')).toHaveLength(1);
    expect(runner.style.transform).not.toBe(oldPosition);
    expect(runner.style.opacity).toBe('1');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(160);
    expect(runner.style.transform).toBe('translate3d(-50%, 0px, 0)');
    expect(runner.style.opacity).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(runner.style.transform).toBe('translate3d(-50%, 0px, 0)');
  });

  it('cancels pending runner frames on destroy so retained DOM cannot keep animating', () => {
    const { layer, content } = fixture();
    layer.layout();
    layer.startRunner(0, 2, 1000);
    vi.advanceTimersByTime(32);
    const runner = content.querySelector<HTMLElement>('.timeline-runner-ring')!;
    const position = runner.style.transform;
    expect(vi.getTimerCount()).toBe(1);

    layer.destroy();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(runner.style.transform).toBe(position);
    expect(vi.getTimerCount()).toBe(0);
  });
});
