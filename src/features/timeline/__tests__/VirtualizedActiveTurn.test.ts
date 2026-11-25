/**
 * The active marker on a virtualized host (#1116): unmounted turns keep a
 * centre from an older frame or 0, and must not steer the active search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineHomingPolicy } from '../TimelineAdapter';
import { TimelineNavigation, type TimelineNavigationMarker } from '../TimelineNavigation';

const userEvents = vi.hoisted(() => new WeakSet<Event>());
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: (event: Event) => userEvents.has(event) }));

const VIEW = 400;
const owners: TimelineNavigation[] = [];

/**
 * Turns centred at `centers`; a `null` entry is unmounted and keeps `stale` as
 * its remembered centre. The anchor line sits at scrollTop + 180.
 */
function fixture(centers: (number | null)[], stale: number[], homing?: TimelineHomingPolicy) {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientHeight', { value: VIEW });
  Object.defineProperty(viewport, 'scrollHeight', { value: 40_000 });
  viewport.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') viewport.scrollTop = options.top ?? 0;
  }) as never;
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, VIEW));
  document.body.appendChild(viewport);
  let staleIndex = 0;
  const markers: TimelineNavigationMarker[] = centers.map((center, index) => {
    const element = document.createElement('div');
    if (center === null) return { id: `t-${index}`, element, center: stale[staleIndex++] };
    viewport.appendChild(element);
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, center - 50 - viewport.scrollTop, 300, 100),
    );
    return { id: `t-${index}`, element };
  });
  const navigation = new TimelineNavigation({
    virtualized: true,
    homing,
    getMarkers: () => markers,
    getMarkerTops: () => [],
    getMarkerPositions: () => markers.map(() => 0),
    getTrackHeight: () => 100,
    refreshMarkers: () => false,
    resolveStoredId: (id) => id,
    onActiveChange: () => {},
    onScroll: () => {},
    animateRunner: () => {},
  });
  owners.push(navigation);
  navigation.setViewport(viewport);
  const scrollTo = (anchorLine: number) => {
    viewport.scrollTop = anchorLine - VIEW * 0.45;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(16);
  };
  return { navigation, viewport, markers, scrollTo };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const owner of owners.splice(0)) owner.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('virtualized active marker', () => {
  it('stays on the turn at the anchor when later turns are unmounted with older centres', () => {
    // Turn 4 is on the anchor; turns 5 and 6 left the DOM before older turns mounted above.
    const { navigation, scrollTo } = fixture(
      [10500, 11200, 11600, 12000, null, null],
      [3000, 6000],
    );
    scrollTo(12000);
    expect(navigation.activeTurnId).toBe('t-3');
    scrollTo(12100);
    expect(navigation.activeTurnId).toBe('t-3');
  });

  it('ignores never-mounted history turns, whose centre is 0', () => {
    const { navigation, scrollTo } = fixture([null, null, 900, 1300, 1700, null], [0, 0, 0]);
    scrollTo(1300);
    expect(navigation.activeTurnId).toBe('t-3');
    scrollTo(1650);
    expect(navigation.activeTurnId).toBe('t-4');
  });

  it('follows a scroll made while a jump held the clicked marker, once the hold ends', () => {
    const { navigation, viewport, scrollTo } = fixture([300, 700, 1100, 1500], []);
    scrollTo(300);
    navigation.navigateToMarker('t-3');
    expect(navigation.activeTurnId).toBe('t-3');
    // A person scrolls back during the hold; its scroll events are dropped.
    viewport.scrollTop = 700 - VIEW * 0.45;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(16);
    expect(navigation.activeTurnId).toBe('t-3');

    vi.advanceTimersByTime(1000);
    expect(navigation.activeTurnId).toBe('t-1');
  });

  it("cancels estimated homing on a person's wheel and shows where the view is", async () => {
    const { navigation, viewport, scrollTo } = fixture([null, 2000, 2400, 2800], [0], {
      mode: 'step',
      releaseWith: 'wheel',
    });
    scrollTo(2800);
    navigation.navigateToMarker('t-0');
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
    expect(navigation.activeTurnId).toBe('t-0');

    const wheel = new Event('wheel');
    userEvents.add(wheel);
    window.dispatchEvent(wheel);
    await vi.advanceTimersByTimeAsync(5000);
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
    expect(navigation.activeTurnId).not.toBe('t-0');
  });
});
