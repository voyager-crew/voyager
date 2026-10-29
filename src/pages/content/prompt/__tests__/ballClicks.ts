/**
 * `isUserEvent` for tests that click the floating ball the way the user does,
 * as `vi.mock('@/core/utils/userEvent', () => import('…/ballClicks'))`.
 * jsdom makes no trusted events, so a click on the ball counts as the user's;
 * every other event keeps the real check.
 */
/** `PROMPT_TRIGGER_ELEMENT_ID`, spelled out so this module imports nothing. */
const BALL_ID = 'gv-pm-trigger';

export function isUserEvent(event: Event): boolean {
  if (event.isTrusted) return true;
  return (
    event.type === 'click' &&
    event.target instanceof Element &&
    event.target.closest(`#${BALL_ID}`) !== null
  );
}
