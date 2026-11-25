import { isUserEvent } from '@/core/utils/userEvent';

import type { TimelineHomingPolicy } from './TimelineAdapter';
import type { TimelineNavigationMarker } from './TimelineNavigation';
import { type MeasuredCenter, nearestTurnId, searchableCenters } from './activeTurn';
import {
  DEFAULT_EDGE_PATIENCE_MS,
  DEFAULT_STALL_MS,
  type HomingEnd,
  type HomingRun,
  startHomingRun,
} from './homingRun';
import {
  afterScrollSettles,
  navigationScrollBehavior,
  readScrollOffset,
  releaseScrollPin,
  scrollElementToAnchor,
  scrollToCenter,
} from './scrollMotion';

type Dispose = () => void;

const ACTIVE_ANCHOR = 0.45;
const NAVIGATION_ACTIVE_LOCK_MS = 900;
const PENDING_NAVIGATION_TIMEOUT_MS = 8000;
const PENDING_NAVIGATION_HOP_MS = 200;
const LONG_JUMP_VIEWPORTS = 3;

type NavigationMarker = TimelineNavigationMarker;

export interface VirtualizedHomingOptions {
  readonly homing?: TimelineHomingPolicy;
  readonly locate?: (markerId: string) => HTMLElement | null;
  /** Whether a homing run is waiting for the host to load older turns. */
  readonly onHomingWait?: (waiting: boolean) => void;
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

  private measured: MeasuredCenter[] = [];
  private measuringPass = 0;
  private activeTurnId: string | null = null;
  private navigationActiveLockUntil = 0;
  private lockOffset = 0;
  private stopLockTimer: Dispose | null = null;
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
  private run: HomingRun | null = null;

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
    this.measured = [];
    this.activeTurnId = null;
    this.clearPendingNavigation();
    this.lastHandledHash = null;
  }

  /** Recompute the active turn outside the navigation lock; repaint an unchanged one. */
  refreshActive(): void {
    const previous = this.activeTurnId;
    this.updateActiveFromScroll();
    if (previous && previous === this.activeTurnId && this.markers.some((m) => m.id === previous))
      this.onActiveChange(previous, previous);
  }

  /**
   * Hold the clicked marker active while navigation moves the page. Scroll
   * events in the hold are dropped, so its expiry recomputes once if the page
   * moved since the hold began.
   */
  private holdActive(): void {
    this.navigationActiveLockUntil = Date.now() + NAVIGATION_ACTIVE_LOCK_MS;
    this.lockOffset = this.getScrollTop();
    void this.stopLockTimer?.();
    this.stopLockTimer = this.timer(() => {
      this.stopLockTimer = null;
      if (Math.abs(this.getScrollTop() - this.lockOffset) < 1) return;
      this.measure();
      this.updateActiveFromScroll();
    }, NAVIGATION_ACTIVE_LOCK_MS + 1);
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
    const id = nearestTurnId(this.measured, this.anchorLine());
    if (id) this.setActiveTurn(id);
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
    this.holdActive();
    this.setActiveTurn(marker.id);
    const live = this.liveElement(marker);
    const near =
      !!live &&
      Math.abs(this.centerOf(live) - this.anchorLine()) <=
        this.getViewportHeight() * LONG_JUMP_VIEWPORTS;
    if (this.homing.homing?.mode === 'step') {
      this.startRun(marker, near);
      return;
    }
    if (live) {
      const center = this.centerOf(live);
      if (near) {
        this.alignTarget(live);
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
    this.pendingNavigationUntil = Date.now() + PENDING_NAVIGATION_TIMEOUT_MS;
    this.pendingNavigationLo = 0;
    this.pendingNavigationHi = Math.max(
      this.getScrollHeight(),
      (marker.center ?? 0) + this.getViewportHeight(),
    );
    this.pendingNavigationProbed = false;
    this.listenForUserScroll();
  }

  private listenForUserScroll(): void {
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
    const run = this.run;
    this.run = null;
    void run?.stop();
    void this.stopPendingNavigationTimer?.();
    this.stopPendingNavigationTimer = null;
    for (const stop of this.stopUserScrollListeners.splice(0)) void stop();
  }

  private cancelPendingNavigationOnUserScroll = (event: Event): void => {
    // The pin release below dispatches wheels of its own; only a person's input cancels.
    if (!isUserEvent(event)) return;
    if (this.run) this.endRun('cancelled');
    else this.clearPendingNavigation();
  };

  /**
   * Estimated homing (`homing.mode: "step"`, `homingRun`): jump to the turn's
   * estimated place, wait for the host's DOM to answer, align once mounted.
   */
  private startRun(marker: NavigationMarker, glide: boolean): void {
    this.clearPendingNavigation();
    const target = this.scrollTarget;
    if (!target || this.disposed) return;
    const id = marker.id;
    const policy = this.homing.homing;
    const markerIndex = (): number => this.markers.findIndex((item) => item.id === id);
    const live = (): HTMLElement | null => {
      const item = this.markers[markerIndex()];
      return item ? this.liveElement(item) : null;
    };
    this.pendingNavigationId = id;
    this.listenForUserScroll();
    this.run = startHomingRun(
      {
        get targetIndex() {
          return markerIndex();
        },
        anchor: ACTIVE_ANCHOR,
        edgePatienceMs: policy?.edgePatienceMs ?? DEFAULT_EDGE_PATIENCE_MS,
        stallMs: policy?.stallMs ?? DEFAULT_STALL_MS,
        root: target instanceof HTMLElement ? target : document.body,
        scrollTarget: target,
        target: live,
        exists: () => markerIndex() >= 0,
        mounted: () => {
          const targetIndex = markerIndex();
          let inView = false;
          const turns = this.markers.flatMap((item, index) => {
            const element = index === targetIndex ? null : this.liveElement(item);
            if (!element) return [];
            inView ||= this.isElementInViewport(element);
            return [{ index, center: this.centerOf(element) }];
          });
          return { turns, inView };
        },
        geometry: () => ({
          offset: this.getScrollTop(),
          viewportHeight: this.getViewportHeight(),
          scrollHeight: this.getScrollHeight(),
        }),
        jumpTo: (center) => this.scrollCenterTo(center, 'instant'),
        align: (element, behavior) =>
          behavior === 'smooth'
            ? this.alignElement(element)
            : this.scrollCenterTo(this.centerOf(element), 'instant'),
        offAnchor: (element) => this.centerOf(element) - this.anchorLine(),
        holdActive: () => this.holdActive(),
        onWaiting: (waiting) => this.homing.onHomingWait?.(waiting),
        onEnd: (reason) => this.endRun(reason),
      },
      glide,
    );
  }

  /** An arrival keeps the clicked marker; any other end shows where the page is. */
  private endRun(reason: HomingEnd): void {
    this.clearPendingNavigation();
    if (reason === 'arrived') {
      this.lockOffset = this.getScrollTop();
      return;
    }
    this.navigationActiveLockUntil = 0;
    this.measure();
    this.updateActiveFromScroll();
  }

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

  private alignTarget(live: HTMLElement): void {
    this.clearPendingNavigation();
    this.alignElement(live);
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
    this.holdActive();
    const live = this.liveElement(marker);
    if (live) {
      this.alignTarget(live);
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
    for (const marker of this.markers) {
      if (!marker.element.isConnected) continue;
      marker.center = this.centerOf(marker.element, scrollTop, viewportTop);
      marker.measuredAt = pass;
    }
    this.measured = searchableCenters(this.markers, pass);
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
