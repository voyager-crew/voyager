import './timelinePreviewPanelHarness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GV_RTL_CLASS } from '@/core/utils/rtl';

import type { TimelinePreviewPanel } from '../TimelinePreviewPanel';
import { makeMarkers, mountPreviewPanel } from './timelinePreviewPanelHarness';

describe('TimelinePreviewPanel', () => {
  let anchor: HTMLElement;
  let panel: TimelinePreviewPanel;

  beforeEach(() => {
    ({ anchor, panel } = mountPreviewPanel());
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('DOM creation', () => {
    it('creates toggle button on the page', () => {
      const toggle = document.querySelector('.timeline-preview-toggle');
      expect(toggle).not.toBeNull();
      expect(toggle?.tagName).toBe('BUTTON');
    });

    it('creates panel with search and list', () => {
      const panelEl = document.querySelector('.timeline-preview-panel');
      expect(panelEl).not.toBeNull();
      expect(panelEl?.querySelector('.timeline-preview-search input')).not.toBeNull();
      expect(panelEl?.querySelector('.timeline-preview-list')).not.toBeNull();
    });
  });

  describe('toggle', () => {
    it('opens and closes panel', () => {
      const panelEl = document.querySelector('.timeline-preview-panel')!;
      expect(panelEl.classList.contains('visible')).toBe(false);
      expect(panel.isOpen).toBe(false);

      panel.toggle();
      expect(panelEl.classList.contains('visible')).toBe(true);
      expect(panel.isOpen).toBe(true);

      panel.toggle();
      expect(panelEl.classList.contains('visible')).toBe(false);
      expect(panel.isOpen).toBe(false);
    });

    it('toggle button click opens/closes panel', () => {
      const toggle = document.querySelector('.timeline-preview-toggle') as HTMLElement;
      toggle.click();
      expect(panel.isOpen).toBe(true);

      toggle.click();
      expect(panel.isOpen).toBe(false);
    });

    it('allows manual close and reopen while pinned', () => {
      panel.setPinned(true);
      expect(panel.isPinned).toBe(true);

      panel.toggle();
      expect(panel.isOpen).toBe(true);

      panel.toggle();
      expect(panel.isOpen).toBe(false);
      expect(panel.isPinned).toBe(true);

      panel.toggle();
      expect(panel.isOpen).toBe(true);
      expect(panel.isPinned).toBe(true);
    });
  });

  describe('compact mode', () => {
    it('turns the timeline rail into the accessible preview trigger', () => {
      panel.setCompactMode(true);

      const panelEl = document.querySelector('.timeline-preview-panel');
      const toggle = document.querySelector('.timeline-preview-toggle');
      expect(anchor.getAttribute('role')).toBe('button');
      expect(anchor.getAttribute('tabindex')).toBe('0');
      expect(anchor.getAttribute('aria-label')).toBe('Open timeline preview');
      expect(panelEl?.classList.contains('timeline-preview-panel-compact')).toBe(true);
      expect(toggle?.classList.contains('timeline-preview-toggle-compact')).toBe(true);
      expect((toggle as HTMLButtonElement | null)?.hidden).toBe(true);

      panel.setCompactMode(false);
      expect((toggle as HTMLButtonElement | null)?.hidden).toBe(false);
    });

    it('hides the floating toggle for a dense ruler without enabling compact panel behavior', () => {
      const toggle = document.querySelector('.timeline-preview-toggle') as HTMLButtonElement;

      panel.setFloatingToggleSuppressed(true);
      expect(toggle.hidden).toBe(true);
      expect(anchor.hasAttribute('role')).toBe(false);

      panel.setFloatingToggleSuppressed(false);
      expect(toggle.hidden).toBe(false);
    });

    it('opens on rail hover and closes after leaving the rail and panel', () => {
      vi.useFakeTimers();
      try {
        panel.setCompactMode(true);
        anchor.dispatchEvent(new MouseEvent('mouseenter'));
        expect(panel.isOpen).toBe(true);

        anchor.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(159);
        expect(panel.isOpen).toBe(true);
        vi.advanceTimersByTime(1);
        expect(panel.isOpen).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the panel open while the pointer crosses from rail to panel', () => {
      vi.useFakeTimers();
      try {
        panel.setCompactMode(true);
        anchor.dispatchEvent(new MouseEvent('mouseenter'));
        anchor.dispatchEvent(new MouseEvent('mouseleave'));

        const panelEl = document.querySelector('.timeline-preview-panel') as HTMLElement;
        panelEl.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(200);
        expect(panel.isOpen).toBe(true);

        panelEl.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(160);
        expect(panel.isOpen).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the panel open while the pointer pauses in the compact hover gap', () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 100, 24, 600));
        const panelEl = document.querySelector('.timeline-preview-panel') as HTMLElement;
        Object.defineProperty(panelEl, 'offsetHeight', { value: 240, configurable: true });

        panel.setCompactMode(true);
        anchor.dispatchEvent(new MouseEvent('mouseenter'));
        anchor.dispatchEvent(new MouseEvent('mouseleave'));

        const bridge = document.querySelector('.gv-timeline-preview-hover-bridge') as HTMLElement;
        expect(bridge.classList.contains('gv-timeline-preview-hover-bridge-visible')).toBe(true);
        expect(bridge.style.left).toBe('888px');
        expect(bridge.style.width).toBe('12px');

        bridge.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(400);
        expect(panel.isOpen).toBe(true);

        bridge.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(160);
        expect(panel.isOpen).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('treats the compact hover bridge as part of the preview interaction area', () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 100, 24, 600));
      panel.setCompactMode(true);
      anchor.dispatchEvent(new MouseEvent('mouseenter'));
      expect(panel.isOpen).toBe(true);

      const bridge = document.querySelector('.gv-timeline-preview-hover-bridge') as HTMLElement;
      bridge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(panel.isOpen).toBe(true);
    });

    it('toggles the panel when the rail is clicked', () => {
      panel.setCompactMode(true);

      anchor.click();
      expect(panel.isOpen).toBe(true);
      expect(anchor.getAttribute('aria-expanded')).toBe('true');

      anchor.click();
      expect(panel.isOpen).toBe(false);
      expect(anchor.getAttribute('aria-expanded')).toBe('false');
    });

    it('stays open when pointer focus occurs between pointerdown and click', () => {
      panel.setCompactMode(true);

      anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(panel.isOpen).toBe(true);
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(panel.isOpen).toBe(true);
    });

    it('allows the hidden compact toggle to be closed manually while pinned', () => {
      panel.setCompactMode(true);
      panel.setPinned(true);
      panel.open();

      anchor.click();

      expect(panel.isOpen).toBe(false);
      expect(panel.isPinned).toBe(true);
    });
  });

  describe('rtl adaptation', () => {
    it('applies rtl direction when body has gv-rtl class', () => {
      document.body.classList.add(GV_RTL_CLASS);
      panel.reposition();

      const panelEl = document.querySelector('.timeline-preview-panel');
      const listEl = document.querySelector('.timeline-preview-list');
      expect(panelEl?.getAttribute('dir')).toBe('rtl');
      expect(listEl?.getAttribute('dir')).toBe('rtl');
    });

    it('keeps toggle on left side of timeline in rtl with viewport clamp', () => {
      const rectSpy = vi
        .spyOn(anchor, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(15, 60, 24, 500));

      document.body.classList.add(GV_RTL_CLASS);
      panel.reposition();

      const toggle = document.querySelector('.timeline-preview-toggle') as HTMLElement | null;
      expect(toggle?.style.left).toBe('8px');
      rectSpy.mockRestore();
    });
  });

  describe('close behavior', () => {
    it('closes on Escape key', () => {
      panel.open();
      expect(panel.isOpen).toBe(true);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(panel.isOpen).toBe(false);
    });

    it('closes on click outside', () => {
      panel.open();
      expect(panel.isOpen).toBe(true);

      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(panel.isOpen).toBe(false);
    });

    it('does not close on click inside panel', () => {
      panel.updateMarkers(makeMarkers(3));
      panel.open();

      const panelEl = document.querySelector('.timeline-preview-panel')!;
      panelEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(panel.isOpen).toBe(true);
    });

    it('ignores escape and outside click while pinned', () => {
      panel.setPinned(true);
      panel.open();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(panel.isOpen).toBe(true);
    });

    it('keeps current visibility when pinning is disabled', () => {
      panel.setPinned(true);
      panel.open();
      expect(panel.isOpen).toBe(true);

      panel.setPinned(false);
      expect(panel.isPinned).toBe(false);
      expect(panel.isOpen).toBe(true);
    });
  });

  describe('destroy', () => {
    it('removes all DOM elements', () => {
      panel.destroy();

      expect(document.querySelector('.timeline-preview-toggle')).toBeNull();
      expect(document.querySelector('.timeline-preview-panel')).toBeNull();
    });

    it('can be called multiple times safely', () => {
      panel.destroy();
      expect(() => panel.destroy()).not.toThrow();
    });
  });

  describe('resize debounce', () => {
    it('coalesces a resize burst into a single reposition', () => {
      vi.useFakeTimers();
      try {
        const spy = vi.spyOn(panel as unknown as { positionToggle: () => void }, 'positionToggle');

        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
        expect(spy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels a pending resize reposition on destroy', () => {
      vi.useFakeTimers();
      try {
        const spy = vi.spyOn(panel as unknown as { positionToggle: () => void }, 'positionToggle');

        window.dispatchEvent(new Event('resize'));
        panel.destroy();
        vi.advanceTimersByTime(200);

        expect(spy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
