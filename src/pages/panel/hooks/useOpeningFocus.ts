import { useEffect } from 'react';

/** The shell adds this to the panel URL when ⌥V opened the panel; a pointer open adds nothing. */
const KEYBOARD_OPEN_HASH = '#keyboard';
/** Marks the first focus of a pointer open, which `panel.css` draws without a ring. */
export const QUIET_FOCUS_ATTRIBUTE = 'data-quiet-focus';

/**
 * The active tab takes focus as the panel opens. Focus a script moves into a
 * fresh frame matches `:focus-visible`, so after a pointer open that first
 * focus stays quiet until a key is pressed in the panel or focus moves on;
 * after a keyboard open the ring shows at once.
 */
export function useOpeningFocus(target: () => HTMLElement | null | undefined): void {
  useEffect(() => {
    const quiet = window.location.hash !== KEYBOARD_OPEN_HASH;
    let element: HTMLElement | null = null;
    const wake = () => element?.removeAttribute(QUIET_FOCUS_ATTRIBUTE);
    const frame = requestAnimationFrame(() => {
      element = target() ?? null;
      if (!element) return;
      if (quiet) {
        element.setAttribute(QUIET_FOCUS_ATTRIBUTE, '');
        element.addEventListener('blur', wake, { once: true });
      }
      element.focus({ preventScroll: true });
    });
    if (quiet) document.addEventListener('keydown', wake, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', wake, true);
      element?.removeEventListener('blur', wake);
    };
  }, [target]);
}
