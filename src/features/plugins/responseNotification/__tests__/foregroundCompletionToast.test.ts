import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';

import { createForegroundCompletionToast } from '../foregroundCompletionToast';

// The global chrome mock answers getMessage with the key.
const TEXT = 'responseCompleteForegroundToast';

function setScrollMetrics(element: HTMLElement, scrollTop = 0): void {
  Object.defineProperties(element, {
    scrollHeight: { value: 2200, configurable: true },
    clientHeight: { value: 500, configurable: true },
    scrollTop: { value: scrollTop, configurable: true },
  });
}

function setRect(element: HTMLElement, rect: DOMRect): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
}

const offScreen = () => new DOMRect(0, window.innerHeight + 100, 500, 100);
let toast: ReturnType<typeof createForegroundCompletionToast> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<article>Completed response</article>';
  setScrollMetrics(document.documentElement);
});

afterEach(() => {
  toast?.stop();
  toast = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('foreground completion toast', () => {
  it('only shows for an off-screen response with enough remaining scroll distance', () => {
    const response = document.querySelector('article')!;
    toast = createForegroundCompletionToast({ getScrollTarget: () => response });

    toast.showIfNeeded(null);
    setRect(response, new DOMRect(0, 100, 500, 100));
    toast.showIfNeeded(response);
    expect(toastDriver.all()).toEqual([]);

    setRect(response, offScreen());
    setScrollMetrics(document.documentElement, 1540);
    toast.showIfNeeded(response);
    expect(toastDriver.all()).toEqual([]);

    setScrollMetrics(document.documentElement, 1539);
    toast.showIfNeeded(response);
    expect(toastDriver.messages()).toEqual([TEXT]);
  });

  it('reads a nested response scroll root', () => {
    document.body.innerHTML =
      '<section style="overflow-y: auto"><article>Answer</article></section>';
    const response = document.querySelector('article')!;
    setScrollMetrics(document.documentElement, 1700);
    setScrollMetrics(document.querySelector('section')!);
    setRect(response, offScreen());

    toast = createForegroundCompletionToast({ getScrollTarget: () => response });
    toast.showIfNeeded(response);

    expect(toastDriver.messages()).toEqual([TEXT]);
  });

  it('scrolls to the current target when pressed, and closes', () => {
    const completed = document.querySelector('article')!;
    setRect(completed, offScreen());
    let target = completed;
    toast = createForegroundCompletionToast({ getScrollTarget: () => target });
    toast.showIfNeeded(completed);
    target = document.createElement('article');
    const scroll = vi.fn();
    target.scrollIntoView = scroll;

    toastDriver.press(toastDriver.find(TEXT)!, TEXT);

    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
    expect(toastDriver.all()).toEqual([]);
  });

  it('scrolls the document to the end when the target is no longer available', () => {
    const response = document.querySelector('article')!;
    setRect(response, offScreen());
    const scroll = vi.fn();
    document.documentElement.scrollTo = scroll;
    toast = createForegroundCompletionToast({ getScrollTarget: () => null });
    toast.showIfNeeded(response);

    toastDriver.press(toastDriver.find(TEXT)!, TEXT);

    expect(scroll).toHaveBeenCalledWith({ top: 2200, behavior: 'smooth' });
  });

  it('extends the deadline on another completion and can show again after a stop', () => {
    const response = document.querySelector('article')!;
    setRect(response, offScreen());
    toast = createForegroundCompletionToast({ getScrollTarget: () => response });
    toast.showIfNeeded(response);
    vi.advanceTimersByTime(3000);
    toast.showIfNeeded(response);
    vi.advanceTimersByTime(200);
    expect(toastDriver.all()).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(toastDriver.all()).toEqual([]);

    toast.showIfNeeded(response);
    toast.stop();
    expect(toastDriver.all()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    toast.showIfNeeded(response);
    expect(toastDriver.messages()).toEqual([TEXT]);
  });
});
