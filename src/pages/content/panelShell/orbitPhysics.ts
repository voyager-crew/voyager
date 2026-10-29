/**
 * The satellites' physics and geometry, free of the DOM.
 *
 * Every moving value is a damped spring (mass, stiffness, damping) advanced by
 * its exact solution, so a step is the same at 30 Hz or 144 Hz and a long
 * frame cannot blow up. A new target keeps the current value and velocity:
 * a satellite that is called back mid-flight turns around from where it is.
 *
 * Satellites move in polar coordinates around the ball's centre. `angle` runs
 * from the page-inward horizontal (0°) to the page-inward vertical (90°); `fx`
 * and `fy` (−1 or 1) mirror that quadrant toward the page interior.
 */

export interface Spring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/** One animated number: where it is, how fast it moves, where it is going. */
export interface SpringAxis {
  value: number;
  velocity: number;
  target: number;
}

/** Under-damped (ζ ≈ 0.52): out to the orbit with one soft overshoot. */
export const LAUNCH_RADIUS: Spring = { stiffness: 320, damping: 18.5, mass: 1 };
/** Softer and slower than the radius (ζ ≈ 0.64), so a satellite rides the arc to its slot. */
export const LAUNCH_ANGLE: Spring = { stiffness: 190, damping: 17.5, mass: 1 };
/** Critically damped: back into the ball without bouncing past it. */
export const RETRACT: Spring = { stiffness: 520, damping: 45.6, mass: 1 };
/** Hover and press: quick, with a visible spring back (ζ ≈ 0.4). */
export const PRESS: Spring = { stiffness: 700, damping: 21, mass: 1 };
/** The pull toward the pointer (ζ ≈ 0.7). */
export const PULL: Spring = { stiffness: 300, damping: 24, mass: 1 };
/** The label gliding between satellites (ζ ≈ 0.8). */
export const LABEL: Spring = { stiffness: 520, damping: 36.5, mass: 1 };

export const ORBIT = {
  /** Ball centre to satellite centre, px (ball 46, satellite 34: an 11–12px gap all round). */
  radius: 52,
  /** Two satellites: "Voyager panel" then "Hide". */
  angles: [19, 71],
  /** Only "Hide". */
  single: 45,
  /** Where satellites are born and return to. */
  birth: 45,
  /** The track runs this far past the outer satellites, degrees. */
  trackOverhang: 42,
  /** Satellite scale at the ball's centre, growing to 1 on the orbit. */
  bornScale: 0.35,
  hoverScale: 1.1,
  pressScale: 0.92,
  /** Pull toward the pointer: fraction of the offset, capped. */
  pullFactor: 0.2,
  pullMax: 3,
  /** Stretch along the velocity at `stretchSpeed` px/s and above. */
  stretch: 0.07,
  stretchSpeed: 1400,
  /** Launch stagger, retract stagger and the pause before a retract, ms. */
  launchStagger: 55,
  retractStagger: 30,
  retractDelay: 220,
} as const;

const EPSILON_VALUE = 0.02;
const EPSILON_VELOCITY = 0.05;

/** Advance `axis` by `dt` seconds along the exact damped-spring solution. */
export function advance(axis: SpringAxis, spring: Spring, dt: number): void {
  const { stiffness: k, damping: c, mass: m } = spring;
  const x0 = axis.value - axis.target;
  const v0 = axis.velocity;
  const omega = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let x: number;
  let v: number;
  if (Math.abs(zeta - 1) < 1e-6) {
    const decay = Math.exp(-omega * dt);
    const b = v0 + omega * x0;
    x = decay * (x0 + b * dt);
    v = decay * (v0 - omega * b * dt);
  } else if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * dt);
    const b = (v0 + zeta * omega * x0) / omegaD;
    const cos = Math.cos(omegaD * dt);
    const sin = Math.sin(omegaD * dt);
    x = decay * (x0 * cos + b * sin);
    v = decay * (v0 * cos - (x0 * omegaD + zeta * omega * b) * sin);
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega * (zeta - root);
    const r2 = -omega * (zeta + root);
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    x = c1 * e1 + c2 * e2;
    v = r1 * c1 * e1 + r2 * c2 * e2;
  }
  axis.value = axis.target + x;
  axis.velocity = v;
}

export function atRest(axis: SpringAxis): boolean {
  return (
    Math.abs(axis.value - axis.target) < EPSILON_VALUE && Math.abs(axis.velocity) < EPSILON_VELOCITY
  );
}

/** Jump to the target and stop: reduced motion, or a layer nobody can see. */
export function settle(axis: SpringAxis): void {
  axis.value = axis.target;
  axis.velocity = 0;
}

export function axis(value: number): SpringAxis {
  return { value, velocity: 0, target: value };
}

/** A point at `radius` and `angle` from the ball's centre, mirrored toward the page. */
export function orbitPoint(
  fx: number,
  fy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: fx * radius * Math.cos(rad), y: fy * radius * Math.sin(rad) };
}

/** Screen velocity of a polar point, px/s, from its radial and angular velocities. */
export function orbitVelocity(
  fx: number,
  fy: number,
  radius: SpringAxis,
  angle: SpringAxis,
): { x: number; y: number } {
  const rad = (angle.value * Math.PI) / 180;
  const turn = (angle.velocity * Math.PI) / 180;
  return {
    x: fx * (radius.velocity * Math.cos(rad) - radius.value * Math.sin(rad) * turn),
    y: fy * (radius.velocity * Math.sin(rad) + radius.value * Math.cos(rad) * turn),
  };
}

/** The track: the orbit circle from `from` to `to` degrees, centred on the ball. */
export function trackPath(fx: number, fy: number, from: number, to: number): string {
  const start = orbitPoint(fx, fy, ORBIT.radius, from);
  const end = orbitPoint(fx, fy, ORBIT.radius, to);
  // Growing angle turns clockwise on screen when exactly one axis is mirrored.
  const sweep = fx * fy > 0 ? 1 : 0;
  const large = to - from > 180 ? 1 : 0;
  const r = ORBIT.radius;
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
