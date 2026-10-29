/**
 * Floating panels from separate features announce when they open, so a
 * light-dismiss panel left open underneath can step aside.
 *
 * The Prompt Manager already closes on a pointerdown outside it. Opening the
 * Research Pack from the keyboard (Enter or Space on its launcher) has no
 * pointerdown, which left the Prompt Manager stacked above the new panel and
 * catching its clicks. The Voyager panel opens from ⌥V and the `/` menu, with
 * no pointerdown either, and its window takes no presses from the page.
 */
const SURFACE_OPENED_EVENT = 'gv-floating-surface-opened';

export type FloatingSurfaceId = 'prompt-manager' | 'research-pack' | 'voyager-panel';

export function announceSurfaceOpened(id: FloatingSurfaceId): void {
  window.dispatchEvent(new CustomEvent<FloatingSurfaceId>(SURFACE_OPENED_EVENT, { detail: id }));
}

/** Runs `handler` when any surface other than `self` opens. Returns the cleanup. */
export function onOtherSurfaceOpened(self: FloatingSurfaceId, handler: () => void): () => void {
  const listener = (event: Event): void => {
    if ((event as CustomEvent<unknown>).detail !== self) handler();
  };
  window.addEventListener(SURFACE_OPENED_EVENT, listener);
  return () => window.removeEventListener(SURFACE_OPENED_EVENT, listener);
}
