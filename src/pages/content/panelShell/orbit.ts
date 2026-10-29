/**
 * The satellites in motion: born at the ball, they ride the orbit out to
 * their slots on under-damped springs, draw the track as they go, and fold
 * back along it. One label glides to whichever satellite is pointed at or
 * focused; hover, press and a slight pull toward the pointer are springs too.
 *
 * Only transform and opacity change per frame (plus the track's dash). The
 * frame loop is a machine with two states: `moving` owns the frame request,
 * `resting` owns nothing, so a settled entry asks for no frames and a stop
 * cancels the one in flight. Reduced motion jumps every spring to its target.
 */
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import { reducedMotion } from './motion';
import {
  LABEL,
  LAUNCH_ANGLE,
  LAUNCH_RADIUS,
  ORBIT,
  PRESS,
  PULL,
  RETRACT,
  type SpringAxis,
  advance,
  atRest,
  axis,
  orbitPoint,
  orbitVelocity,
  settle,
  trackPath,
} from './orbitPhysics';

export type SatelliteSlot = 'panel' | 'hide';

export interface OrbitParts {
  /** The layer sitting on the ball's box; satellites are centred on it. */
  readonly layer: HTMLElement;
  readonly satellites: Readonly<Record<SatelliteSlot, HTMLElement>>;
  readonly track: SVGPathElement;
  readonly trackFade: SVGLinearGradientElement;
  readonly label: HTMLElement;
  /** The label's content for a satellite, in the current language. */
  labelFor(slot: SatelliteSlot): Node[];
}

export interface Orbit {
  /** Out to the orbit, or back into the ball (after a short pause unless `immediate`). */
  setOpen(open: boolean, options?: { immediate?: boolean }): void;
  /** Mirror toward the page interior: −1 or 1 per axis. */
  setFan(fx: number, fy: number): void;
  /** Only "Hide" flies out. */
  setSingle(single: boolean): void;
  /** Back in the ball at once with nothing moving: the layer is hidden. */
  rest(): void;
  relabel(): void;
  destroy(): void;
}

interface Satellite {
  readonly slot: SatelliteSlot;
  readonly element: HTMLElement;
  readonly radius: SpringAxis;
  readonly angle: SpringAxis;
  readonly scale: SpringAxis;
  readonly pullX: SpringAxis;
  readonly pullY: SpringAxis;
  /** Heading out (launch springs) or in (retract spring). */
  out: boolean;
  /** A launch or retract waiting for the loop clock. */
  queued: { readonly out: boolean; readonly at: number } | null;
  hovered: boolean;
  focused: boolean;
  pressed: boolean;
}

interface LabelState {
  /** The satellite it names, or null while it is away. */
  slot: SatelliteSlot | null;
  readonly x: SpringAxis;
  readonly y: SpringAxis;
  timer: number;
}

type LoopState = { readonly status: 'resting' } | { readonly status: 'moving' };
type LoopEvent = { readonly type: 'kick' } | { readonly type: 'settled' };

const RESTING: LoopState = { status: 'resting' };
const MOVING: LoopState = { status: 'moving' };
/** A label leaving one satellite waits this long for the pointer to reach the next. */
const LABEL_LINGER_MS = 120;
const LABEL_OPEN_CLASS = 'gv-ps-tip-on';
const FIRST_FRAME = 1 / 60;
const LONGEST_FRAME = 1 / 30;

function transitionLoop(state: LoopState, event: LoopEvent): LoopState {
  if (event.type === 'kick') return state.status === 'moving' ? state : MOVING;
  return state.status === 'resting' ? state : RESTING;
}

function keyboardFocused(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

const px = (value: number): string => `${value.toFixed(2)}px`;

/** A slight stretch along the direction of travel, none at rest. */
function stretchAlong(velocity: { x: number; y: number }): string {
  const speed = Math.hypot(velocity.x, velocity.y);
  const stretch = 1 + ORBIT.stretch * Math.min(1, speed / ORBIT.stretchSpeed);
  if (stretch < 1.002) return '';
  const turn = ((Math.atan2(velocity.y, velocity.x) * 180) / Math.PI).toFixed(1);
  return ` rotate(${turn}deg) scale(${stretch.toFixed(3)}, ${(1 / stretch).toFixed(3)}) rotate(${-turn}deg)`;
}

function moving(satellite: Satellite): boolean {
  return [
    satellite.radius,
    satellite.angle,
    satellite.scale,
    satellite.pullX,
    satellite.pullY,
  ].some((value) => !atRest(value));
}

export function createOrbit(parts: OrbitParts): Orbit {
  const life = new AbortController();
  const satellites: Satellite[] = (['panel', 'hide'] as const).map((slot) => ({
    slot,
    element: parts.satellites[slot],
    radius: axis(0),
    angle: axis(ORBIT.birth),
    scale: axis(1),
    pullX: axis(0),
    pullY: axis(0),
    out: false,
    queued: null,
    hovered: false,
    focused: false,
    pressed: false,
  }));
  const label: LabelState = { slot: null, x: axis(0), y: axis(0), timer: 0 };
  let fx = -1;
  let fy = -1;
  let single = false;
  let open = false;
  /** Loop time, ms: launches and retracts are scheduled on it. */
  let clock = 0;

  const active = (): Satellite[] =>
    single ? satellites.filter((s) => s.slot === 'hide') : satellites;
  const home = (satellite: Satellite): number =>
    single ? ORBIT.single : ORBIT.angles[satellite.slot === 'panel' ? 0 : 1];
  const centre = (): { x: number; y: number } => ({
    x: (parts.layer.offsetWidth || 46) / 2,
    y: (parts.layer.offsetHeight || 46) / 2,
  });

  function retarget(satellite: Satellite): void {
    const target = satellite.pressed
      ? ORBIT.pressScale
      : satellite.hovered || satellite.focused
        ? ORBIT.hoverScale
        : 1;
    satellite.scale.target = target;
  }

  function launch(satellite: Satellite, out: boolean): void {
    satellite.queued = null;
    satellite.out = out;
    satellite.radius.target = out ? ORBIT.radius : 0;
    satellite.angle.target = out ? home(satellite) : ORBIT.birth;
    if (!out) {
      satellite.hovered = satellite.focused = satellite.pressed = false;
      satellite.pullX.target = satellite.pullY.target = 0;
      retarget(satellite);
    }
  }

  /** Where the label sits beside a satellite: above or below a near-vertical one, else outside. */
  function labelTarget(satellite: Satellite): { x: number; y: number } {
    const c = centre();
    const at = orbitPoint(fx, fy, ORBIT.radius, home(satellite));
    const reach = 17 * ORBIT.hoverScale + 8;
    const width = parts.label.offsetWidth;
    const height = parts.label.offsetHeight;
    if (home(satellite) > 60) {
      return { x: c.x + at.x - width / 2, y: c.y + at.y + (fy < 0 ? -(reach + height) : reach) };
    }
    return { x: c.x + at.x + (fx < 0 ? -(reach + width) : reach), y: c.y + at.y - height / 2 };
  }

  function render(): void {
    let reveal = 0;
    for (const satellite of satellites) {
      const { radius, angle, scale, element } = satellite;
      const progress = radius.value / ORBIT.radius;
      // On the same curve as the satellite's opacity, so the track shows and goes with them.
      reveal = Math.max(reveal, Math.min(1, Math.max(0, (progress - 0.12) / 0.88)));
      const growth =
        progress < 1
          ? ORBIT.bornScale + (1 - ORBIT.bornScale) * Math.max(0, progress)
          : 1 + 0.3 * (progress - 1);
      const at = orbitPoint(fx, fy, radius.value, angle.value);
      const along = stretchAlong(orbitVelocity(fx, fy, radius, angle));
      element.style.transform = `translate(${px(at.x + satellite.pullX.value)}, ${px(at.y + satellite.pullY.value)})${along} scale(${(growth * scale.value).toFixed(3)})`;
      element.style.opacity = Math.min(1, Math.max(0, (progress - 0.12) / 0.4)).toFixed(3);
    }
    // The track draws out from the diagonal with the leading satellite and folds with the last.
    parts.track.style.strokeDashoffset = String(-(1 - reveal) / 2);
    parts.track.style.strokeDasharray = `${reveal.toFixed(4)} 1`;
    parts.track.style.opacity = reveal > 0.005 ? '1' : '0';
    parts.label.style.transform = `translate(${px(label.x.value)}, ${px(label.y.value)})`;
  }

  /** One frame; true once nothing moves and nothing waits. */
  function step(dt: number): boolean {
    clock += dt * 1000;
    let still = true;
    for (const satellite of satellites) {
      if (satellite.queued && clock >= satellite.queued.at) launch(satellite, satellite.queued.out);
      if (satellite.queued) still = false;
      advance(satellite.radius, satellite.out ? LAUNCH_RADIUS : RETRACT, dt);
      advance(satellite.angle, satellite.out ? LAUNCH_ANGLE : RETRACT, dt);
      // A retract is critically damped, but a fast turn-around may still dip past the centre.
      if (satellite.radius.value < 0) {
        satellite.radius.value = 0;
        satellite.radius.velocity = Math.max(0, satellite.radius.velocity);
      }
      advance(satellite.scale, PRESS, dt);
      advance(satellite.pullX, PULL, dt);
      advance(satellite.pullY, PULL, dt);
      if (moving(satellite)) still = false;
    }
    advance(label.x, LABEL, dt);
    advance(label.y, LABEL, dt);
    if (!atRest(label.x) || !atRest(label.y)) still = false;
    render();
    return still;
  }

  function settleAll(): void {
    for (const satellite of satellites) {
      if (satellite.queued) launch(satellite, satellite.queued.out);
      settle(satellite.radius);
      settle(satellite.angle);
      settle(satellite.scale);
      settle(satellite.pullX);
      settle(satellite.pullY);
    }
    settle(label.x);
    settle(label.y);
    render();
  }

  const loop = startMachine<LoopState, LoopEvent>(
    {
      id: 'panel-shell-orbit',
      transition: transitionLoop,
      effects: {
        moving: (stay) => {
          let last: number | null = null;
          stay.scope.frame(
            (time) => {
              const dt =
                last === null ? FIRST_FRAME : Math.min(LONGEST_FRAME, (time - last) / 1000);
              last = time;
              if (step(Math.max(0, dt))) stay.send({ type: 'settled' });
            },
            { repeat: true },
          );
        },
      },
    },
    RESTING,
  );

  function kick(): void {
    if (life.signal.aborted) return;
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      settleAll();
      return;
    }
    loop.send({ type: 'kick' });
  }

  function showLabel(satellite: Satellite): void {
    window.clearTimeout(label.timer);
    const shown = label.slot !== null;
    label.slot = satellite.slot;
    parts.label.replaceChildren(...parts.labelFor(satellite.slot));
    const target = labelTarget(satellite);
    label.x.target = target.x;
    label.y.target = target.y;
    if (!shown) {
      settle(label.x);
      settle(label.y);
    }
    parts.label.classList.add(LABEL_OPEN_CLASS);
    render();
    kick();
  }

  function hideLabel(slot: SatelliteSlot | null): void {
    if (slot && label.slot !== slot) return;
    window.clearTimeout(label.timer);
    const drop = (): void => {
      label.slot = null;
      parts.label.classList.remove(LABEL_OPEN_CLASS);
    };
    if (slot === null) drop();
    else label.timer = window.setTimeout(drop, LABEL_LINGER_MS);
  }

  const options = { signal: life.signal };
  for (const satellite of satellites) {
    const { element } = satellite;
    const feel = (): void => {
      retarget(satellite);
      kick();
    };
    element.addEventListener(
      'pointerenter',
      () => {
        satellite.hovered = true;
        showLabel(satellite);
        feel();
      },
      options,
    );
    element.addEventListener(
      'pointerleave',
      () => {
        satellite.hovered = satellite.pressed = false;
        satellite.pullX.target = satellite.pullY.target = 0;
        if (!satellite.focused) hideLabel(satellite.slot);
        feel();
      },
      options,
    );
    element.addEventListener(
      'pointermove',
      (event) => {
        if (!open || !satellite.out) return;
        const box = parts.layer.getBoundingClientRect();
        const at = orbitPoint(fx, fy, ORBIT.radius, home(satellite));
        let dx = (event.clientX - (box.left + box.width / 2 + at.x)) * ORBIT.pullFactor;
        let dy = (event.clientY - (box.top + box.height / 2 + at.y)) * ORBIT.pullFactor;
        const length = Math.hypot(dx, dy);
        if (length > ORBIT.pullMax) {
          dx *= ORBIT.pullMax / length;
          dy *= ORBIT.pullMax / length;
        }
        satellite.pullX.target = dx;
        satellite.pullY.target = dy;
        kick();
      },
      options,
    );
    element.addEventListener(
      'pointerdown',
      () => {
        satellite.pressed = true;
        feel();
      },
      options,
    );
    for (const type of ['pointerup', 'pointercancel'] as const) {
      element.addEventListener(
        type,
        () => {
          satellite.pressed = false;
          feel();
        },
        options,
      );
    }
    element.addEventListener(
      'focus',
      () => {
        if (!keyboardFocused(element)) return;
        satellite.focused = true;
        showLabel(satellite);
        feel();
      },
      options,
    );
    element.addEventListener(
      'blur',
      () => {
        satellite.focused = false;
        if (!satellite.hovered) hideLabel(satellite.slot);
        feel();
      },
      options,
    );
  }

  function layoutTrack(): void {
    const angles = single ? [ORBIT.single] : ORBIT.angles;
    const from = Math.min(...angles) - ORBIT.trackOverhang;
    const to = Math.max(...angles) + ORBIT.trackOverhang;
    parts.track.setAttribute('d', trackPath(fx, fy, from, to));
    const start = orbitPoint(fx, fy, ORBIT.radius, from);
    const end = orbitPoint(fx, fy, ORBIT.radius, to);
    parts.trackFade.setAttribute('x1', start.x.toFixed(2));
    parts.trackFade.setAttribute('y1', start.y.toFixed(2));
    parts.trackFade.setAttribute('x2', end.x.toFixed(2));
    parts.trackFade.setAttribute('y2', end.y.toFixed(2));
  }

  layoutTrack();
  render();

  return {
    setOpen(next, { immediate = false } = {}) {
      if (life.signal.aborted) return;
      open = next;
      const list = active();
      list.forEach((satellite, index) => {
        if (next) {
          // Only a satellite resting in the ball waits its turn; one on its way back turns at once.
          const waits = satellite.radius.value < 1 && atRest(satellite.radius);
          satellite.queued = { out: true, at: clock + (waits ? index * ORBIT.launchStagger : 0) };
        } else {
          const pause = immediate ? 0 : ORBIT.retractDelay;
          satellite.queued = {
            out: false,
            at: clock + pause + (list.length - 1 - index) * ORBIT.retractStagger,
          };
        }
      });
      // A pointer crossing between satellites closes and reopens within one event turn,
      // so an ordinary close lets the label linger; only the "Hide" click drops it at once.
      if (!next) hideLabel(immediate ? null : label.slot);
      kick();
    },
    setFan(nextX, nextY) {
      if (nextX === fx && nextY === fy) return;
      fx = nextX;
      fy = nextY;
      layoutTrack();
      const current = satellites.find((s) => s.slot === label.slot);
      if (current) {
        const target = labelTarget(current);
        label.x.target = target.x;
        label.y.target = target.y;
      }
      render();
      kick();
    },
    setSingle(next) {
      if (next === single) return;
      single = next;
      layoutTrack();
      for (const satellite of satellites) {
        const shown = active().includes(satellite);
        if (!shown) {
          launch(satellite, false);
          settle(satellite.radius);
          settle(satellite.angle);
        } else if (satellite.out) {
          satellite.angle.target = home(satellite);
        }
      }
      render();
      kick();
    },
    rest() {
      open = false;
      for (const satellite of satellites) launch(satellite, false);
      hideLabel(null);
      settleAll();
    },
    relabel() {
      const current = satellites.find((s) => s.slot === label.slot);
      if (current) showLabel(current);
    },
    destroy() {
      if (life.signal.aborted) return;
      life.abort();
      window.clearTimeout(label.timer);
      void loop.stop();
    },
  };
}
