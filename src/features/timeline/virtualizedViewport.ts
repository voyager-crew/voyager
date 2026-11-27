import { readScrollOffset } from './scrollMotion';

type ScrollTarget = HTMLElement | Window | null;

export function readViewportTop(target: ScrollTarget): number {
  return target && target !== window ? (target as HTMLElement).getBoundingClientRect().top : 0;
}

export function readViewportHeight(target: ScrollTarget): number {
  return target && target !== window
    ? (target as HTMLElement).clientHeight
    : window.innerHeight || document.documentElement.clientHeight || 0;
}

export function readScrollHeight(target: ScrollTarget): number {
  return target && target !== window
    ? (target as HTMLElement).scrollHeight
    : (document.scrollingElement || document.documentElement).scrollHeight;
}

export function isViewportAtBottom(target: ScrollTarget): boolean {
  const height = readViewportHeight(target);
  const scrollHeight = readScrollHeight(target);
  return scrollHeight > height && readScrollOffset(target) + height >= scrollHeight - 2;
}

/** Measure the mounted exchange in the same coordinates as the navigation offset. */
export function measureTurnBounds(item: Element, target: ScrollTarget) {
  const { top, bottom } = item.getBoundingClientRect();
  const origin = readScrollOffset(target) - readViewportTop(target);
  return { start: origin + top, end: origin + bottom };
}
