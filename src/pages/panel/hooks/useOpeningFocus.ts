import { useEffect } from 'react';

/** Marks the panel's first focus, which `panel.css` draws without a ring. */
export const QUIET_FOCUS_ATTRIBUTE = 'data-quiet-focus';

/**
 * The active tab takes focus as the panel opens. Focus a script moves into a
 * fresh frame matches `:focus-visible`, so that first focus stays quiet until a
 * key is pressed in the panel or focus moves on, however the panel was opened.
 */
export function useOpeningFocus(target: () => HTMLElement | null | undefined): void {
  useEffect(() => {
    let element: HTMLElement | null = null;
    const wake = () => element?.removeAttribute(QUIET_FOCUS_ATTRIBUTE);
    const frame = requestAnimationFrame(() => {
      element = target() ?? null;
      if (!element) return;
      element.setAttribute(QUIET_FOCUS_ATTRIBUTE, '');
      element.addEventListener('blur', wake, { once: true });
      element.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', wake, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', wake, true);
      element?.removeEventListener('blur', wake);
    };
  }, [target]);
}
