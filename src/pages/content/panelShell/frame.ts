import { type PanelFrameBootstrap, bindPanelFrame } from './bootstrap';
import { SOFT, animate, settled } from './motion';
/**
 * The panel window on the host page: the extension page in an iframe, at the
 * prototype's fixed size, placed, dragged, recentered and animated here. The
 * panel page inside sends the drag; this side moves the frame, so the page
 * under it never sees the pointer.
 */
import type { PanelPoint } from './positions';

/** The panel keeps this far from every viewport edge. */
const MARGIN = 12;
const GLIDE_MS = 520;
const CLOSE_EASING = 'cubic-bezier(.4,0,.9,.6)';

export interface PanelFrame {
  readonly element: HTMLDivElement;
  readonly iframe: HTMLIFrameElement;
  contains(node: Node): boolean;
  setScheme(scheme: 'light' | 'dark'): void;
  /** Places the top-left corner at `point` (centered when null), clamped into the viewport. */
  place(point: PanelPoint | null): PanelPoint;
  position(): PanelPoint;
  dragStart(): void;
  /** Cumulative deltas since the drag started; returns where the panel now is. */
  dragMove(deltaX: number, deltaY: number): PanelPoint;
  dragEnd(deltaX: number, deltaY: number): PanelPoint;
  glideToCenter(): void;
  setPeek(faded: boolean): void;
  /** Drops a drag or fade the panel page can no longer finish. */
  endInteraction(): void;
  /** Grows out of `anchor` (a viewport point) or, without one, scales in. */
  playOpen(anchor: { x: number; y: number } | null): void;
  /** The reverse; resolves when the panel may leave the page. */
  playClose(anchor: { x: number; y: number } | null): Promise<void>;
  destroy(): void;
}

/** The size the stylesheet gives the panel: min(880px, 100vw − 24px) × min(560px, 100vh − 24px). */
export function panelSize(): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(880, window.innerWidth - 2 * MARGIN)),
    height: Math.max(0, Math.min(560, window.innerHeight - 2 * MARGIN)),
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function createPanelFrame(url: string, bootstrap: PanelFrameBootstrap): PanelFrame {
  const element = document.createElement('div');
  element.className = 'gv-ps-panel';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Voyager');
  element.setAttribute('aria-modal', 'false');
  const iframe = document.createElement('iframe');
  iframe.className = 'gv-ps-frame';
  iframe.title = 'Voyager';
  iframe.src = url;
  element.appendChild(iframe);
  document.body.appendChild(element);
  const stopBootstrap = bindPanelFrame(element, iframe, url, bootstrap);

  let current: PanelPoint = { x: 0, y: 0 };
  let dragBase: PanelPoint | null = null;
  let glideTimer: number | null = null;
  let running: Animation | null = null;

  function place(point: PanelPoint | null): PanelPoint {
    const { width, height } = panelSize();
    const target = point ?? {
      x: (window.innerWidth - width) / 2,
      y: (window.innerHeight - height) / 2,
    };
    current = {
      x: clamp(target.x, MARGIN, window.innerWidth - width - MARGIN),
      y: clamp(target.y, MARGIN, window.innerHeight - height - MARGIN),
    };
    element.style.left = `${Math.round(current.x)}px`;
    element.style.top = `${Math.round(current.y)}px`;
    return current;
  }

  /** From the panel's center to `anchor`, in the panel's own coordinates. */
  function deltaTo(anchor: { x: number; y: number }): { dx: number; dy: number } {
    const { width, height } = panelSize();
    return { dx: anchor.x - (current.x + width / 2), dy: anchor.y - (current.y + height / 2) };
  }

  function play(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    running?.cancel();
    running = animate(element, keyframes, options);
    return running;
  }

  const clearGlide = (): void => {
    if (glideTimer !== null) window.clearTimeout(glideTimer);
    glideTimer = null;
    element.classList.remove('gv-ps-glide');
  };

  return {
    element,
    iframe,
    contains: (node) => element.contains(node),
    setScheme(scheme) {
      // A frame whose scheme differs from its embedder's paints an opaque backdrop.
      iframe.style.colorScheme = scheme;
    },
    place,
    position: () => current,
    dragStart() {
      clearGlide();
      dragBase = current;
      element.classList.add('gv-ps-dragging');
    },
    dragMove(deltaX, deltaY) {
      const base = dragBase ?? current;
      return place({ x: base.x + deltaX, y: base.y + deltaY });
    },
    dragEnd(deltaX, deltaY) {
      const base = dragBase ?? current;
      dragBase = null;
      element.classList.remove('gv-ps-dragging');
      return place({ x: base.x + deltaX, y: base.y + deltaY });
    },
    glideToCenter() {
      clearGlide();
      element.classList.add('gv-ps-glide');
      place(null);
      glideTimer = window.setTimeout(clearGlide, GLIDE_MS);
    },
    setPeek(faded) {
      element.classList.toggle('gv-ps-peek', faded);
    },
    endInteraction() {
      dragBase = null;
      element.classList.remove('gv-ps-dragging', 'gv-ps-peek');
    },
    playOpen(anchor) {
      if (anchor) {
        const { dx, dy } = deltaTo(anchor);
        play(
          [
            {
              transform: `translate(${dx}px,${dy}px) scale(.06)`,
              opacity: 0,
              filter: 'blur(10px)',
              borderRadius: '60px',
            },
            { opacity: 1, offset: 0.3 },
            { transform: 'none', opacity: 1, filter: 'blur(0)', borderRadius: '18px' },
          ],
          { duration: 640, easing: SOFT },
        );
        return;
      }
      play(
        [
          { transform: 'scale(.94)', opacity: 0, filter: 'blur(6px)' },
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
        ],
        { duration: 420, easing: SOFT },
      );
    },
    playClose(anchor) {
      const keyframes: Keyframe[] = anchor
        ? [
            { transform: 'none', opacity: 1, filter: 'blur(0)', borderRadius: '18px' },
            { opacity: 1, offset: 0.55 },
            {
              transform: `translate(${deltaTo(anchor).dx}px,${deltaTo(anchor).dy}px) scale(.06)`,
              opacity: 0,
              filter: 'blur(8px)',
              borderRadius: '60px',
            },
          ]
        : [
            { transform: 'none', opacity: 1 },
            { transform: 'scale(.96)', opacity: 0 },
          ];
      const animation = play(keyframes, {
        duration: anchor ? 300 : 180,
        easing: CLOSE_EASING,
        fill: 'forwards',
      });
      return settled([animation]);
    },
    destroy() {
      stopBootstrap();
      clearGlide();
      running?.cancel();
      running = null;
      element.remove();
    },
  };
}
