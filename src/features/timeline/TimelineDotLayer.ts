import type { TimelineStyle } from '@/core/types/common';

import type { TimelineHierarchyGeometry } from './TimelineHierarchyGeometry';
import { getTimelineSpringProfile } from './TimelineNavigation';
import type { AnnotationRail } from './annotationPlacement';
import { denseMarkerOffsets, rulerWaveTick } from './denseMarkerLayout';
import type { DotElement, TimelineMarker } from './types';

/** Owns measured marker positions, keyed dot rendering and the runner lifetime. */
export class TimelineDotLayer {
  private runnerRing: HTMLElement | null = null;

  private runnerAnimationGeneration = 0;

  contentHeight = 0;

  yPositions: number[] = [];

  markerTops: number[] = [];

  private visibleRange: { start: number; end: number } = { start: 0, end: -1 };

  private usePixelTop = false;

  private _cssVarTopSupported: boolean | null = null;
  private readonly dots = new Map<string, DotElement>();
  private normalizedPositions: number[] = [];
  private destroyed = false;
  private runnerRaf: number | null = null;
  private bar: HTMLElement | null = null;
  private track: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  constructor(
    private readonly getMarkers: () => TimelineMarker[],
    private readonly geometry: TimelineHierarchyGeometry,
    private readonly options: {
      getStyle: () => TimelineStyle;
      getViewport: () => HTMLElement | null;
      getActiveId: () => string | null;
    },
  ) {}
  measureMarkerTops(elements: HTMLElement[]): void {
    this.markerTops = this.computeElementTopsInScrollContainer(elements);
  }

  private computeElementTopsInScrollContainer(elements: HTMLElement[]): number[] {
    if (!this.scrollContainer || elements.length === 0) return [];

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const scrollTop = this.scrollContainer.scrollTop;

    const first = elements[0];
    const firstOffsetParent = first.offsetParent;
    const firstOffsetTop = first.offsetTop;
    const firstTop = first.getBoundingClientRect().top - containerRect.top + scrollTop;

    const sameOffsetParent =
      firstOffsetParent !== null && elements.every((el) => el.offsetParent === firstOffsetParent);

    const tops = elements.map((el) => {
      if (sameOffsetParent) {
        return firstTop + (el.offsetTop - firstOffsetTop);
      }
      return el.getBoundingClientRect().top - containerRect.top + scrollTop;
    });

    for (let i = 1; i < tops.length; i++) {
      if (tops[i] < tops[i - 1]) return [];
    }

    return tops;
  }

  mount(bar: HTMLElement, track: HTMLElement, content: HTMLElement): void {
    this.bar = bar;
    this.track = track;
    this.content = content;
  }
  get padding(): number {
    return this.getTrackPadding();
  }
  updateActive(): void {
    for (const [id, dot] of this.dots) {
      dot.classList.toggle('active', id === this.activeTurnId);
      dot.setAttribute('aria-current', String(id === this.activeTurnId));
    }
  }
  destroy(): void {
    this.destroyed = true;
    if (this.runnerRaf !== null) cancelAnimationFrame(this.runnerRaf);
    this.dots.clear();
    this.bar = null;
    this.track = null;
    this.content = null;
  }

  private get markers() {
    return this.getMarkers();
  }
  private get scrollContainer() {
    return this.options.getViewport();
  }
  private get activeTurnId() {
    return this.options.getActiveId();
  }
  private getActiveIndex() {
    return this.markers.findIndex((marker) => marker.id === this.activeTurnId);
  }

  private getCSSVarNumber(el: Element, name: string, fallback: number): number {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private getTrackPadding(): number {
    return this.bar ? this.getCSSVarNumber(this.bar, '--timeline-track-padding', 12) : 12;
  }

  private getMinGap(): number {
    return this.bar ? this.getCSSVarNumber(this.bar, '--timeline-min-gap', 12) : 12;
  }

  private detectCssVarTopSupport(pad: number, usableC: number): boolean {
    try {
      const test = document.createElement('button');
      test.className = 'timeline-dot';
      test.style.visibility = 'hidden';
      test.setAttribute('aria-hidden', 'true');
      test.style.setProperty('--n', '0.5');
      this.content!.appendChild(test);
      const cs = getComputedStyle(test);
      const px = parseFloat(cs.top || '');
      test.remove();
      const expected = pad + 0.5 * usableC;
      return Number.isFinite(px) && Math.abs(px - expected) <= 2;
    } catch {
      return false;
    }
  }

  layout(): void {
    if (!this.bar || !this.content) return;
    const H = this.bar.clientHeight || 0;
    const pad = this.getTrackPadding();
    const minGap = this.getMinGap();
    const N = this.markers.length;
    // Get hidden markers for collapse feature
    const hiddenIndices = this.geometry.getHiddenMarkerIndices();
    const visibleCount = N - hiddenIndices.size;
    const desired = Math.max(
      H,
      visibleCount > 0 ? 2 * pad + Math.max(0, visibleCount - 1) * minGap : H,
    );
    this.contentHeight = Math.ceil(desired);
    this.content.style.height = `${this.contentHeight}px`;

    const usableC = Math.max(1, this.contentHeight - 2 * pad);
    // Calculate Y positions with collapse - using effective baseN for repositioning
    const { desiredY } = this.geometry.calculateCollapsedPositions(hiddenIndices, pad, usableC);

    // Apply min gap only to visible markers
    const gapMultipliers: number[] = new Array(N).fill(1.0);
    const adjusted = this.applyMinGapWithHidden(
      desiredY,
      pad,
      pad + usableC,
      minGap,
      hiddenIndices,
      gapMultipliers,
    );
    this.yPositions = adjusted;

    for (let i = 0; i < N; i++) {
      if (hiddenIndices.has(i)) {
        this.normalizedPositions[i] = -1;
        continue;
      }
      const top = adjusted[i];
      const n = (top - pad) / usableC;
      this.normalizedPositions[i] = Math.max(0, Math.min(1, n));
      const dot = this.dots.get(this.markers[i].id);
      if (dot && !this.usePixelTop) {
        dot.style.setProperty('--n', String(this.normalizedPositions[i]));
      }
    }
    if (this._cssVarTopSupported === null) {
      this._cssVarTopSupported = this.detectCssVarTopSupport(pad, usableC);
      this.usePixelTop = !this._cssVarTopSupported;
    }
  }

  /* Apply minimum gap between visible markers, skipping hidden ones */
  private applyMinGapWithHidden(
    positions: number[],
    minTop: number,
    maxTop: number,
    gap: number,
    hiddenIndices: Set<number>,
    gapMultipliers: number[],
  ): number[] {
    const n = positions.length;
    if (n === 0) return positions;

    const out = positions.slice();
    let prevVisibleIdx = -1;
    for (let i = 0; i < n; i++) {
      if (hiddenIndices.has(i)) continue;

      if (prevVisibleIdx === -1) {
        out[i] = Math.max(minTop, Math.min(positions[i], maxTop));
      } else {
        const currentGap = gap * gapMultipliers[i];
        const minAllowed = out[prevVisibleIdx] + currentGap;
        out[i] = Math.max(positions[i], minAllowed);
      }
      prevVisibleIdx = i;
    }
    let lastVisibleIdx = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (!hiddenIndices.has(i)) {
        lastVisibleIdx = i;
        break;
      }
    }

    if (lastVisibleIdx >= 0 && out[lastVisibleIdx] > maxTop) {
      out[lastVisibleIdx] = maxTop;

      let nextVisibleIdx = lastVisibleIdx;
      for (let i = lastVisibleIdx - 1; i >= 0; i--) {
        if (hiddenIndices.has(i)) continue;

        const currentGap = gap * gapMultipliers[nextVisibleIdx];
        const maxAllowed = out[nextVisibleIdx] - currentGap;
        out[i] = Math.min(out[i], maxAllowed);
        nextVisibleIdx = i;
      }
    }

    // Clamp all visible markers
    for (let i = 0; i < n; i++) {
      if (hiddenIndices.has(i)) continue;
      if (out[i] < minTop) out[i] = minTop;
      if (out[i] > maxTop) out[i] = maxTop;
    }

    return out;
  }

  private ensureRunnerRing(): void {
    if (!this.content) return;
    if (!this.runnerRing) {
      const ring = document.createElement('div');
      ring.className = 'timeline-runner-ring';
      Object.assign(ring.style, {
        position: 'absolute',
        left: '50%',
        top: '0',
        width: '20px',
        height: '20px',
        transform: 'translate3d(-50%, -10px, 0)',
        borderRadius: '9999px',
        boxShadow: '0 0 0 2px var(--timeline-dot-active-color), 0 0 12px rgba(59,130,246,.45)',
        background: 'transparent',
        pointerEvents: 'none',
        zIndex: '4',
        opacity: '0',
        transition: 'opacity 120ms ease',
        willChange: 'transform, opacity',
      } as CSSStyleDeclaration);
      this.content.appendChild(ring);
      this.runnerRing = ring;
    }
  }

  startRunner(fromIdx: number, toIdx: number, duration: number): void {
    this.ensureRunnerRing();
    if (!this.runnerRing) return;
    if (this.runnerRaf !== null) cancelAnimationFrame(this.runnerRaf);
    const animationGeneration = ++this.runnerAnimationGeneration;
    const y1 = Math.round(this.yPositions[fromIdx]);
    const y2 = Math.round(this.yPositions[toIdx]);
    const spring = getTimelineSpringProfile();
    const t0 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.runnerRing.style.opacity = '1';
    const animate = () => {
      if (this.destroyed || animationGeneration !== this.runnerAnimationGeneration) {
        return;
      }
      const now =
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const t = Math.min(1, (now - t0) / Math.max(1, duration));
      let eased: number;
      if (spring === 'snappy') eased = Math.min(1, t + 0.08 * Math.sin(t * 8));
      else if (spring === 'gentle') eased = t * t * (3 - 2 * t);
      else eased = t * t * (3 - 2 * t) * 0.85 + t * 0.15;
      const y = Math.round(y1 + (y2 - y1) * eased);
      if (this.runnerRing) {
        this.runnerRing.style.transform = `translate3d(-50%, ${y - 10}px, 0)`;
      }
      if (t < 1) {
        this.runnerRaf = requestAnimationFrame(animate);
      } else {
        if (this.runnerRing) {
          this.runnerRing.style.opacity = '0';
        }
      }
    };
    animate();
  }

  private lowerBound(arr: number[], x: number): number {
    let lo = 0,
      hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private upperBound(arr: number[], x: number): number {
    let lo = 0,
      hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  private getRulerFocusIndex(): number {
    const fallback = Math.max(0, this.getActiveIndex());
    if (
      !this.scrollContainer ||
      this.markerTops.length !== this.markers.length ||
      this.markerTops.length === 0
    ) {
      return fallback;
    }

    const focusTop =
      this.scrollContainer.scrollTop + Math.max(0, this.scrollContainer.clientHeight) * 0.45;
    const upperIndex = this.lowerBound(this.markerTops, focusTop);
    if (upperIndex <= 0) return 0;
    if (upperIndex >= this.markerTops.length) return this.markerTops.length - 1;

    const lowerIndex = upperIndex - 1;
    const lowerTop = this.markerTops[lowerIndex];
    const upperTop = this.markerTops[upperIndex];
    const progress = Math.max(
      0,
      Math.min(1, (focusTop - lowerTop) / Math.max(1, upperTop - lowerTop)),
    );
    return lowerIndex + progress;
  }

  /** Smooth Gaussian crest that travels through the ruler as the page scrolls. */
  private updateRulerWave(): void {
    if (this.options.getStyle() !== 'ruler') {
      this.markers.forEach((marker) => {
        this.dots.get(marker.id)?.style.removeProperty('--gv-timeline-ruler-scale');
        this.dots.get(marker.id)?.style.removeProperty('--gv-timeline-ruler-opacity');
      });
      return;
    }

    const focusIndex = this.getRulerFocusIndex();
    const start = Math.max(0, this.visibleRange.start);
    const end =
      this.visibleRange.end >= start
        ? Math.min(this.visibleRange.end, this.markers.length - 1)
        : this.markers.length - 1;
    for (let index = start; index <= end; index++) {
      const marker = this.markers[index];
      if (!marker) continue;
      const dot = this.dots.get(marker.id);
      if (!dot) continue;
      const { scale, opacity } = rulerWaveTick(Math.abs(index - focusIndex));
      dot.style.setProperty('--gv-timeline-ruler-scale', scale.toFixed(3));
      dot.style.setProperty('--gv-timeline-ruler-opacity', opacity.toFixed(3));
    }
  }

  private buildCompactMarkerOffsets(hiddenIndices: ReadonlySet<number>): Map<number, number> {
    const visibleIndices: number[] = [];
    for (let index = 0; index < this.markers.length; index++) {
      if (!hiddenIndices.has(index)) visibleIndices.push(index);
    }

    const available = (this.track?.clientHeight ?? 0) - 2 * this.getTrackPadding();
    const rankOffsets = denseMarkerOffsets(visibleIndices.length, available);
    return new Map(visibleIndices.map((markerIndex, rank) => [markerIndex, rankOffsets[rank]]));
  }

  /** The rail as drawn for the current style, so other layers share the dots' coordinates. */
  railLayout(): AnnotationRail & { dense: boolean } {
    const hidden = this.geometry.getHiddenMarkerIndices();
    const dense = this.options.getStyle() !== 'dots';
    const offsets = dense ? this.buildCompactMarkerOffsets(hidden) : null;
    return {
      dense,
      hidden,
      markerIds: this.markers.map((marker) => marker.id),
      markerTops: this.markerTops,
      positions: offsets
        ? this.markers.map((_, index) => offsets.get(index) ?? 0)
        : this.yPositions,
    };
  }

  private applyDotPosition(dot: DotElement, index: number, compactOffset?: number): void {
    if (this.options.getStyle() === 'compact' || this.options.getStyle() === 'ruler') {
      const offset = compactOffset ?? 0;
      const operator = offset < 0 ? '-' : '+';
      dot.style.top = `calc(50% ${operator} ${Math.abs(offset)}px)`;
      dot.style.setProperty('--timeline-compact-offset', `${offset}px`);
      return;
    }

    dot.style.removeProperty('--timeline-compact-offset');
    dot.style.setProperty('--n', String(this.normalizedPositions[index] || 0));
    if (this.usePixelTop) {
      dot.style.top = `${Math.round(this.yPositions[index])}px`;
    } else {
      dot.style.removeProperty('top');
    }
  }
  render(): void {
    if (!this.bar || !this.track || !this.content) return;
    const hidden = this.geometry.getHiddenMarkerIndices();
    const style = this.options.getStyle();
    const dense = style !== 'dots';
    const top = this.track.scrollTop;
    const height = this.track.clientHeight;
    const buffer = Math.max(100, height);
    const start = dense ? 0 : this.lowerBound(this.yPositions, top - buffer);
    const end = dense
      ? this.markers.length - 1
      : Math.max(start - 1, this.upperBound(this.yPositions, top + height + buffer));
    const offsets = dense ? this.buildCompactMarkerOffsets(hidden) : new Map<number, number>();
    const visibleIds = new Set<string>();
    const orderedDots: DotElement[] = [];
    for (let index = start; index <= end; index++) {
      const marker = this.markers[index];
      if (!marker || hidden.has(index)) continue;
      visibleIds.add(marker.id);
      let dot = this.dots.get(marker.id);
      if (!dot) {
        dot = document.createElement('button') as DotElement;
        dot.className = 'timeline-dot';
        dot.dataset.targetTurnId = marker.id;
        dot.setAttribute('tabindex', '0');
        dot.setAttribute('aria-describedby', 'gemini-timeline-tooltip');
        this.dots.set(marker.id, dot);
      }
      dot.dataset.markerIndex = String(index);
      dot.setAttribute('aria-label', marker.summary);
      this.applyDotPosition(dot, index, offsets.get(index));
      const collapsed = this.geometry.isMarkerCollapsed(marker.id);
      dot.classList.toggle('active', marker.id === this.activeTurnId);
      dot.setAttribute('aria-current', String(marker.id === this.activeTurnId));
      dot.classList.toggle('starred', marker.starred);
      dot.classList.toggle('collapsed', collapsed);
      dot.setAttribute('aria-pressed', String(marker.starred));
      dot.setAttribute('aria-expanded', String(!collapsed));
      dot.dataset.level = String(this.geometry.getMarkerLevel(marker.id));
      orderedDots.push(dot);
    }
    for (const [id, dot] of this.dots) {
      if (visibleIds.has(id)) continue;
      dot.remove();
      this.dots.delete(id);
    }
    // Prepending history must preserve keyboard order without detaching already ordered focused dots.
    let nextNode: Element | null = this.content.querySelector('.timeline-dot');
    for (const dot of orderedDots) {
      if (dot === nextNode) nextNode = dot.nextElementSibling;
      else this.content.insertBefore(dot, nextNode);
    }
    this.visibleRange = { start, end };
    this.updateRulerWave();
  }
}
