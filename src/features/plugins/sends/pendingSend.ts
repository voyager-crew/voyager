import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';

import { startMachine } from '../runtime/stateMachine';

export interface PendingSendData {
  readonly sentAt: number;
  readonly conversationKey: string;
  readonly known: ReadonlySet<string>;
  readonly prompt: string;
}
interface TurnSnapshot {
  readonly key: string;
  readonly prompt: string;
}
type SendState =
  | { readonly status: 'pending'; readonly data: PendingSendData }
  | {
      readonly status: 'ended';
      readonly sent: {
        readonly turnKey: string;
        readonly conversationKey: string;
        readonly at: number;
      } | null;
    };
type SendEvent =
  | { readonly type: 'retire' }
  | {
      readonly type: 'observed';
      readonly conversationKey: string | null;
      readonly newest: TurnSnapshot | null;
    };

function transition(state: SendState, event: SendEvent): SendState {
  if (state.status === 'ended') return state;
  if (event.type === 'retire' || event.conversationKey !== state.data.conversationKey)
    return { status: 'ended', sent: null };
  const { newest } = event;
  if (
    !newest ||
    state.data.known.has(newest.key) ||
    (state.data.prompt !== '' && newest.prompt !== state.data.prompt)
  )
    return state;
  return {
    status: 'ended',
    sent: {
      turnKey: newest.key,
      conversationKey: state.data.conversationKey,
      at: state.data.sentAt,
    },
  };
}

/** Each submission owns exactly its observation window; retirement cannot report a later chat. */
export function startPendingSend(
  data: PendingSendData,
  ports: {
    readonly doc: Document;
    readonly signal: AbortSignal;
    newest(): TurnSnapshot | null;
    conversation(): string | null;
    report(sent: {
      readonly turnKey: string;
      readonly conversationKey: string;
      readonly at: number;
    }): void;
  },
): () => void {
  const machine = startMachine<SendState, SendEvent>(
    {
      id: 'catalogUserSend',
      transition,
      effects: {
        pending: (stay) => {
          const scan = () => {
            const newest = ports.newest();
            if (
              !newest ||
              data.known.has(newest.key) ||
              (data.prompt !== '' && newest.prompt !== data.prompt)
            )
              return;
            stay.send({ type: 'observed', conversationKey: ports.conversation(), newest });
          };
          const route = () => {
            if (ports.conversation() !== data.conversationKey) stay.send({ type: 'retire' });
            else scan();
          };
          stay.scope.on(ports.signal, 'abort', () => stay.send({ type: 'retire' }));
          stay.scope.observe(ports.doc.body, { childList: true, subtree: true }, scan);
          stay.scope.effect(() => watchRouteChanges(route), 'user-sends:route');
          stay.scope.timer(() => stay.send({ type: 'retire' }), 30_000);
        },
        ended: (stay) => {
          const { sent } = stay.state();
          if (sent && !ports.signal.aborted && ports.conversation() === sent.conversationKey)
            ports.report(sent);
        },
      },
    },
    ports.signal.aborted ? { status: 'ended', sent: null } : { status: 'pending', data },
  );
  return () => {
    machine.send({ type: 'retire' });
    void machine.stop();
  };
}
