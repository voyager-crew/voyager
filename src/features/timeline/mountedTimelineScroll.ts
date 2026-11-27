import { isUserEvent } from '@/core/utils/userEvent';
import { type Stay, startMachine } from '@/features/plugins/runtime/stateMachine';

import type { TimelineNavigationOptions } from './timelineNavigationTypes';

export type TimelineSpringProfile = 'ios' | 'snappy' | 'gentle';

export function getTimelineSpringProfile(): TimelineSpringProfile {
  try {
    const value = localStorage.getItem('geminiTimelineSpring');
    if (value === 'snappy' || value === 'gentle') return value;
  } catch {}
  return 'ios';
}

export function timelineFlowDuration(
  from: number,
  to: number,
  geometry: Pick<TimelineNavigationOptions, 'getMarkerPositions' | 'getTrackHeight'>,
): number {
  let base = 650;
  try {
    const stored = parseInt(localStorage.getItem('geminiTimelineFlowDurationMs') || '650', 10);
    base = Math.max(300, Math.min(1800, Number.isFinite(stored) ? stored : 650));
  } catch {}
  if (from < 0 || to < 0) return base;
  const positions = geometry.getMarkerPositions();
  const span = Math.abs(positions[to] - positions[from]);
  const height = Math.max(1, geometry.getTrackHeight() || 1);
  return Math.round(base * Math.max(0.6, Math.min(1.6, span / height)));
}

type State =
  | { readonly status: 'moving' }
  | { readonly status: 'settling'; readonly offset: number }
  | { readonly status: 'done' };
type LandingEvent = { readonly type: 'land'; readonly offset: number } | { readonly type: 'done' };

/** Keep a mounted landing aligned while Gemini reflows the destination. */
export function watchMountedLanding(
  viewport: HTMLElement,
  readTarget: () => HTMLElement | undefined,
  interrupt: () => void,
) {
  const readOffset = () => {
    const target = readTarget();
    return target && viewport.contains(target)
      ? target.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop
      : null;
  };
  const watchInput = (stay: Stay<State, LandingEvent>) => {
    const onInput = (event: Event) => {
      if (isUserEvent(event)) interrupt();
    };
    const options = { passive: true, capture: true };
    stay.scope.on(viewport, 'wheel', onInput, options);
    stay.scope.on(viewport, 'touchmove', onInput, options);
  };
  const machine = startMachine<State, LandingEvent>(
    {
      id: 'timeline-mounted-landing',
      transition: (state, event) =>
        event.type === 'done'
          ? { status: 'done' }
          : state.status === 'moving'
            ? { status: 'settling', offset: event.offset }
            : state,
      effects: {
        moving: watchInput,
        settling(stay) {
          watchInput(stay);
          let offset = stay.state().offset;
          let changedAt = Date.now();
          const deadline = changedAt + 2_000;
          stay.scope.timer(
            () => {
              if (stay.signal.aborted) return;
              const next = readOffset();
              const now = Date.now();
              // Scrolling changes the viewport-relative rect, but preserves the absolute offset.
              if (next === null) changedAt = now;
              else if (Math.abs(next - offset) > 1) {
                offset = next;
                viewport.scrollTop = next;
                changedAt = now;
              }
              if (now >= deadline || now - changedAt >= 480) stay.send({ type: 'done' });
            },
            80,
            { repeat: true },
          );
        },
      },
    },
    { status: 'moving' },
  );
  return {
    land(fallback: number) {
      const offset = readOffset() ?? fallback;
      viewport.scrollTop = offset;
      machine.send({ type: 'land', offset });
    },
    stop: () => machine.stop(),
  };
}
