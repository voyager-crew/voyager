import { useCallback, useEffect, useRef, useState } from 'react';

import { type PopupSectionId, popupSectionAnchorId } from './usePopupSections';

/** Room a revealed link keeps from the bar's edge, clear of the arrow over it. */
const EDGE_ROOM_PX = 44;
/** How far below the sticky header a card's top counts as the one being read. */
const READING_LINE_PX = 24;
/** Share of the bar's width one arrow click moves. */
const PAGE_SHARE = 0.7;
/** Pixels per line or page, for a wheel that reports lines (Firefox) or pages. */
const LINE_PX = 16;

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function scrollBarBy(nav: HTMLElement, left: number): void {
  if (typeof nav.scrollBy === 'function') {
    nav.scrollBy({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } else {
    nav.scrollLeft += left;
  }
}

/** Whether the bar has more to show past its left and right edges, RTL included. */
function overflowSides(nav: HTMLElement, rtl: boolean): { left: boolean; right: boolean } {
  const max = nav.scrollWidth - nav.clientWidth;
  if (max <= 1) return { left: false, right: false };
  // RTL bars start at 0 and run negative toward the left.
  const fromLeft = rtl ? nav.scrollLeft + max : nav.scrollLeft;
  return { left: fromLeft > 1, right: fromLeft < max - 1 };
}

function wheelPixels(event: WheelEvent, nav: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * LINE_PX;
  if (event.deltaMode === 2) return event.deltaY * nav.clientWidth;
  return event.deltaY;
}

function scrollerAtBottom(target: EventTarget | null): boolean {
  const scroller = target instanceof Element ? target : document.scrollingElement;
  if (!scroller) return false;
  return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
}

/**
 * The table of contents as a mouse can work it: arrows on whichever side has
 * more links, the wheel turned sideways over the bar, and the card being read
 * marked in the bar and kept in view.
 */
export function usePopupTocBar(sections: readonly PopupSectionId[], rtl: boolean) {
  const navRef = useRef<HTMLElement | null>(null);
  const [sides, setSides] = useState({ left: false, right: false });
  const [current, setCurrent] = useState<PopupSectionId | null>(null);
  // The card a link was clicked for, marked while it stays on screen.
  const pickedRef = useRef<PopupSectionId | null>(null);

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const next = overflowSides(nav, rtl);
    setSides((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, [rtl]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    measure();
    nav.addEventListener('scroll', measure, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(nav);
    if (nav.firstElementChild) resize?.observe(nav.firstElementChild);

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const towardEnd = event.deltaY > 0;
      const side = overflowSides(nav, rtl);
      // Past the bar's end the wheel goes back to scrolling the settings.
      const physicalRight = towardEnd !== rtl;
      if (physicalRight ? !side.right : !side.left) return;
      event.preventDefault();
      const pixels = wheelPixels(event, nav);
      nav.scrollLeft += rtl ? -pixels : pixels;
    };
    nav.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      nav.removeEventListener('scroll', measure);
      nav.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    };
  }, [measure, rtl, sections]);

  useEffect(() => {
    let frame: number | null = null;
    let bottom = false;
    const update = () => {
      frame = null;
      const nav = navRef.current;
      const header = nav?.closest<HTMLElement>('[data-popup-header]');
      const line = (header?.getBoundingClientRect().bottom ?? 0) + READING_LINE_PX;
      const cards = sections.flatMap((id) => {
        const element = document.getElementById(popupSectionAnchorId(id));
        return element ? [{ id, rect: element.getBoundingClientRect() }] : [];
      });
      if (cards.length === 0) return;
      // A clicked link stays marked through its smooth scroll, which may stop short of the line.
      if (cards.some((card) => card.id === pickedRef.current)) return;
      if (bottom) {
        setCurrent(cards[cards.length - 1].id);
        return;
      }
      let reading = cards[0].id;
      for (const card of cards) if (card.rect.top <= line) reading = card.id;
      setCurrent(reading);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return;
      bottom = scrollerAtBottom(event.target);
      if (frame === null) frame = requestAnimationFrame(update);
    };
    // The person scrolling for themselves hands the mark back to the reading position.
    const release = (event: Event) => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return;
      pickedRef.current = null;
    };
    const releaseOn = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const type of releaseOn) document.addEventListener(type, release, { passive: true });
    // Capture: the popup scrolls its root element, the options page the window.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    update();
    return () => {
      for (const type of releaseOn) document.removeEventListener(type, release);
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Keep the marked link inside the bar, clear of the arrows.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !current) return;
    const link = nav.querySelector<HTMLElement>(`[data-toc-section="${current}"]`);
    if (!link) return;
    const bar = nav.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    if (box.left < bar.left + EDGE_ROOM_PX) scrollBarBy(nav, box.left - bar.left - EDGE_ROOM_PX);
    else if (box.right > bar.right - EDGE_ROOM_PX)
      scrollBarBy(nav, box.right - bar.right + EDGE_ROOM_PX);
  }, [current]);

  const page = useCallback((direction: 'left' | 'right') => {
    const nav = navRef.current;
    if (!nav) return;
    const distance = nav.clientWidth * PAGE_SHARE;
    scrollBarBy(nav, direction === 'left' ? -distance : distance);
  }, []);

  const pick = useCallback((id: PopupSectionId) => {
    pickedRef.current = id;
    setCurrent(id);
  }, []);

  return { navRef, sides, current, page, pick };
}
