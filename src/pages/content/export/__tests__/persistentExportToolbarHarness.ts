import { vi } from 'vitest';

/** Removes every toolbar and host control a test mounted, and restores mocks. */
export function cleanUpToolbars(): void {
  document.querySelectorAll('.gv-persistent-export-toolbar').forEach((n) => n.remove());
  document.body
    .querySelectorAll(
      '[data-test-id="upgrade-button"], top-bar-actions, #conversation-header-actions, user-query',
    )
    .forEach((n) => n.remove());
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementsFromPoint');
}

export function mockRect(element: Element, rect: Partial<DOMRect>): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      top: rect.top ?? 0,
      left: rect.left ?? 0,
      right: rect.right ?? 0,
      bottom: rect.bottom ?? 0,
      width: rect.width ?? 0,
      height: rect.height ?? 0,
      toJSON: () => ({}),
    }),
  });
}

export function stubElementsFromPoint(hit: (x: number, y: number) => Element[]): void {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: hit,
  });
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Gives the toolbar the box the stylesheet would: `width` × `height`, its
 * right edge at `--gv-persistent-export-right` (84px by default) and its top
 * at the inline `top` a dragged spot sets, else at the dock's `dockTop`.
 */
export function mockToolbarGeometry(
  root: HTMLElement,
  { width, height, dockTop }: { width: number; height: number; dockTop: number },
): void {
  Object.defineProperty(root, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const right = parseFloat(root.style.getPropertyValue('--gv-persistent-export-right')) || 84;
      const top = root.style.top ? parseFloat(root.style.top) : dockTop;
      const left = window.innerWidth - right - width;
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
}

/**
 * Hit-tests the connected `controls` by their mocked rects, topmost last
 * registered, with `background` under every point, as a host header would.
 */
export function hitTestByRects(controls: () => Element[], background: Element): void {
  stubElementsFromPoint((x, y) => {
    const hits = controls().filter((element) => {
      if (!element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
    return [...hits.reverse(), background];
  });
}

/** A header button occupying `rect`. */
export function headerButton(parent: Element, rect: Partial<DOMRect>, label = ''): HTMLElement {
  const button = document.createElement('button');
  if (label) button.setAttribute('aria-label', label);
  mockRect(button, {
    ...rect,
    width: (rect.right ?? 0) - (rect.left ?? 0),
    height: (rect.bottom ?? 0) - (rect.top ?? 0),
  });
  parent.appendChild(button);
  return button;
}
