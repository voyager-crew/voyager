import { GV_RTL_CLASS, detectRTL } from '@/core/utils/rtl';
import { getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';

import { TimelinePreviewPress } from './TimelinePreviewPress';
import { bindCompactTrigger } from './timelinePreviewCompactTrigger';
import {
  previewHoverBridgeBox,
  previewPanelLeft,
  previewPanelMaxHeight,
  previewPanelTop,
  previewToggleSpot,
} from './timelinePreviewGeometry';
import { isolateListScroll, renderPreviewList } from './timelinePreviewList';
import type { PreviewMarkerData } from './types';

const SEARCH_DEBOUNCE_MS = 200;
const RESIZE_DEBOUNCE_MS = 120;
const COMPACT_CLOSE_DELAY_MS = 160;
const PREVIEW_HOVER_BRIDGE_CLASS = 'gv-timeline-preview-hover-bridge';
const PREVIEW_HOVER_BRIDGE_VISIBLE_CLASS = 'gv-timeline-preview-hover-bridge-visible';

const LIST_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;

export class TimelinePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private hoverBridgeEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private _isOpen = false;
  private _isPinned = false;
  private _isCompactMode = false;
  private floatingToggleSuppressed = false;
  private markers: ReadonlyArray<PreviewMarkerData> = [];
  private filteredMarkers: ReadonlyArray<PreviewMarkerData> = [];
  private activeTurnId: string | null = null;
  private searchQuery = '';
  private searchDebounceTimer: number | null = null;
  private resizeDebounceTimer: number | null = null;
  private compactCloseTimer: number | null = null;
  private onNavigate: ((turnId: string, index: number) => void) | null = null;
  private onSearchChange: ((query: string) => void) | null = null;
  private press: TimelinePreviewPress | null = null;
  private onDocumentPointerDown: ((e: PointerEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onWindowResize: (() => void) | null = null;
  private stopCompactTrigger: (() => void) | null = null;
  private stopFollowingLanguage: (() => void) | null = null;

  constructor(
    private readonly anchorElement: HTMLElement,
    private readonly mountAnchor: HTMLElement = document.body,
    private readonly railPosition?: 'left' | 'right',
  ) {}

  get isOpen(): boolean {
    return this._isOpen;
  }

  get isPinned(): boolean {
    return this._isPinned;
  }

  init(
    onNavigate: (turnId: string, index: number) => void,
    onSearchChange?: (query: string) => void,
    onToggleStar?: (turnId: string) => void | Promise<void>,
  ): void {
    this.onNavigate = onNavigate;
    this.onSearchChange = onSearchChange ?? null;
    this.createDOM();
    this.applyDirection();
    this.positionToggle();
    this.setupEventListeners(onToggleStar ?? null);
  }

  updateMarkers(markers: ReadonlyArray<PreviewMarkerData>): void {
    if (this.markersEqual(markers)) return;
    this.markers = markers;
    this.applyFilter();
  }

  updateActiveTurn(turnId: string | null): void {
    if (this.activeTurnId === turnId) return;
    this.activeTurnId = turnId;
    if (!this._isOpen || !this.listEl) return;
    this.updateActiveHighlight();
    this.scrollActiveIntoView();
  }

  /** Reposition toggle and panel after layout changes (e.g. RTL switch, resize). */
  reposition(): void {
    this.applyDirection();
    this.positionToggle();
    if (this._isOpen) this.positionPanel();
  }

  setPinned(pinned: boolean): void {
    if (this._isPinned === pinned) return;
    this._isPinned = pinned;
  }

  setCompactMode(compact: boolean): void {
    const changed = this._isCompactMode !== compact;
    this._isCompactMode = compact;
    this.cancelCompactClose();
    this.toggleBtn?.classList.toggle('timeline-preview-toggle-compact', compact);
    this.panelEl?.classList.toggle('timeline-preview-panel-compact', compact);
    this.syncFloatingToggleVisibility();

    if (!changed) return;

    if (compact) {
      this.anchorElement.tabIndex = 0;
      this.anchorElement.setAttribute('role', 'button');
      this.anchorElement.setAttribute(
        'aria-label',
        getTranslationSync('timelineCompactOpenPreview'),
      );
      this.anchorElement.setAttribute('aria-expanded', this._isOpen ? 'true' : 'false');
    } else {
      this.anchorElement.removeAttribute('tabindex');
      this.anchorElement.removeAttribute('role');
      this.anchorElement.removeAttribute('aria-label');
      this.anchorElement.removeAttribute('aria-expanded');
      this.hoverBridgeEl?.classList.remove(PREVIEW_HOVER_BRIDGE_VISIBLE_CLASS);
      if (this._isOpen && !this._isPinned) this.close();
    }
  }

  /** Hide the auxiliary list button when the timeline style is already a compact visual trigger. */
  setFloatingToggleSuppressed(suppressed: boolean): void {
    this.floatingToggleSuppressed = suppressed;
    this.syncFloatingToggleVisibility();
  }

  toggle(): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this._isOpen || !this.panelEl) return;
    this._isOpen = true;
    this.renderList();
    this.positionPanel();
    this.panelEl.classList.add('visible');
    this.toggleBtn?.classList.add('active');
    this.toggleBtn?.setAttribute('aria-pressed', 'true');
    if (this._isCompactMode) this.anchorElement.setAttribute('aria-expanded', 'true');
    this.scrollActiveIntoView();
  }

  close(): void {
    if (!this._isOpen || !this.panelEl) return;
    this.press?.reset();
    this._isOpen = false;
    this.panelEl.classList.remove('visible');
    this.hoverBridgeEl?.classList.remove(PREVIEW_HOVER_BRIDGE_VISIBLE_CLASS);
    this.toggleBtn?.classList.remove('active');
    this.toggleBtn?.setAttribute('aria-pressed', 'false');
    if (this._isCompactMode) this.anchorElement.setAttribute('aria-expanded', 'false');
    if (this.searchInput) {
      this.searchInput.value = '';
      this.searchQuery = '';
      this.filteredMarkers = this.markers;
    }
    this.onSearchChange?.('');
  }

  destroy(): void {
    this.press?.destroy();
    this.press = null;
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.resizeDebounceTimer !== null) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }
    this.cancelCompactClose();
    if (this.onDocumentPointerDown) {
      document.removeEventListener('pointerdown', this.onDocumentPointerDown);
      this.onDocumentPointerDown = null;
    }
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }
    this.stopCompactTrigger?.();
    this.stopCompactTrigger = null;
    this.stopFollowingLanguage?.();
    this.stopFollowingLanguage = null;
    this.toggleBtn?.remove();
    this.panelEl?.remove();
    this.hoverBridgeEl?.remove();
    this.toggleBtn = null;
    this.panelEl = null;
    this.hoverBridgeEl = null;
    this.listEl = null;
    this.searchInput = null;
    this.onSearchChange?.('');
    this.onNavigate = null;
    this.onSearchChange = null;
    this.markers = [];
    this.filteredMarkers = [];
    this.anchorElement.removeAttribute('tabindex');
    this.anchorElement.removeAttribute('role');
    this.anchorElement.removeAttribute('aria-label');
    this.anchorElement.removeAttribute('aria-expanded');
  }

  private createDOM(): void {
    // Toggle button — fixed position to the left of the timeline bar
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'timeline-preview-toggle';
    this.toggleBtn.setAttribute('aria-label', 'Toggle preview panel');
    this.toggleBtn.setAttribute('aria-pressed', 'false');
    this.toggleBtn.innerHTML = LIST_ICON_SVG;
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.mountAnchor.appendChild(this.toggleBtn);
    this.syncFloatingToggleVisibility();

    // Panel
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'timeline-preview-panel';
    this.hoverBridgeEl = document.createElement('div');
    this.hoverBridgeEl.className = PREVIEW_HOVER_BRIDGE_CLASS;
    this.hoverBridgeEl.setAttribute('aria-hidden', 'true');

    // Search section
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'timeline-preview-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.setAttribute('dir', 'auto');
    this.searchInput.placeholder = getTranslationSync('timelinePreviewSearch');
    this.searchInput.addEventListener('input', () => {
      this.handleSearchInput();
    });
    searchWrapper.appendChild(this.searchInput);
    this.panelEl.appendChild(searchWrapper);

    // List
    this.listEl = document.createElement('div');
    this.listEl.className = 'timeline-preview-list';
    isolateListScroll(this.listEl);
    this.panelEl.appendChild(this.listEl);

    this.mountAnchor.appendChild(this.panelEl);
    this.mountAnchor.appendChild(this.hoverBridgeEl);
  }

  private syncFloatingToggleVisibility(): void {
    if (!this.toggleBtn) return;
    this.toggleBtn.hidden = this._isCompactMode || this.floatingToggleSuppressed;
  }

  private setupEventListeners(
    onToggleStar: ((turnId: string) => void | Promise<void>) | null,
  ): void {
    // Click outside to close
    this.onDocumentPointerDown = (e: PointerEvent) => {
      if (!this._isOpen) return;
      if (this._isPinned) return;
      const target = e.target as Node;
      if (
        this.panelEl?.contains(target) ||
        this.hoverBridgeEl?.contains(target) ||
        this.toggleBtn?.contains(target) ||
        this.anchorElement.contains(target)
      )
        return;
      this.close();
    };
    document.addEventListener('pointerdown', this.onDocumentPointerDown);

    // Escape to close
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this._isOpen) return;
      if (this._isPinned) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);

    this.press = new TimelinePreviewPress(this.listEl!, onToggleStar);

    // Reposition on resize (debounced: positionPanel reads offsetHeight after
    // writing styles, which forces layout — avoid doing that per resize event)
    this.onWindowResize = () => {
      if (this.resizeDebounceTimer !== null) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = window.setTimeout(() => {
        this.resizeDebounceTimer = null;
        this.positionToggle();
        if (this._isOpen) this.positionPanel();
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', this.onWindowResize);

    this.stopCompactTrigger = bindCompactTrigger(
      { anchor: this.anchorElement, panel: this.panelEl, hoverBridge: this.hoverBridgeEl },
      {
        isCompact: () => this._isCompactMode,
        isOpen: () => this._isOpen,
        open: () => this.open(),
        close: () => this.close(),
        toggle: () => this.toggle(),
        scheduleClose: () => this.scheduleCompactClose(),
        cancelClose: () => this.cancelCompactClose(),
      },
    );

    // Re-render translated text once the new language has loaded, not when storage changes.
    this.stopFollowingLanguage = onCachedLanguageChange(() => this.updateTranslatedText());
  }

  private updateTranslatedText(): void {
    this.applyDirection();
    if (this.searchInput) {
      this.searchInput.placeholder = getTranslationSync('timelinePreviewSearch');
    }
    if (this._isCompactMode) {
      this.anchorElement.setAttribute(
        'aria-label',
        getTranslationSync('timelineCompactOpenPreview'),
      );
    }
    if (this._isOpen) {
      this.renderList();
    }
  }

  private scheduleCompactClose(): void {
    if (!this._isCompactMode || this._isPinned) return;
    this.cancelCompactClose();
    this.compactCloseTimer = window.setTimeout(() => {
      this.compactCloseTimer = null;
      if (!this._isCompactMode || this._isPinned) return;
      this.close();
    }, COMPACT_CLOSE_DELAY_MS);
  }

  private cancelCompactClose(): void {
    if (this.compactCloseTimer === null) return;
    clearTimeout(this.compactCloseTimer);
    this.compactCloseTimer = null;
  }

  private isRTLContext(): boolean {
    return document.body.classList.contains(GV_RTL_CLASS) || detectRTL();
  }

  private applyDirection(): void {
    const dir = this.isRTLContext() ? 'rtl' : 'ltr';
    this.panelEl?.setAttribute('dir', dir);
    this.listEl?.setAttribute('dir', dir);
    this.toggleBtn?.setAttribute('dir', dir);
  }

  /** Position the toggle button beside the timeline bar, vertically centered.
   *  Keep it on the bar's left side and clamp within viewport bounds. */
  private positionToggle(): void {
    if (!this.toggleBtn) return;
    const spot = previewToggleSpot(this.anchorElement.getBoundingClientRect(), window.innerWidth);
    this.toggleBtn.style.left = `${spot.left}px`;
    this.toggleBtn.style.top = `${spot.top}px`;
  }

  private positionPanel(): void {
    if (!this.panelEl) return;
    const barRect = this.anchorElement.getBoundingClientRect();
    const maxHeight = previewPanelMaxHeight(window.innerHeight, this._isCompactMode);
    // RTL moves the default catalog rail left, so its preview must follow that side too.
    const isRTL = this.railPosition === 'left' || this.isRTLContext();
    const left = previewPanelLeft(barRect, window.innerWidth, isRTL);

    this.panelEl.style.maxHeight = `${Math.round(maxHeight)}px`;
    this.panelEl.style.left = `${Math.round(left)}px`;

    // Measure actual rendered height to center properly (works for both few and many items)
    const panelHeight = this.panelEl.offsetHeight || maxHeight;
    const top = previewPanelTop(barRect, panelHeight, window.innerHeight);

    this.panelEl.style.top = `${Math.round(top)}px`;
    this.positionHoverBridge(barRect, { left, top, height: panelHeight }, isRTL);
  }

  // The visual gap must accept hover and clicks so slow crossings cannot close the panel.
  private positionHoverBridge(
    barRect: DOMRect,
    panel: { left: number; top: number; height: number },
    isRTL: boolean,
  ): void {
    if (!this.hoverBridgeEl) return;
    const box = previewHoverBridgeBox(
      barRect,
      panel,
      { width: window.innerWidth, height: window.innerHeight },
      isRTL,
    );
    this.hoverBridgeEl.style.left = `${Math.round(box.left)}px`;
    this.hoverBridgeEl.style.top = `${Math.round(box.top)}px`;
    this.hoverBridgeEl.style.width = `${Math.round(box.width)}px`;
    this.hoverBridgeEl.style.height = `${Math.round(box.height)}px`;
    this.hoverBridgeEl.classList.toggle(
      PREVIEW_HOVER_BRIDGE_VISIBLE_CLASS,
      this._isOpen && this._isCompactMode && box.width > 0,
    );
  }

  private applyFilter(): void {
    if (!this.searchQuery) {
      this.filteredMarkers = this.markers;
    } else {
      const q = this.searchQuery.toLowerCase();
      this.filteredMarkers = this.markers.filter((m) => m.summary.toLowerCase().includes(q));
    }
    if (this._isOpen) {
      this.renderList();
      // Lazy-loaded history can grow the list after the panel has already been
      // positioned. Re-measure it so the old top offset cannot push the newly
      // taller panel below the viewport.
      this.positionPanel();
    }
    this.onSearchChange?.(this.searchQuery);
  }

  private handleSearchInput(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = window.setTimeout(() => {
      this.searchDebounceTimer = null;
      this.searchQuery = this.searchInput?.value.trim() ?? '';
      this.applyFilter();
    }, SEARCH_DEBOUNCE_MS);
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.press?.cancelPending();
    renderPreviewList(this.listEl, {
      markers: this.filteredMarkers,
      query: this.searchQuery,
      activeTurnId: this.activeTurnId,
      onItemClick: (marker, event) => {
        if (this.press?.consumeClick(marker.id, event)) return;
        this.onNavigate?.(marker.id, marker.index);
      },
    });
  }

  private updateActiveHighlight(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll('.timeline-preview-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      el.classList.toggle('active', el.dataset.turnId === this.activeTurnId);
    });
  }

  private scrollActiveIntoView(): void {
    if (!this.listEl || !this.activeTurnId) return;
    const activeItem = this.listEl.querySelector(
      '.timeline-preview-item.active',
    ) as HTMLElement | null;
    activeItem?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  private markersEqual(newMarkers: ReadonlyArray<PreviewMarkerData>): boolean {
    if (newMarkers.length !== this.markers.length) return false;
    for (let i = 0; i < newMarkers.length; i++) {
      const a = this.markers[i];
      const b = newMarkers[i];
      if (a.id !== b.id || a.summary !== b.summary || a.starred !== b.starred) return false;
    }
    return true;
  }
}
