import type {
  ExportCrawlDirection,
  ExportCrawlUpwardScroll,
} from '@/features/plugins/sites/sections/exportCrawlData';

/**
 * The conversation scroller seen as one axis that starts at the oldest turn.
 *
 * ChatGPT's thread scrolls in a `flex-direction: column-reverse` box (measured
 * live): `scrollTop` is 0 at the newest turn and `-range` at the oldest. Every
 * offset here grows from the conversation's start whichever way the box runs.
 */
export interface ScrollView {
  /** Offset of the viewport's top from the conversation's start. */
  offset(): number;
  range(): number;
  viewportHeight(): number;
  scrollTo(offset: number): void;
  /** Offset of an element's top from the conversation's start. */
  offsetOf(element: Element): number;
}

/** How the scroll view reads the box's direction and moves up; the current page's by default. */
export interface ScrollViewBehavior {
  readonly direction: ExportCrawlDirection;
  readonly upwardScroll: ExportCrawlUpwardScroll;
}

const DEFAULT_SCROLL_BEHAVIOR: ScrollViewBehavior = {
  direction: 'auto',
  upwardScroll: 'wheelRelease',
};

const SCROLLABLE_OVERFLOW = /(auto|scroll|overlay)/;

/**
 * The nearest ancestor of `element` styled to scroll vertically, else null
 * (the window). It need not overflow yet: a thread whose first page fits the
 * viewport overflows only once older history loads, and the crawl must keep
 * scrolling that same box (measured live: the only such ancestor of an item is
 * `[data-app-action-timeline-scroll]`).
 */
export function findScrollContainer(element: Element): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (SCROLLABLE_OVERFLOW.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

function isReverseScroller(container: HTMLElement, direction: ExportCrawlDirection): boolean {
  if (direction !== 'auto') return direction === 'reverse';
  const style = getComputedStyle(container);
  return style.flexDirection === 'column-reverse' && /flex/.test(style.display);
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

function elementScrollView(container: HTMLElement, behavior: ScrollViewBehavior): ScrollView {
  const reverse = isReverseScroller(container, behavior.direction);
  const range = () => Math.max(0, container.scrollHeight - container.clientHeight);
  const offset = () => (reverse ? container.scrollTop + range() : container.scrollTop);
  return {
    offset,
    range,
    viewportHeight: () => container.clientHeight,
    scrollTo(next) {
      const target = clamp(next, range());
      // ChatGPT pins the thread to its newest turn and pulls a scripted scroll
      // back down until a wheel moves it up (measured live, November 2026;
      // #1071). A scripted wheel releases the pin and scrolls nothing itself.
      if (behavior.upwardScroll === 'wheelRelease' && target < offset()) {
        container.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }),
        );
      }
      container.scrollTop = reverse ? target - range() : target;
    },
    offsetOf(element) {
      return offset() + element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    },
  };
}

function windowScrollView(): ScrollView {
  const scrolling = () => document.scrollingElement || document.documentElement;
  const range = () => Math.max(0, scrolling().scrollHeight - window.innerHeight);
  const offset = () => window.scrollY || scrolling().scrollTop || 0;
  return {
    offset,
    range,
    viewportHeight: () => window.innerHeight,
    scrollTo(next) {
      try {
        window.scrollTo(0, clamp(next, range()));
      } catch {
        scrolling().scrollTop = clamp(next, range());
      }
    },
    offsetOf: (element) => offset() + element.getBoundingClientRect().top,
  };
}

export function createScrollView(
  container: HTMLElement | null,
  behavior: ScrollViewBehavior = DEFAULT_SCROLL_BEHAVIOR,
): ScrollView {
  return container ? elementScrollView(container, behavior) : windowScrollView();
}
