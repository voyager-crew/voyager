import { type TimelineStyle } from '@/core/types/common';
import { applyRTLClass } from '@/core/utils/rtl';

import { TimelineAnnotationLayer } from './TimelineAnnotationLayer';
import type { TimelineDataSession } from './TimelineDataSession';
import { TimelineDotLayer } from './TimelineDotLayer';
import type { TimelineHierarchyGeometry } from './TimelineHierarchyGeometry';
import { TimelinePreviewPanel } from './TimelinePreviewPanel';
import { TimelineRailPlacement } from './TimelineRailPlacement';
import { TimelineSlider } from './TimelineSlider';
import timelineStyles from './timeline.css?inline';
import contextMenuStyles from './timelineContextMenu.css?inline';
import previewStyles from './timelinePreview.css?inline';
import sliderStyles from './timelineSlider.css?inline';
/** Hides every rail surface until the conversation has a turn to mark. */
const EMPTY_RAIL_CLASS = 'gv-timeline-empty';
const HOMING_WAIT_CLASS = 'gv-timeline-homing-wait';
/** Everything a timeline view and its engine put on the page. */
const TIMELINE_PAGE_NODES = [
  'style[data-gv-timeline]',
  '.gemini-timeline-bar',
  '.timeline-left-slider',
  '.timeline-preview-toggle',
  '.timeline-preview-panel',
  '.gv-timeline-preview-hover-bridge',
  '#gemini-timeline-tooltip',
].join(',');
interface TimelineViewOptions {
  mountAnchor?: HTMLElement;
  storagePrefix?: string;
  position?: 'left' | 'right';
  getViewport: () => HTMLElement | null;
  getActiveId: () => string | null;
  navigate: (turnId: string, index: number) => void;
  search: (query: string) => void;
  onStyleChange: () => void;
  onResize: () => void;
}
/** Composes rail owners, preview, styles and synchronization with the live viewport. */
export class TimelineView {
  ui: {
    timelineBar: HTMLElement | null;
    track?: HTMLElement | null;
    trackContent?: HTMLElement | null;
    slider?: HTMLElement | null;
    sliderHandle?: HTMLElement | null;
  } = { timelineBar: null };

  timelineStyle: TimelineStyle = 'dots';

  hideContainer: boolean = false;

  private firstUserTurnOffset = 0;

  private contentSpanPx = 1;

  private resizeIdleTimer: number | null = null;

  private resizeIdleDelay = 140;

  previewPanel: TimelinePreviewPanel | null = null;

  rtl = false;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private readonly lifetime = new AbortController();
  constructor(
    private readonly state: Pick<TimelineDataSession, 'markers' | 'toggleStar'>,
    geometry: TimelineHierarchyGeometry,
    private readonly options: TimelineViewOptions,
  ) {
    this.dotLayer = new TimelineDotLayer(() => state.markers, geometry, {
      getStyle: () => this.timelineStyle,
      getViewport: () => this.options.getViewport(),
      getActiveId: () => this.options.getActiveId(),
    });
    this.annotationLayer = new TimelineAnnotationLayer(
      this.dotLayer,
      () => this.timelineStyle === 'compact',
    );
    this.placement = new TimelineRailPlacement({
      storagePrefix: options.storagePrefix,
      getStyle: () => this.timelineStyle,
      onWidthChange: () => this.applyContainerVisibility(),
      onPositionRestore: () => this.previewPanel?.reposition(),
    });
  }
  private readonly dotLayer: TimelineDotLayer;
  private readonly annotationLayer: TimelineAnnotationLayer;
  get yPositions(): number[] {
    return this.dotLayer.yPositions;
  }
  get markerTops(): number[] {
    return this.dotLayer.markerTops;
  }
  measureMarkers(elements: HTMLElement[]): void {
    this.dotLayer.measureMarkerTops(elements);
    this.firstUserTurnOffset = elements[0].offsetTop;
    this.contentSpanPx = Math.max(
      1,
      elements[elements.length - 1].offsetTop - elements[0].offsetTop,
    );
  }
  updateTimelineGeometry(): void {
    if (!this.ui.timelineBar || !this.ui.trackContent) return;
    this.dotLayer.layout();
    this.slider?.updateGeometry();
  }
  updateVirtualRangeAndRender(): void {
    this.applyEmptyState();
    this.dotLayer.render();
    this.annotationLayer.render();
  }
  // Gemini's new-chat home (/app) is a conversation route with no turns; an unmarked rail there
  // read as a stray full-height bar, so nothing of the rail shows until a marker exists.
  private applyEmptyState(): void {
    const empty = this.markers.length === 0;
    this.ui.timelineBar?.classList.toggle(EMPTY_RAIL_CLASS, empty);
    this.ui.slider?.classList.toggle(EMPTY_RAIL_CLASS, empty);
  }
  /** Pulse the active marker while navigation waits for the host to load older turns. */
  setHomingWait(waiting: boolean): void {
    this.ui.timelineBar?.classList.toggle(HOMING_WAIT_CLASS, waiting);
  }
  startRunner(fromIdx: number, toIdx: number, duration: number): void {
    this.dotLayer.startRunner(fromIdx, toIdx, duration);
  }
  readonly placement: TimelineRailPlacement;
  private slider: TimelineSlider | null = null;

  updateSlider(): void {
    this.slider?.update();
  }
  updateSliderPosition(): void {
    this.slider?.updatePosition();
  }
  toggleDraggable(enabled: boolean): void {
    this.placement.toggleDraggable(enabled);
  }
  applyPosition(top: number, left: number): void {
    if (!this.ui.timelineBar) return;
    this.placement.applyPosition(top, left);
    this.previewPanel?.reposition();
  }
  updateRulerDirection(left?: number): void {
    this.placement.updateRulerDirection(left);
  }
  reapplyPosition(): void {
    if (this.placement.reapplyPosition()) this.previewPanel?.reposition();
  }
  private get markers() {
    return this.state.markers;
  }
  private get scrollContainer() {
    return this.options.getViewport();
  }
  private get activeTurnId() {
    return this.options.getActiveId();
  }
  mount(): void {
    if (this.destroyed) return;
    // One timeline per page: an orphaned content script (extension reload or
    // update) cannot tear its rail down, and adopting its bar while adding a
    // second preview panel stacked two lists on ChatGPT. The newest view owns
    // the page.
    for (const stale of document.querySelectorAll(TIMELINE_PAGE_NODES)) stale.remove();
    this.styleElement = document.createElement('style');
    this.styleElement.dataset.gvTimeline = '';
    this.styleElement.textContent = [
      timelineStyles,
      contextMenuStyles,
      sliderStyles,
      previewStyles,
    ].join('\n');
    document.head.appendChild(this.styleElement);
    const anchor = this.options.mountAnchor ?? document.body;
    const bar = document.createElement('div');
    bar.className = 'gemini-timeline-bar';
    anchor.appendChild(bar);
    if (this.options.position === 'left') {
      bar.style.right = 'auto';
      bar.style.left = '15px';
    }
    if (this.options.position) bar.dataset.gvPosition = this.options.position;
    this.ui.timelineBar = bar;
    const track = document.createElement('div');
    track.className = 'timeline-track';
    bar.appendChild(track);
    const content = document.createElement('div');
    content.className = 'timeline-track-content';
    track.appendChild(content);
    this.ui.track = track;
    this.ui.trackContent = content;
    this.dotLayer.mount(bar, track, content);
    this.annotationLayer.mount(content);

    const slider = document.createElement('div');
    slider.className = 'timeline-left-slider';
    const handle = document.createElement('div');
    handle.className = 'timeline-left-handle';
    slider.appendChild(handle);
    anchor.appendChild(slider);
    this.ui.slider = slider;
    this.ui.sliderHandle = handle;
    this.applyEmptyState();

    this.previewPanel = new TimelinePreviewPanel(bar, anchor, this.options.position);
    this.previewPanel.init(this.options.navigate, this.options.search, (id) =>
      this.state.toggleStar(id),
    );
    this.slider = new TimelineSlider(bar, track, slider, this.ui.sliderHandle, {
      getLayout: () => ({
        contentHeight: this.dotLayer.contentHeight,
        padding: this.dotLayer.padding,
        rtl: this.options.position === 'left' || this.rtl,
      }),
      onScroll: () => this.updateVirtualRangeAndRender(),
    });
    this.placement.mount(bar);
    this.setupEventListeners();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(bar);
  }
  render(): void {
    if (this.destroyed) return;
    this.updateTimelineGeometry();
    this.syncTimelineTrackToMain();
    this.updateVirtualRangeAndRender();
    this.updateSlider();
  }
  updateActiveDotUI(): void {
    this.dotLayer.updateActive();
    this.previewPanel?.updateActiveTurn(this.activeTurnId);
  }
  updatePreviewMarkers(): void {
    this.previewPanel?.updateMarkers(
      this.markers.map((marker, index) => ({
        id: marker.id,
        summary: marker.summary,
        index,
        starred: marker.starred,
      })),
    );
  }
  private setupEventListeners(): void {
    const signal = this.lifetime.signal;
    this.ui.timelineBar!.addEventListener(
      'wheel',
      (event) => {
        if (this.scrollContainer) this.scrollContainer.scrollTop += event.deltaY;
        this.slider?.show();
        event.preventDefault();
      },
      { passive: false, signal },
    );
    // Both resize sources funnel through one trailing debounce so a resize
    // burst runs geometry/layout work only once per idle window.
    const onWindowResize = () => this.scheduleResizeWork();
    window.addEventListener('resize', onWindowResize, { signal: this.lifetime.signal });
    if (window.visualViewport) {
      const onVisualViewportResize = () => this.scheduleResizeWork();
      window.visualViewport.addEventListener('resize', onVisualViewportResize, {
        signal: this.lifetime.signal,
      });
    }
  }
  destroy(): void {
    this.destroyed = true;

    this.lifetime.abort();
    this.resizeObserver?.disconnect();
    this.annotationLayer.destroy();
    this.dotLayer.destroy();
    if (this.resizeIdleTimer !== null) clearTimeout(this.resizeIdleTimer);
    this.slider?.destroy();
    this.slider = null;
    this.placement.destroy();
    this.previewPanel?.destroy();
    this.previewPanel = null;
    this.ui.slider?.remove();
    this.ui.timelineBar?.remove();
    this.styleElement?.remove();
    this.styleElement = null;
    this.ui = { timelineBar: null };
  }
  applyContainerVisibility(): void {
    if (!this.ui.timelineBar) return;
    const bar = this.ui.timelineBar;
    // Visual background width (::before is centered, bar stays 24px for dots)
    bar.style.setProperty('--timeline-bar-width', `${this.placement.barWidth}px`);
    // hideContainer is an independent binary toggle
    bar.classList.toggle('timeline-no-container', !!this.hideContainer);
  }

  applyTimelineStyle(): void {
    const bar = this.ui.timelineBar;
    if (!bar) return;
    const compact = this.timelineStyle === 'compact';
    const ruler = this.timelineStyle === 'ruler';
    const dense = compact || ruler;
    bar.classList.toggle('timeline-style-compact', compact);
    bar.classList.toggle('gv-timeline-style-ruler', ruler);
    this.updateRulerDirection();
    this.ui.slider?.classList.toggle('timeline-style-compact', dense);
    this.options.onStyleChange();
    if (dense) {
      if (this.ui.track) this.ui.track.scrollTop = 0;
    }
    if (compact) {
      this.ui.track?.setAttribute('aria-hidden', 'true');
    } else {
      this.ui.track?.removeAttribute('aria-hidden');
      if (!ruler) this.syncTimelineTrackToMain();
    }
    this.previewPanel?.setCompactMode(compact);
    this.previewPanel?.setFloatingToggleSuppressed(ruler);
    this.updateVirtualRangeAndRender();
    this.updateSlider();
  }

  syncTimelineTrackToMain(): void {
    if (this.timelineStyle !== 'dots') return;
    if (this.slider?.dragging) return;
    if (!this.ui.track || !this.scrollContainer || !this.dotLayer.contentHeight) return;
    const scrollTop = this.scrollContainer.scrollTop;
    const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;
    const span = Math.max(1, this.contentSpanPx || 1);
    const r = Math.max(0, Math.min(1, (ref - (this.firstUserTurnOffset || 0)) / span));
    const maxScroll = Math.max(0, this.dotLayer.contentHeight - (this.ui.track.clientHeight || 0));
    const target = Math.round(r * maxScroll);
    if (Math.abs((this.ui.track.scrollTop || 0) - target) > 1) this.ui.track.scrollTop = target;
  }

  /** Reset inline placement when the page direction changes. */
  applyRTLUpdate(language?: string | null): void {
    const wasRTL = this.rtl;
    this.rtl = applyRTLClass(language);
    if (wasRTL !== this.rtl) {
      // Reset inline position so the CSS default for the new direction takes effect
      if (this.ui.timelineBar) {
        this.ui.timelineBar.style.top = '';
        this.ui.timelineBar.style.left = this.options.position === 'left' ? '15px' : '';
      }
      this.updateRulerDirection();
      this.updateSlider();
      this.previewPanel?.reposition();
    }
  }

  /** Trailing-debounced handler shared by window and visualViewport resize. */
  private scheduleResizeWork(): void {
    if (this.resizeIdleTimer !== null) clearTimeout(this.resizeIdleTimer);
    this.resizeIdleTimer = window.setTimeout(() => {
      this.resizeIdleTimer = null;
      if (this.destroyed) return;
      this.options.onResize();
      this.updateTimelineGeometry();
      this.syncTimelineTrackToMain();
      this.updateVirtualRangeAndRender();
      this.updateSlider();
      // Reapply position for responsive design (v2 format only)
      this.reapplyPosition();
    }, this.resizeIdleDelay);
  }
}
