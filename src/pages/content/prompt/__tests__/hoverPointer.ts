import { vi } from 'vitest';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Real layout for jsdom: each element answers `getBoundingClientRect` from
 * `layout`, which a test fills or computes (a card from its inline position).
 */
export function stubLayout(layout: (element: HTMLElement) => Rect | null): () => void {
  const spy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const rect = layout(this) ?? { left: 0, top: 0, right: 0, bottom: 0 };
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      return { ...rect, width, height, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect;
    });
  return () => spy.mockRestore();
}

const contains = (rect: Rect, x: number, y: number) =>
  x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

export interface PointerOptions {
  pointerType?: 'mouse' | 'touch' | 'pen';
  /** Browsers send pointer boundary events before mouse ones; `mouse-first` flips that. */
  order?: 'pointer-first' | 'mouse-first';
  /** Time each step takes, advanced on fake timers. */
  stepMs?: number;
}

/**
 * A pointer over hit-testable `targets`, delivering the events a browser
 * would: boundary events for whatever it left and entered, then `pointermove`.
 */
export function createPointer(targets: () => HTMLElement[], options: PointerOptions = {}) {
  const { pointerType = 'mouse', order = 'pointer-first', stepMs = 16 } = options;
  let over: HTMLElement | null = null;
  let at = { x: 0, y: 0 };

  function boundary(element: HTMLElement, kind: 'leave' | 'enter', x: number, y: number): void {
    const pointer = () =>
      element.dispatchEvent(
        new PointerEvent(`pointer${kind}`, { clientX: x, clientY: y, pointerType }),
      );
    const mouse = () =>
      element.dispatchEvent(new MouseEvent(`mouse${kind}`, { clientX: x, clientY: y }));
    if (order === 'pointer-first') {
      pointer();
      mouse();
    } else {
      mouse();
      pointer();
    }
  }

  function moveTo(x: number, y: number): void {
    at = { x, y };
    const hit =
      targets().find((element) => contains(element.getBoundingClientRect(), x, y)) ?? null;
    if (hit !== over) {
      if (over) boundary(over, 'leave', x, y);
      over = hit;
      if (hit) boundary(hit, 'enter', x, y);
    }
    (hit ?? document.body).dispatchEvent(
      new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType, bubbles: true }),
    );
  }

  return {
    moveTo,
    /** Glides to (x, y) in `steps` even steps, `stepMs` apart. */
    glideTo(x: number, y: number, steps = 10): void {
      const from = at;
      for (let i = 1; i <= steps; i += 1) {
        vi.advanceTimersByTime(stepMs);
        moveTo(from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
      }
    },
  };
}

/** Listeners added to `document` from now on and not yet removed. */
export function trackDocumentListeners(): () => string[] {
  const live = new Map<EventListenerOrEventListenerObject, string>();
  const capture = (options?: boolean | EventListenerOptions) =>
    typeof options === 'boolean' ? options : options?.capture === true;
  const key = (type: string, options?: boolean | EventListenerOptions) =>
    `${type}:${capture(options)}`;
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) live.set(listener, key(type, options));
    add(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (listener && live.get(listener) === key(type, options)) live.delete(listener);
    remove(type, listener, options);
  });
  return () => [...live.values()];
}
