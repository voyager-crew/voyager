/**
 * One estimated homing run (`homing.mode: "step"`, ChatGPT, #1116): jump to
 * the estimated place of an unmounted turn, wait for the host's DOM to answer
 * instead of a fixed hop, and align once the turn mounts.
 *
 * `seeking` estimates and jumps (`homingEstimate`); `waitingForOlder` sits at
 * the start of what is loaded while the host fetches an older page, without
 * scrolling again; `aligning` puts the mounted turn on the anchor instantly
 * (or glides to a near one) and re-aims after the host re-measures. A run ends
 * on arrival, when nothing changes for a while, or when cancelled; a new click,
 * a person's wheel or teardown stops the machine, which drops late callbacks.
 */
import { type Machine, type Stay, startMachine } from '@/features/plugins/runtime/stateMachine';

import { type HomingBracket, type MountedTurn, estimateHoming } from './homingEstimate';
import { afterScrollSettles } from './scrollMotion';

/** Defaults for the site.json `timeline.homing` tunables. */
export const DEFAULT_EDGE_PATIENCE_MS = 10_000;
export const DEFAULT_STALL_MS = 4_000;
/** Quiet after the last DOM change or scroll before the run reads the page. */
const QUIET_MS = 80;
/** Longest wait for an answer to a jump or an aim before reading anyway. */
const ANSWER_CAP_MS = 400;
/** Jumps without new contents before a run stops; ChatGPT needs two or three. */
const MAX_JUMPS = 12;
/** Jumps in one walk between pages, however much each mounts. */
const MAX_TOTAL_JUMPS = 30;
/** Aims at a mounted target, the first included. */
const MAX_AIMS = 3;
/** Share of the view an arrived target may sit from the anchor line. */
const ALIGN_TOLERANCE = 0.12;

export type HomingEnd = 'arrived' | 'stalled' | 'gone' | 'cancelled';

type HomingState =
  | { readonly status: 'seeking' }
  | { readonly status: 'waitingForOlder' }
  | { readonly status: 'aligning'; readonly glide: boolean }
  | { readonly status: 'ended'; readonly reason: HomingEnd };

type HomingEvent =
  | { readonly type: 'mounted' }
  | { readonly type: 'unmounted' }
  | { readonly type: 'atEdge' }
  | { readonly type: 'grew' }
  | { readonly type: 'end'; readonly reason: HomingEnd };

export function homingTransition(state: HomingState, event: HomingEvent): HomingState {
  if (state.status === 'ended') return state;
  if (event.type === 'end') return { status: 'ended', reason: event.reason };
  switch (state.status) {
    case 'seeking':
      if (event.type === 'mounted') return { status: 'aligning', glide: false };
      if (event.type === 'atEdge') return { status: 'waitingForOlder' };
      return state;
    case 'waitingForOlder':
      if (event.type === 'mounted') return { status: 'aligning', glide: false };
      if (event.type === 'grew') return { status: 'seeking' };
      return state;
    case 'aligning':
      return event.type === 'unmounted' ? { status: 'seeking' } : state;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export interface HomingGeometry {
  readonly offset: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
}

/** What a run reads and moves; `VirtualizedTimelineNavigation` supplies it. */
export interface HomingHost {
  readonly targetIndex: number;
  readonly anchor: number;
  readonly edgePatienceMs: number;
  readonly stallMs: number;
  /** The node whose subtree mounts turns, and the target scroll events come from. */
  readonly root: Node;
  readonly scrollTarget: EventTarget;
  /** The target's live element, or null while unmounted. */
  target(): HTMLElement | null;
  /** Whether the target is still in the marker list. */
  exists(): boolean;
  /** Mounted turns other than the target, ascending. */
  mounted(): MountedTurn[];
  geometry(): HomingGeometry;
  jumpTo(center: number): void;
  align(element: HTMLElement, behavior: ScrollBehavior): void;
  /** Signed distance from the anchor line to the element's centre. */
  offAnchor(element: HTMLElement): number;
  /** Hold the clicked marker active while the run moves the page. */
  holdActive(): void;
  onWaiting(waiting: boolean): void;
  onEnd(reason: HomingEnd): void;
}

/** What the host has mounted and how tall it is: what counts as progress. */
function contents(host: HomingHost): string {
  const turns = host.mounted().map((turn) => turn.index);
  return `${turns.join(',')}|${host.geometry().scrollHeight}|${host.target() ? 1 : 0}`;
}

/** A fingerprint of what a jump, an aim or a re-measure changes: contents, offset, the target's place. */
function signature(host: HomingHost): string {
  const target = host.target();
  const place = target ? Math.round(host.offAnchor(target)) : '';
  return `${contents(host)}|${Math.round(host.geometry().offset)}|${place}`;
}

/**
 * Call `read(changed)` once the page answers: after a change and then
 * `QUIET_MS` of quiet, or after `cap` with nothing changed. Owned by the stay.
 */
function awaitAnswer(
  stay: Stay<HomingState, HomingEvent>,
  host: HomingHost,
  cap: number,
  read: (changed: boolean) => void,
): void {
  const start = signature(host);
  let quiet: (() => void) | null = null;
  let stopCap: (() => void) | null = null;
  let stopWatch: (() => void) | null = null;
  let done = false;
  const finish = (changed: boolean) => {
    if (done || stay.signal.aborted) return;
    done = true;
    void quiet?.();
    void stopCap?.();
    void stopWatch?.();
    read(changed);
  };
  const changed = () => {
    if (done || stay.signal.aborted) return;
    void quiet?.();
    quiet = stay.scope.timer(() => {
      if (signature(host) !== start) finish(true);
    }, QUIET_MS);
  };
  const observer = new MutationObserver(changed);
  observer.observe(host.root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
  host.scrollTarget.addEventListener('scroll', changed, { passive: true });
  stopWatch = stay.scope.effect(
    () => () => {
      observer.disconnect();
      host.scrollTarget.removeEventListener('scroll', changed);
    },
    'homingAnswer',
  );
  stopCap = stay.scope.timer(() => finish(signature(host) !== start), cap);
}

function seek(stay: Stay<HomingState, HomingEvent>, host: HomingHost): void {
  let lastContents = '';
  let progressAt = Date.now();
  let jumps = 0;
  let totalJumps = 0;
  const bracket: HomingBracket = {};
  const step = (): void => {
    if (stay.signal.aborted) return;
    if (!host.exists()) return stay.send({ type: 'end', reason: 'gone' });
    if (host.target()) return stay.send({ type: 'mounted' });
    const current = contents(host);
    if (current !== lastContents) {
      lastContents = current;
      progressAt = Date.now();
      jumps = 0;
    } else if (Date.now() - progressAt > host.stallMs || jumps >= MAX_JUMPS) {
      return stay.send({ type: 'end', reason: 'stalled' });
    }
    if (totalJumps >= MAX_TOTAL_JUMPS) return stay.send({ type: 'end', reason: 'stalled' });
    // Read after the page answered the last jump, so the window is current. A
    // long reply can fill the view with no prompt bubble in it (#1116).
    const turns = host.mounted();
    const plan = estimateHoming({
      targetIndex: host.targetIndex,
      mounted: turns,
      bracket,
      anchor: host.anchor,
      ...host.geometry(),
    });
    if (plan.kind === 'edge') return stay.send({ type: 'atEdge' });
    if (plan.kind === 'jump') {
      jumps += 1;
      totalJumps += 1;
      host.holdActive();
      host.jumpTo(plan.center);
    }
    awaitAnswer(stay, host, ANSWER_CAP_MS, step);
  };
  step();
}

/** At the start of what is loaded: no scrolling, only waiting for the next page. */
function waitForOlder(stay: Stay<HomingState, HomingEvent>, host: HomingHost): void {
  host.onWaiting(true);
  stay.scope.effect(() => () => host.onWaiting(false), 'homingWaiting');
  host.holdActive();
  // A reply streaming at the bottom grows the page too; only new turns or a
  // move off the start (a prepend that kept the view's place) count.
  const atStart = host.geometry().offset <= 1;
  const startTurns = host
    .mounted()
    .map((turn) => turn.index)
    .join(',');
  stay.scope.timer(() => stay.send({ type: 'end', reason: 'stalled' }), host.edgePatienceMs);
  const check = (): void => {
    if (stay.signal.aborted) return;
    if (!host.exists()) return stay.send({ type: 'end', reason: 'gone' });
    if (host.target()) return stay.send({ type: 'mounted' });
    host.holdActive();
    const turns = host
      .mounted()
      .map((turn) => turn.index)
      .join(',');
    if (turns !== startTurns || (atStart && host.geometry().offset > 1))
      return stay.send({ type: 'grew' });
    awaitAnswer(stay, host, ANSWER_CAP_MS, check);
  };
  awaitAnswer(stay, host, ANSWER_CAP_MS, check);
}

type Aligning = Extract<HomingState, { readonly status: 'aligning' }>;

function align(stay: Stay<Aligning, HomingEvent>, host: HomingHost): void {
  let aims = 0;
  // A page that keeps changing (a reply still streaming) never reads as settled.
  stay.scope.timer(() => stay.send({ type: 'end', reason: 'arrived' }), host.stallMs);
  const aim = (): void => {
    const element = host.target();
    if (!element) return stay.send({ type: 'unmounted' });
    aims += 1;
    host.holdActive();
    const glide = aims === 1 && stay.state().glide;
    host.align(element, glide ? 'smooth' : 'instant');
    if (!glide) return awaitAnswer(stay, host, ANSWER_CAP_MS, check);
    // Read a glide only once it stops: mid-flight the target is off the anchor
    // and a re-aim would yank the scroll (scrollMotion.ts).
    afterScrollSettles(
      () => host.geometry().offset,
      (run, ms) => void stay.scope.timer(run, ms),
      () => stay.signal.aborted,
      () => awaitAnswer(stay, host, ANSWER_CAP_MS, check),
    );
  };
  // Arrived once a read finds the target on the anchor and nothing moved it since the aim.
  const check = (changed: boolean): void => {
    if (stay.signal.aborted) return;
    const element = host.target();
    if (!element) return stay.send({ type: 'unmounted' });
    const off = Math.abs(host.offAnchor(element));
    const near = off <= host.geometry().viewportHeight * ALIGN_TOLERANCE;
    if (!changed && near) return stay.send({ type: 'end', reason: 'arrived' });
    if (near) return awaitAnswer(stay, host, ANSWER_CAP_MS, check);
    // A scroll edge can hold the target short of the anchor: an aim that moved nothing is final.
    if (aims >= MAX_AIMS || (!changed && aims > 1))
      return stay.send({ type: 'end', reason: 'arrived' });
    aim();
  };
  aim();
}

export type HomingRun = Machine<HomingState, HomingEvent>;

/** Start a run; `glide` aims a mounted, near target with a smooth scroll first. */
export function startHomingRun(host: HomingHost, glide: boolean): HomingRun {
  const run = startMachine<HomingState, HomingEvent>(
    {
      id: 'timelineHoming',
      transition: homingTransition,
      effects: {
        seeking: (stay) => seek(stay, host),
        waitingForOlder: (stay) => waitForOlder(stay, host),
        aligning: (stay) => align(stay, host),
        ended: (stay) => host.onEnd(stay.state().reason),
      },
    },
    glide || host.target() ? { status: 'aligning', glide } : { status: 'seeking' },
  );
  return run;
}
