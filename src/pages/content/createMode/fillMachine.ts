/**
 * Filling a new chat's composer with the creation message, as phases (see
 * `features/plugins/runtime/stateMachine.ts`):
 *
 * opening (the new chat is on its way) → waiting (the composer settles) →
 * writing → ended. The page may navigate at any point; every phase checks the
 * route again against the account and new-chat path fixed at the start, so a
 * move anywhere else ends the fill: nothing is written and the page is not
 * moved again. The message only ever goes into an empty composer, and nothing
 * is sent.
 */
import type { StateEffects } from '@/features/plugins/runtime/stateMachine';

/** The same element on this many polls in a row: the app has finished mounting it. */
export const FILL_STABLE_POLLS = 3;

export type FillResult =
  | 'filled'
  /** The composer on the new chat already holds something. */
  | 'busy'
  | 'no-new-chat'
  | 'no-composer'
  /** The tab went anywhere but the new chat, or the feature stopped: say nothing. */
  | 'left';

/** Where the tab is: the new chat it was sent to, the page it started on, or anywhere else. */
export type FillPlace = 'new-chat' | 'start' | 'elsewhere';

export type FillState =
  | { readonly status: 'opening' }
  | { readonly status: 'waiting'; readonly previous: HTMLElement | null; readonly stable: number }
  | { readonly status: 'writing'; readonly composer: HTMLElement }
  | { readonly status: 'ended'; readonly result: FillResult };

export type FillEvent =
  | { readonly type: 'arrived' }
  | { readonly type: 'composer'; readonly composer: HTMLElement | null }
  | { readonly type: 'finish'; readonly result: FillResult };

export function fillTransition(state: FillState, event: FillEvent): FillState {
  if (state.status === 'ended') return state;
  if (event.type === 'finish') return { status: 'ended', result: event.result };
  if (state.status === 'opening' && event.type === 'arrived')
    return { status: 'waiting', previous: null, stable: 0 };
  if (state.status === 'waiting' && event.type === 'composer') {
    const { composer } = event;
    if (!composer) return { status: 'waiting', previous: null, stable: 0 };
    const stable = composer === state.previous ? state.stable + 1 : 1;
    return stable >= FILL_STABLE_POLLS
      ? { status: 'writing', composer }
      : { status: 'waiting', previous: composer, stable };
  }
  return state;
}

export interface FillPorts {
  readonly pollMs: number;
  /** How long the site's own control may take before the History API stands in. */
  readonly confirmMs: number;
  readonly timeoutMs: number;
  where(): FillPlace;
  /** Press the site's new-chat control; false when there is none. */
  openWithControl(): boolean;
  /** Same-document navigation, where the site allows it; false otherwise. */
  openWithHistory(): boolean;
  find(): HTMLElement | null;
  empty(composer: HTMLElement): boolean;
  insert(composer: HTMLElement): boolean;
  finish(result: FillResult): void;
}

export function fillEffects(ports: FillPorts): StateEffects<FillState, FillEvent> {
  return {
    opening: (stay) => {
      /** True when the tab is no longer on the page the fill started on. */
      const moved = (): boolean => {
        const place = ports.where();
        if (place === 'new-chat') stay.send({ type: 'arrived' });
        else if (place === 'elsewhere') stay.send({ type: 'finish', result: 'left' });
        return place !== 'start';
      };
      const fallback = () => {
        if (!moved() && !ports.openWithHistory())
          stay.send({ type: 'finish', result: 'no-new-chat' });
      };
      stay.scope.timer(moved, ports.pollMs, { repeat: true });
      stay.scope.timer(() => stay.send({ type: 'finish', result: 'no-new-chat' }), ports.timeoutMs);
      if (ports.openWithControl()) stay.scope.timer(fallback, ports.confirmMs);
      else fallback();
    },
    waiting: (stay) => {
      const poll = () => {
        if (ports.where() !== 'new-chat') stay.send({ type: 'finish', result: 'left' });
        else stay.send({ type: 'composer', composer: ports.find() });
      };
      stay.scope.timer(poll, ports.pollMs, { repeat: true });
      stay.scope.timer(() => stay.send({ type: 'finish', result: 'no-composer' }), ports.timeoutMs);
      poll();
    },
    writing: (stay) => {
      const { composer } = stay.state();
      if (ports.where() !== 'new-chat') return stay.send({ type: 'finish', result: 'left' });
      if (!composer.isConnected || ports.find() !== composer)
        return stay.send({ type: 'finish', result: 'no-composer' });
      if (!ports.empty(composer)) return stay.send({ type: 'finish', result: 'busy' });
      stay.send({ type: 'finish', result: ports.insert(composer) ? 'filled' : 'no-composer' });
    },
    ended: (stay) => ports.finish(stay.state().result),
  };
}
