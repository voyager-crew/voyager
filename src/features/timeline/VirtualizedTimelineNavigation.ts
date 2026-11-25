import { isUserEvent } from '@/core/utils/userEvent';

import type { TimelineHomingPolicy } from './TimelineAdapter';
import type { TimelineNavigationMarker } from './TimelineNavigation';
import {
  afterScrollSettles,
  navigationScrollBehavior,
  readScrollOffset,
  releaseScrollPin,
  scrollElementToAnchor,
  scrollToCenter,
} from './scrollMotion';
import {
  type StepProgress,
  alignmentSettled,
  newStepProgress,
  nextSteppedHop,
} from './steppedHomingRun';

type Dispose = () => void;

const ACTIVE_ANCHOR = 0.45;
const NAVIGATION_ACTIVE_LOCK_MS = 900;
const PENDING_NAVIGATION_TIMEOUT_MS = 8000;
const PENDING_NAVIGATION_HOP_MS = 200;
const LONG_JUMP_VIEWPORTS = 3;
/** Stepping crosses a long conversation a bounded step at a time, so it gets longer. */
const STEPPED_NAVIGATION_TIMEOUT_MS = 20000;
/** After an align, wait for layout to settle, then re-align a target still off the anchor. */
const STEPPED_ALIGN_SETTLE_MS = 300;

type NavigationMarker = TimelineNavigationMarker;

export interface VirtualizedHomingOptions {
  readonly homing?: TimelineHomingPolicy;
  readonly locate?: (markerId: string) => HTMLElement | null;
}

/** Owns scroll geometry, active selection and timed homing for the current marker list. */
export class VirtualizedTimelineNavigation {
  private destroyed = false;
  private readonly lifetime = new AbortController();
  private readonly timers = new Set<number>();

  private on(
    target: EventTarget,
    name: string,
    listener: (event: Event) => void,
    options: AddEventListenerOptions = {},
  ): Dispose {
    target.addEventListener(name, listener, { ...options, signal: this.lifetime.signal });
    return () => target.removeEventListener(name, listener);
  }

  private timer(run: () => void, ms: number): Dispose {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) run();
    }, ms);
    this.timers.add(id);
    return () => {
      window.clearTimeout(id);
      this.timers.delete(id);
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.lifetime.abort();
    this.clearPendingNavigation();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.scrollTarget = null;
  }

  private markerCenters: number[] = [];
  private measuringPass = 0;
  private activeTurnId: string | null = null;
  private navigationActiveLockUntil = 0;
  private pendingNavigationId: string | null = null;
  private pendingNavigationUntil = 0;
  private stopPendingNavigationTimer: Dispose | null = null;
  private stopUserScrollListeners: Dispose[] = [];
  private pendingNavigationLo = 0;
  private pendingNavigationHi = 0;
  private pendingNavigationProbed = false;
  private lastHandledHash: string | null = null;
  private scrollTarget: HTMLElement | Window | null = null;
  private stopScrollListener: Dispose | null = null;
  private step: StepProgress | null = null;

  constructor(
    private readonly getViewport: () => HTMLElement | null,
    private readonly getMarkers: () => readonly NavigationMarker[],
    private readonly onActiveChange: (turnId: string | null, previousTurnId: string | null) => void,
    private readonly homing: VirtualizedHomingOptions = {},
  ) {}

  /** The marker's element, or the one the host mounted for it since the last marker read. */
  private liveElement(marker: NavigationMarker): HTMLElement | null {
    if (marker.element.isConnected) return marker.element;
    return this.homing.locate?.(marker.id) ?? null;
  }

  private get markers(): readonly NavigationMarker[] {
    return this.getMarkers();
  }

  private get disposed(): boolean {
    return this.destroyed;
  }

  get activeId(): string | null {
    return this.activeTurnId;
  }

  /** Establish the coordinate frame before marker merging reads any centers. */
  prepare(element: HTMLElement): void {
    this.setScrollTarget(this.getScrollTarget(element));
  }

  /** Route resets retain the scroll target, measuring epoch and navigation lock. */
  reset(): void {
    this.markerCenters = [];
    this.activeTurnId = null;
    this.clearPendingNavigation();
    this.lastHandledHash = null;
  }

  refreshActive(): void {
    if (this.activeTurnId && this.markers.some((marker) => marker.id === this.activeTurnId)) {
      this.onActiveChange(this.activeTurnId, this.activeTurnId);
      return;
    }
    this.updateActiveFromScroll();
  }

  private setActiveTurn(turnId: string | null): void {
    if (this.activeTurnId === turnId) return;
    const previousTurnId = this.activeTurnId;
    this.activeTurnId = turnId;
    this.onActiveChange(turnId, previousTurnId);
  }

  private updateActiveFromScroll = (): void => {
    if (!this.markers.length) {
      this.setActiveTurn(null);
      return;
    }
    if (Date.now() < this.navigationActiveLockUntil) return;
    if (this.isAtScrollBottom()) {
      this.setActiveTurn(this.markers[this.markers.length - 1]?.id ?? null);
      return;
    }
    const ref = this.getScrollTop() + this.getViewportHeight() * ACTIVE_ANCHOR;
    let low = 0;
    let high = this.markerCenters.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.markerCenters[mid] <= ref) low = mid + 1;
      else high = mid;
    }
    const previous = Math.max(0, low - 1);
    const next = Math.min(this.markerCenters.length - 1, low);
    const index =
      Math.abs(this.markerCenters[next] - ref) < Math.abs(this.markerCenters[previous] - ref)
        ? next
        : previous;
    this.setActiveTurn(this.markers[index]?.id ?? null);
  };

  private setScrollTarget(target: HTMLElement | Window | null): void {
    if (this.scrollTarget === target) return;
    void this.stopScrollListener?.();
    this.stopScrollListener = null;
    this.scrollTarget = target;
    if (target && !this.disposed) {
      this.stopScrollListener = this.on(target, 'scroll', this.updateActiveFromScroll, {
        passive: true,
      });
    }
  }

  private findMarker(turnId: string): NavigationMarker | undefined {
    return (
      this.markers.find((item) => item.id === turnId) ??
      this.markers.find((item) => item.hash === turnId.split('~')[0].split('-').pop())
    );
  }

  navigateTo(turnId: string): void {
    const marker = this.findMarker(turnId);
    if (!marker) return;
    this.navigationActiveLockUntil = Date.now() + NAVIGATION_ACTIVE_LOCK_MS;
    this.setActiveTurn(marker.id);
    const live = this.liveElement(marker);
    if (live) {
      const center = this.centerOf(live);
      const anchorOffset = this.getViewportHeight() * ACTIVE_ANCHOR;
      const distance = Math.abs(center - (this.getScrollTop() + anchorOffset));
      if (distance <= this.getViewportHeight() * LONG_JUMP_VIEWPORTS) {
        this.clearPendingNavigation();
        this.alignTarget(marker, live);
        return;
      }
      // Long jump to a mounted turn: Claude re-measures once the landing region
      // mounts, so the homing loop still fine-aims — after the scroll settles,
      // never into one still travelling. See scrollMotion.ts.
      this.beginPendingNavigation(marker);
      this.pendingNavigationProbed = true;
      const hop = (): void => this.schedulePendingNavigationHop();
      const behavior = navigationScrollBehavior();
      this.scrollCenterTo(center, behavior);
      if (behavior !== 'smooth') hop();
      else {
        const timer = (run: () => void, ms: number): void => void this.timer(run, ms);
        afterScrollSettles(
          () => this.getScrollTop(),
          timer,
          () => this.disposed,
          hop,
        );
      }
      return;
    }
    // Virtualized out: the remembered offset is only an estimate (Claude
    // re-measures content as it mounts), so home in iteratively instead of
    // trusting a single jump.
    this.beginPendingNavigation(marker);
    this.homePendingNavigation();
  }

  private beginPendingNavigation(marker: NavigationMarker): void {
    this.clearPendingNavigation();
    this.pendingNavigationId = marker.id;
    this.pendingNavigationUntil =
      Date.now() +
      (this.homing.homing?.mode === 'step'
        ? STEPPED_NAVIGATION_TIMEOUT_MS
        : PENDING_NAVIGATION_TIMEOUT_MS);
    this.step = newStepProgress();
    this.pendingNavigationLo = 0;
    this.pendingNavigationHi = Math.max(
      this.getScrollHeight(),
      (marker.center ?? 0) + this.getViewportHeight(),
    );
    this.pendingNavigationProbed = false;
    if (this.disposed) return;
    this.stopUserScrollListeners = [
      this.on(window, 'wheel', this.cancelPendingNavigationOnUserScroll, { passive: true }),
      this.on(window, 'touchmove', this.cancelPendingNavigationOnUserScroll, {
        passive: true,
      }),
    ];
  }

  private clearPendingNavigation(): void {
    this.pendingNavigationId = null;
    this.step = null;
    void this.stopPendingNavigationTimer?.();
    this.stopPendingNavigationTimer = null;
    for (const stop of this.stopUserScrollListeners.splice(0)) void stop();
  }

  private cancelPendingNavigationOnUserScroll = (event: Event): void => {
    // The pin release below dispatches wheels of its own; only a person's input cancels.
    if (isUserEvent(event)) this.clearPendingNavigation();
  };

  private anchorLine(): number {
    return this.getScrollTop() + this.getViewportHeight() * ACTIVE_ANCHOR;
  }

  private releasePin(delta: number): void {
    if (this.homing.homing?.releaseWith === 'wheel') releaseScrollPin(this.scrollTarget, delta);
  }

  private alignElement(element: HTMLElement): void {
    this.releasePin(this.centerOf(element) - this.anchorLine());
    scrollElementToAnchor(
      this.getScrollTarget(element),
      element,
      this.getScrollTop(),
      this.getViewportHeight(),
    );
  }

  /**
   * Aim at a mounted target. Stepped homing then checks it once layout has
   * settled: a host that measures turns as they mount moves it after the
   * scroll, so a target still off the anchor is aimed again, a few times.
   */
  private alignTarget(marker: NavigationMarker, live: HTMLElement): void {
    if (this.homing.homing?.mode !== 'step') {
      this.clearPendingNavigation();
      this.alignElement(live);
      return;
    }
    if (this.pendingNavigationId !== marker.id) this.beginPendingNavigation(marker);
    const progress = this.step;
    if (!progress) return;
    progress.aligns += 1;
    const before = this.getScrollTop();
    this.alignElement(live);
    const id = marker.id;
    const stale = (): boolean => this.disposed || this.pendingNavigationId !== id;
    afterScrollSettles(
      () => this.getScrollTop(),
      (run, ms) => void this.timer(run, ms),
      stale,
      () =>
        void this.timer(() => {
          if (!stale()) this.verifyAlignment(marker, before);
        }, STEPPED_ALIGN_SETTLE_MS),
    );
  }

  private verifyAlignment(marker: NavigationMarker, before: number): void {
    const progress = this.step;
    if (!progress) return;
    const live = this.liveElement(marker);
    if (!live) {
      // Unmounted again while settling: home in once more.
      this.schedulePendingNavigationHop();
      return;
    }
    if (
      alignmentSettled({
        offFromAnchor: Math.abs(this.centerOf(live) - this.anchorLine()),
        viewportHeight: this.getViewportHeight(),
        // A scroll edge can stop the target short of the anchor; in view is then the best place.
        scrollerMoved: Math.abs(this.getScrollTop() - before) >= 1,
        inViewport: this.isElementInViewport(live),
        aligns: progress.aligns,
      })
    ) {
      this.clearPendingNavigation();
      return;
    }
    this.navigationActiveLockUntil = Date.now() + NAVIGATION_ACTIVE_LOCK_MS;
    this.alignTarget(marker, live);
  }

  private scrollCenterTo(center: number, behavior: ScrollBehavior): void {
    this.releasePin(center - this.anchorLine());
    scrollToCenter(this.scrollTarget, center, this.getViewportHeight(), behavior);
  }

  /**
   * One homing step toward a virtualized-out turn: bisect on the target's
   * position (bounds tightened from which side of the mounted window the turn
   * sits on), jump instantly, and let Claude mount content at the landing
   * point. Once the turn's element is back in the DOM, aim precisely.
   */
  private homePendingNavigation = (): void => {
    this.stopPendingNavigationTimer = null;
    if (!this.pendingNavigationId || this.disposed) return;
    if (Date.now() > this.pendingNavigationUntil) {
      this.clearPendingNavigation();
      return;
    }
    const marker = this.markers.find((item) => item.id === this.pendingNavigationId);
    if (!marker) {
      this.clearPendingNavigation();
      return;
    }
    this.navigationActiveLockUntil = Date.now() + NAVIGATION_ACTIVE_LOCK_MS;
    const live = this.liveElement(marker);
    if (live) {
      this.alignTarget(marker, live);
      return;
    }
    if (this.homing.homing?.mode === 'step') {
      this.stepPendingNavigation(marker);
      return;
    }
    const mountedIndexes = this.markers.reduce<number[]>((acc, item, index) => {
      if (item.element.isConnected) acc.push(index);
      return acc;
    }, []);
    if (mountedIndexes.length) {
      // Direction info is only trustworthy once the mounted window has caught
      // up with the last jump; otherwise wait a tick instead of moving.
      const windowCurrent = mountedIndexes.some((index) =>
        this.isElementInViewport(this.markers[index].element),
      );
      if (!windowCurrent) {
        this.schedulePendingNavigationHop();
        return;
      }
      const targetIndex = this.markers.indexOf(marker);
      const firstMounted = mountedIndexes[0];
      const lastMounted = mountedIndexes[mountedIndexes.length - 1];
      if (targetIndex < firstMounted) {
        this.pendingNavigationHi = Math.min(this.pendingNavigationHi, this.getScrollTop());
      } else if (targetIndex > lastMounted) {
        this.pendingNavigationLo = Math.max(
          this.pendingNavigationLo,
          this.getScrollTop() + this.getViewportHeight(),
        );
      } else {
        // Inside a virtualization gap: bracket the target between its nearest
        // mounted neighbours. (A truly deleted turn collapses the bracket and
        // ends the search below.)
        let beforeIndex = -1;
        let afterIndex = -1;
        for (const index of mountedIndexes) {
          if (index < targetIndex) beforeIndex = index;
          else if (index > targetIndex) {
            afterIndex = index;
            break;
          }
        }
        if (beforeIndex >= 0) {
          this.pendingNavigationLo = Math.max(
            this.pendingNavigationLo,
            this.centerOf(this.markers[beforeIndex].element),
          );
        }
        if (afterIndex >= 0) {
          this.pendingNavigationHi = Math.min(
            this.pendingNavigationHi,
            this.centerOf(this.markers[afterIndex].element),
          );
        }
      }
    }
    if (this.pendingNavigationHi - this.pendingNavigationLo < 1) {
      this.clearPendingNavigation();
      return;
    }
    const staleCenterUsable =
      !this.pendingNavigationProbed &&
      (marker.center ?? 0) > this.pendingNavigationLo &&
      (marker.center ?? 0) < this.pendingNavigationHi;
    const probe = staleCenterUsable
      ? (marker.center ?? 0)
      : (this.pendingNavigationLo + this.pendingNavigationHi) / 2;
    this.pendingNavigationProbed = true;
    this.scrollCenterTo(probe, 'instant');
    this.schedulePendingNavigationHop();
  };

  /**
   * One bounded step toward an unmounted turn on a host that reserves no
   * height for it (`steppedHoming`). Never a far jump: the host snaps those
   * back. Ends when the turn mounts (aligned above), on timeout, or when
   * steps stop moving the scroller or mounting anything.
   */
  private stepPendingNavigation(marker: NavigationMarker): void {
    const progress = this.step;
    if (!progress) return;
    const hop = nextSteppedHop(progress, this.markers, marker, {
      offset: this.getScrollTop(),
      viewportHeight: this.getViewportHeight(),
      scrollHeight: this.getScrollHeight(),
      anchor: ACTIVE_ANCHOR,
      now: Date.now(),
      liveElement: (item) => this.liveElement(item),
      inViewport: (element) => this.isElementInViewport(element),
      centerOf: (element) => this.centerOf(element),
    });
    if (hop.kind === 'stop') {
      this.clearPendingNavigation();
      return;
    }
    if (hop.kind === 'scroll') this.scrollCenterTo(hop.center, 'instant');
    this.schedulePendingNavigationHop();
  }

  private schedulePendingNavigationHop(): void {
    if (this.stopPendingNavigationTimer !== null || this.disposed) return;
    this.stopPendingNavigationTimer = this.timer(
      this.homePendingNavigation,
      PENDING_NAVIGATION_HOP_MS,
    );
  }

  private isElementInViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const top = this.getViewportTop();
    const bottom = top + this.getViewportHeight();
    return rect.bottom >= top && rect.top <= bottom;
  }

  handleHash = (): void => {
    const hash = location.hash;
    if (!hash.startsWith('#gv-turn-') || hash === this.lastHandledHash) return;
    const turnId = decodeURIComponent(hash.slice('#gv-turn-'.length));
    if (!turnId) return;
    const marker = this.findMarker(turnId);
    // Not discovered yet (virtualized out and never mounted): leave the hash
    // unconsumed so later refreshes retry once the turn appears.
    if (!marker) return;
    this.lastHandledHash = hash;
    this.navigateTo(marker.id);
  };

  private getScrollTarget(_element: HTMLElement): HTMLElement | Window {
    const viewport = this.getViewport();
    return viewport && viewport !== document.documentElement && viewport !== document.body
      ? viewport
      : window;
  }

  measure(): void {
    const scrollTop = this.getScrollTop();
    const viewportTop = this.getViewportTop();
    const pass = ++this.measuringPass;
    const centers: number[] = [];
    for (const marker of this.markers) {
      if (marker.element.isConnected) {
        marker.center = this.centerOf(marker.element, scrollTop, viewportTop);
        marker.measuredAt = pass;
      }
      // Keep the array monotonic for the active-turn binary search: stale
      // centers of virtualized-out turns can lag behind re-measured neighbours.
      const previous = centers[centers.length - 1];
      centers.push(
        previous !== undefined && (marker.center ?? 0) < previous ? previous : (marker.center ?? 0),
      );
    }
    this.markerCenters = centers;
  }

  centerOf(
    element: HTMLElement,
    scrollTop = this.getScrollTop(),
    viewportTop = this.getViewportTop(),
  ): number {
    const rect = element.getBoundingClientRect();
    return scrollTop + rect.top - viewportTop + rect.height / 2;
  }

  private getViewportTop(): number {
    return this.scrollTarget && this.scrollTarget !== window
      ? (this.scrollTarget as HTMLElement).getBoundingClientRect().top
      : 0;
  }

  /** Offset from the conversation's start, also on a `column-reverse` scroller. */
  private getScrollTop(): number {
    return readScrollOffset(this.scrollTarget);
  }

  private getViewportHeight(): number {
    return this.scrollTarget && this.scrollTarget !== window
      ? (this.scrollTarget as HTMLElement).clientHeight
      : window.innerHeight || document.documentElement.clientHeight || 0;
  }

  private getScrollHeight(): number {
    return this.scrollTarget && this.scrollTarget !== window
      ? (this.scrollTarget as HTMLElement).scrollHeight
      : (document.scrollingElement || document.documentElement).scrollHeight;
  }

  private isAtScrollBottom(): boolean {
    const viewportHeight = this.getViewportHeight();
    const scrollHeight = this.getScrollHeight();
    return (
      scrollHeight > viewportHeight && this.getScrollTop() + viewportHeight >= scrollHeight - 2
    );
  }
}
