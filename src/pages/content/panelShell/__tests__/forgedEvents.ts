/**
 * `isUserEvent` for the shell's tests, as `vi.mock('@/core/utils/userEvent',
 * () => import('./forgedEvents'))`. jsdom makes no trusted events, so every
 * event counts as the user's or the browser's here, except one a test forges
 * the way a host page script would, with `dispatchEvent`.
 */
const forged = new WeakSet<Event>();

export function forge<T extends Event>(event: T): T {
  forged.add(event);
  return event;
}

export function isUserEvent(event: Event): boolean {
  return !forged.has(event);
}
