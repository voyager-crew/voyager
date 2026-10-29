import { createToaster } from '@/core/ui/toast/toaster';

const FOREGROUND_TOAST_TEXT_KEY = 'responseCompleteForegroundToast';
const FOREGROUND_TOAST_TEXT_FALLBACK = 'New response completed';
const FOREGROUND_TOAST_VISIBLE_MS = 3200;
const LATEST_RESPONSE_VISIBLE_MARGIN_PX = 96;
const BOTTOM_SCROLL_THRESHOLD_PX = 160;

function getI18nMessage(key: string, fallback: string): string {
  try {
    return chrome.i18n?.getMessage?.(key) || fallback;
  } catch {
    return fallback;
  }
}

function getDocumentScrollRoot(): HTMLElement {
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

function getScrollRoot(anchor: Element | null = null): HTMLElement {
  let current = anchor?.parentElement ?? null;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const hasScrollableOverflow = /auto|scroll|overlay/.test(style.overflowY);
    if (
      hasScrollableOverflow &&
      current.scrollHeight - current.clientHeight > BOTTOM_SCROLL_THRESHOLD_PX
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return getDocumentScrollRoot();
}

function getRemainingScrollDistance(anchor: Element | null = null): number {
  const scrollRoot = getScrollRoot(anchor);
  return Math.max(0, scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight);
}

function isLatestResponseVisible(response: HTMLElement): boolean {
  const rect = response.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) return false;

  return (
    rect.bottom >= LATEST_RESPONSE_VISIBLE_MARGIN_PX &&
    rect.top <= window.innerHeight - LATEST_RESPONSE_VISIBLE_MARGIN_PX
  );
}

function shouldShowForegroundCompletionToast(response: HTMLElement | null): boolean {
  if (!response) return false;
  if (isLatestResponseVisible(response)) return false;
  return getRemainingScrollDistance(response) > BOTTOM_SCROLL_THRESHOLD_PX;
}

export function createForegroundCompletionToast({
  getScrollTarget,
}: {
  getScrollTarget: () => HTMLElement | null;
}) {
  const toaster = createToaster();

  function scrollToLatestResponse(): void {
    const target = getScrollTarget();
    if (target) {
      target.scrollIntoView({ block: 'end', behavior: 'smooth' });
      return;
    }
    const scrollRoot = getScrollRoot();
    scrollRoot.scrollTo({ top: scrollRoot.scrollHeight, behavior: 'smooth' });
  }

  return {
    showIfNeeded(response: HTMLElement | null): void {
      if (!shouldShowForegroundCompletionToast(response)) return;
      // One channel: another completion restarts the open toast's timer.
      toaster.show({
        channel: 'response-complete',
        message: getI18nMessage(FOREGROUND_TOAST_TEXT_KEY, FOREGROUND_TOAST_TEXT_FALLBACK),
        tone: 'success',
        durationMs: FOREGROUND_TOAST_VISIBLE_MS,
        onActivate: scrollToLatestResponse,
      });
    },
    stop(): void {
      toaster.clear();
    },
  };
}
