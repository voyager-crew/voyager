import type { StateEffects } from '@/features/plugins/runtime/stateMachine';

export const RECEIVER_STABLE_POLLS = 3;

export type ReceiverState =
  | { readonly status: 'peeking' }
  | {
      readonly status: 'waitingComposer';
      readonly previous: HTMLElement | null;
      readonly stable: number;
    }
  | { readonly status: 'claiming'; readonly composer: HTMLElement }
  | { readonly status: 'ended'; readonly result: 'silent' | 'failed' | 'ready' };
export type ReceiverEvent =
  | { readonly type: 'peek'; readonly pending: boolean }
  | { readonly type: 'composer'; readonly composer: HTMLElement | null }
  | { readonly type: 'finish'; readonly result: 'silent' | 'failed' | 'ready' };

export function receiverTransition(state: ReceiverState, event: ReceiverEvent): ReceiverState {
  if (state.status === 'ended') return state;
  if (event.type === 'finish') return { status: 'ended', result: event.result };
  if (state.status === 'peeking' && event.type === 'peek')
    return event.pending
      ? { status: 'waitingComposer', previous: null, stable: 0 }
      : { status: 'ended', result: 'silent' };
  if (state.status === 'waitingComposer' && event.type === 'composer') {
    const stable =
      event.composer && event.composer === state.previous
        ? state.stable + 1
        : event.composer
          ? 1
          : 0;
    return event.composer && stable >= RECEIVER_STABLE_POLLS
      ? { status: 'claiming', composer: event.composer }
      : { status: 'waitingComposer', previous: event.composer, stable };
  }
  return state;
}

export interface ReceiverPorts {
  readonly pollMs: number;
  readonly timeoutMs: number;
  peek(): Promise<boolean>;
  find(): HTMLElement | null;
  empty(input: HTMLElement): boolean;
  claim(): Promise<string | null>;
  current(): boolean;
  insert(markdown: string, composer: HTMLElement): boolean;
  finish(result: 'silent' | 'failed' | 'ready'): void;
}

export function receiverEffects(ports: ReceiverPorts): StateEffects<ReceiverState, ReceiverEvent> {
  return {
    peeking: (stay) => {
      void ports
        .peek()
        .then((pending) => stay.send({ type: 'peek', pending }))
        .catch(() => stay.send({ type: 'finish', result: 'silent' }));
    },
    waitingComposer: (stay) => {
      const poll = () => {
        if (!ports.current()) return stay.send({ type: 'finish', result: 'silent' });
        stay.send({ type: 'composer', composer: ports.find() });
      };
      stay.scope.effect(() => {
        const interval = window.setInterval(poll, ports.pollMs);
        const timeout = window.setTimeout(
          () => stay.send({ type: 'finish', result: 'failed' }),
          ports.timeoutMs,
        );
        const clear = () => {
          window.clearInterval(interval);
          window.clearTimeout(timeout);
        };
        stay.signal.addEventListener('abort', clear, { once: true });
        return () => {
          clear();
          stay.signal.removeEventListener('abort', clear);
        };
      });
      poll();
    },
    claiming: (stay) => {
      const original = stay.state().composer;
      if (!ports.current()) return stay.send({ type: 'finish', result: 'silent' });
      if (!ports.empty(original)) return stay.send({ type: 'finish', result: 'failed' });
      void ports
        .claim()
        .then((markdown) => {
          if (stay.signal.aborted) return;
          if (markdown === null) return stay.send({ type: 'finish', result: 'silent' });
          const composer = ports.find();
          // A claim round trip cannot insert into a different editor mounted in its place.
          const ready =
            ports.current() &&
            composer === original &&
            ports.empty(original) &&
            ports.insert(markdown, original);
          stay.send({ type: 'finish', result: ready ? 'ready' : 'failed' });
        })
        .catch(() => stay.send({ type: 'finish', result: 'silent' }));
    },
    ended: (stay) => ports.finish(stay.state().result),
  };
}
