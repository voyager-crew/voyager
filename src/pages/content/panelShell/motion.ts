/**
 * The panel's motion tokens and the floating ball's hide and show.
 *
 * `SPRING` (stiffness 380, damping 20, ~15% overshoot) moves small elements and
 * `SOFT` (260, 22, ~5%) the panel; both are damped springs sampled into CSS
 * `linear()` curves, the same values as the stylesheet's `--gv-ps-spring` and
 * `--gv-ps-soft`. A browser without `linear()` falls back to `OUT`. Reduced
 * motion makes every animation instant: callers get no animation at all.
 */
import type { BallMotion } from '../prompt/promptBall';

export const SPRING =
  'linear(0, 0.066, 0.226, 0.429, 0.635, 0.819, 0.964, 1.066, 1.126, 1.151, 1.149, 1.129, 1.1, 1.068, 1.038, 1.013, 0.995, 0.984, 0.978, 0.977, 0.979, 0.983, 0.988, 0.992, 0.997, 1, 1.002, 1.003, 1.004, 1.003, 1.003)';
export const SOFT =
  'linear(0, 0.045, 0.153, 0.294, 0.443, 0.586, 0.712, 0.818, 0.901, 0.963, 1.006, 1.033, 1.047, 1.053, 1.052, 1.047, 1.04, 1.032, 1.024, 1.017, 1.011, 1.007, 1.003, 1, 0.999, 0.998, 0.997, 0.997, 0.997, 0.998, 0.998)';
export const OUT = 'cubic-bezier(.2,.8,.2,1)';

export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** `element.animate`, or null where the browser lacks it or the user asked for less motion. */
export function animate(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof element.animate !== 'function' || reducedMotion()) return null;
  try {
    return element.animate(keyframes, options);
  } catch {
    // An easing the browser cannot parse (an older engine without `linear()`).
    try {
      return element.animate(keyframes, { ...options, easing: OUT });
    } catch {
      return null;
    }
  }
}

/** Resolves when every animation finished or was cancelled. */
export function settled(animations: readonly (Animation | null)[]): Promise<void> {
  return Promise.all(
    animations.map((animation) => animation?.finished.then(noop, noop) ?? Promise.resolve()),
  ).then(noop);
}

function noop(): void {}

/**
 * The ball's scale-and-fade and spring pop, played on the ball and the
 * decoration that sits on it (`companions`), which must move as one.
 */
export function createBallMotion(companions: () => readonly HTMLElement[]): BallMotion {
  let running: Animation[] = [];
  const cancel = (): void => {
    for (const animation of running) animation.cancel();
    running = [];
  };
  return {
    leave(ball) {
      cancel();
      const animations = [ball, ...companions()].flatMap((target) => [
        animate(target, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 200,
          easing: 'ease',
          fill: 'forwards',
        }),
        animate(
          target,
          [{ transform: getComputedStyle(target).transform || 'none' }, { transform: 'scale(.6)' }],
          { duration: 350, easing: SOFT, fill: 'forwards' },
        ),
      ]);
      running = animations.filter((animation): animation is Animation => animation !== null);
      if (running.length === 0) return null;
      const played = running;
      // Hand the ball back to its stylesheet once it may leave the layout.
      return settled(played).then(() => {
        if (running === played) cancel();
      });
    },
    enter(ball) {
      cancel();
      running = [ball, ...companions()]
        .map((target) =>
          animate(
            target,
            [
              { opacity: 0, transform: 'scale(.4)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 600, easing: SPRING },
          ),
        )
        .filter((animation): animation is Animation => animation !== null);
    },
  };
}
