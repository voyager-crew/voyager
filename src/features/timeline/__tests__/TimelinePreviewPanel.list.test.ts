import './timelinePreviewPanelHarness';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelinePreviewPanel } from '../TimelinePreviewPanel';
import type { PreviewMarkerData } from '../types';
import { makeMarkers, mountPreviewPanel } from './timelinePreviewPanelHarness';

describe('TimelinePreviewPanel', () => {
  let anchor: HTMLElement;
  let panel: TimelinePreviewPanel;
  let onNavigate: (turnId: string, index: number) => void;

  beforeEach(() => {
    ({ anchor, panel, onNavigate } = mountPreviewPanel());
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('updateMarkers', () => {
    it('repositions an open panel when lazy-loaded markers increase its height', () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 100, 24, 600));
      const panelEl = document.querySelector('.timeline-preview-panel') as HTMLElement;

      Object.defineProperty(panelEl, 'offsetHeight', { value: 200, configurable: true });
      panel.updateMarkers(makeMarkers(3));
      panel.open();
      expect(panelEl.style.top).toBe('300px');

      Object.defineProperty(panelEl, 'offsetHeight', { value: 500, configurable: true });
      panel.updateMarkers(makeMarkers(30));

      expect(panelEl.style.top).toBe('150px');
    });

    it('renders correct number of items when open', () => {
      const markers = makeMarkers(5);
      panel.updateMarkers(markers);
      panel.open();

      const items = document.querySelectorAll('.timeline-preview-item');
      expect(items.length).toBe(5);
    });

    it('shows index numbers', () => {
      panel.updateMarkers(makeMarkers(3));
      panel.open();

      const indices = document.querySelectorAll('.timeline-preview-index');
      expect(indices[0]?.textContent).toBe('1');
      expect(indices[2]?.textContent).toBe('3');
    });

    it('marks starred items', () => {
      panel.updateMarkers(makeMarkers(5));
      panel.open();

      const items = document.querySelectorAll('.timeline-preview-item');
      expect(items[2]?.classList.contains('starred')).toBe(true);
      expect(items[0]?.classList.contains('starred')).toBe(false);
    });

    it('shows empty message when no markers', () => {
      panel.updateMarkers([]);
      panel.open();

      const empty = document.querySelector('.timeline-preview-empty');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toBe('No messages');
    });

    it('sets preview text direction to auto for bidi-safe rendering', () => {
      const markers: PreviewMarkerData[] = [
        {
          id: 'turn-ar',
          summary: 'مرحبا بكم في Gemini Voyager',
          index: 0,
          starred: false,
        },
      ];
      panel.updateMarkers(markers);
      panel.open();

      const text = document.querySelector('.timeline-preview-text') as HTMLElement | null;
      expect(text?.getAttribute('dir')).toBe('auto');
    });
  });

  describe('updateActiveTurn', () => {
    it('highlights the active item', () => {
      panel.updateMarkers(makeMarkers(5));
      panel.open();

      panel.updateActiveTurn('turn-1');

      const items = document.querySelectorAll('.timeline-preview-item');
      expect(items[1]?.classList.contains('active')).toBe(true);
      expect(items[0]?.classList.contains('active')).toBe(false);
    });

    it('switches active highlight on update', () => {
      panel.updateMarkers(makeMarkers(5));
      panel.open();

      panel.updateActiveTurn('turn-0');
      let items = document.querySelectorAll('.timeline-preview-item');
      expect(items[0]?.classList.contains('active')).toBe(true);

      panel.updateActiveTurn('turn-3');
      items = document.querySelectorAll('.timeline-preview-item');
      expect(items[0]?.classList.contains('active')).toBe(false);
      expect(items[3]?.classList.contains('active')).toBe(true);
    });
  });

  describe('search filtering', () => {
    it('filters by substring (case-insensitive)', async () => {
      panel.updateMarkers(makeMarkers(10));
      panel.open();

      const input = document.querySelector('.timeline-preview-search input') as HTMLInputElement;
      input.value = 'number 3';
      input.dispatchEvent(new Event('input'));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 250));

      const items = document.querySelectorAll('.timeline-preview-item');
      expect(items.length).toBe(1);
      expect(items[0]?.querySelector('.timeline-preview-text')?.textContent).toContain('3');
    });

    it('shows all items when search is cleared', async () => {
      panel.updateMarkers(makeMarkers(5));
      panel.open();

      const input = document.querySelector('.timeline-preview-search input') as HTMLInputElement;
      input.value = 'number 1';
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(document.querySelectorAll('.timeline-preview-item').length).toBe(1);

      input.value = '';
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(document.querySelectorAll('.timeline-preview-item').length).toBe(5);
    });

    it('shows "No results" when search has no match', async () => {
      panel.updateMarkers(makeMarkers(3));
      panel.open();

      const input = document.querySelector('.timeline-preview-search input') as HTMLInputElement;
      input.value = 'zzzznonexistent';
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 250));

      const empty = document.querySelector('.timeline-preview-empty');
      expect(empty?.textContent).toBe('No results');
    });
  });

  describe('navigation', () => {
    it('calls onNavigate when item is clicked', () => {
      panel.updateMarkers(makeMarkers(5));
      panel.open();

      const items = document.querySelectorAll('.timeline-preview-item');
      (items[2] as HTMLElement).click();

      expect(onNavigate).toHaveBeenCalledWith('turn-2', 2);
    });
  });

  describe('long press star', () => {
    let onToggleStar: Mock<(turnId: string) => void>;

    beforeEach(() => {
      vi.useFakeTimers();
      panel.destroy();
      onToggleStar = vi.fn<(turnId: string) => void>();
      panel = new TimelinePreviewPanel(anchor);
      panel.init(onNavigate, undefined, onToggleStar);
      panel.updateMarkers(makeMarkers(5));
      panel.open();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function getItem(index = 0): HTMLElement {
      const item = document.querySelectorAll<HTMLElement>('.timeline-preview-item')[index];
      if (!item) throw new Error(`Expected preview item ${index}`);
      return item;
    }

    function pointer(type: string, target: EventTarget, options: PointerEventInit = {}): void {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          isPrimary: true,
          pointerType: 'mouse',
          ...options,
        }),
      );
    }

    it('toggles the star after 550ms and suppresses the generated click', () => {
      const item = getItem(1);

      pointer('pointerdown', item);
      expect(item.classList.contains('holding')).toBe(true);
      vi.advanceTimersByTime(549);
      expect(onToggleStar).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onToggleStar).toHaveBeenCalledOnce();
      expect(onToggleStar).toHaveBeenCalledWith('turn-1');
      expect(item.classList.contains('holding')).toBe(false);

      pointer('pointerup', window);
      item.click();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('supports touch long press', () => {
      const item = getItem(2);

      pointer('pointerdown', item, { pointerType: 'touch' });
      vi.advanceTimersByTime(550);

      expect(onToggleStar).toHaveBeenCalledWith('turn-2');
      pointer('pointerup', window, { pointerType: 'touch' });
      item.click();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('suppresses navigation even when the user keeps holding after the star toggles', () => {
      const item = getItem(4);

      pointer('pointerdown', item);
      vi.advanceTimersByTime(550);
      expect(onToggleStar).toHaveBeenCalledWith('turn-4');

      vi.advanceTimersByTime(500);
      pointer('pointerup', window);
      item.click();

      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('keeps short press navigation unchanged', () => {
      const item = getItem(3);

      pointer('pointerdown', item);
      vi.advanceTimersByTime(549);
      pointer('pointerup', window);
      item.click();

      expect(onToggleStar).not.toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith('turn-3', 3);
      expect(item.classList.contains('holding')).toBe(false);
    });

    it('cancels when the pointer moves beyond the tolerance', () => {
      const item = getItem();

      pointer('pointerdown', item);
      pointer('pointermove', window, { clientX: 17 });
      vi.advanceTimersByTime(550);

      expect(onToggleStar).not.toHaveBeenCalled();
      expect(item.classList.contains('holding')).toBe(false);
    });

    it('cancels on pointercancel', () => {
      const item = getItem();

      pointer('pointerdown', item);
      pointer('pointercancel', window);
      vi.advanceTimersByTime(550);

      expect(onToggleStar).not.toHaveBeenCalled();
      expect(item.classList.contains('holding')).toBe(false);
    });

    it('cancels a pending press when the list rerenders or is destroyed', () => {
      pointer('pointerdown', getItem());
      const changedMarkers = makeMarkers(5);
      changedMarkers[0] = { ...changedMarkers[0], summary: 'Updated summary' };
      panel.updateMarkers(changedMarkers);
      vi.advanceTimersByTime(550);
      expect(onToggleStar).not.toHaveBeenCalled();

      pointer('pointerdown', getItem());
      panel.destroy();
      vi.advanceTimersByTime(550);
      expect(onToggleStar).not.toHaveBeenCalled();
    });
  });

  describe('scroll isolation', () => {
    it('stops wheel event propagation on list', () => {
      panel.updateMarkers(makeMarkers(20));
      panel.open();

      const list = document.querySelector('.timeline-preview-list') as HTMLElement;
      const wheelEvent = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
      const stopSpy = vi.spyOn(wheelEvent, 'stopPropagation');
      list.dispatchEvent(wheelEvent);

      expect(stopSpy).toHaveBeenCalled();
    });
  });
});
