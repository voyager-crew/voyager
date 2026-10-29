import { isUserEvent } from '@/core/utils/userEvent';
import {
  PANEL_BOOTSTRAP_ACK_KIND,
  PANEL_MESSAGE,
  type PanelBootstrapAckMessage,
  type PanelRuntimeMessage,
  type PanelSession,
  type PanelToken,
  panelHostOrigin,
  parsePanelBootstrapMessage,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

type BootstrapState =
  | { status: 'waiting' }
  | { status: 'redeeming'; token: PanelToken; hostOrigin: string }
  | { status: 'active'; session: PanelSession }
  | { status: 'blank' };
type BootstrapEvent =
  | { type: 'bootstrap'; token: PanelToken; hostOrigin: string }
  | { type: 'accepted'; session: PanelSession }
  | { type: 'refused' };

function transition(state: BootstrapState, event: BootstrapEvent): BootstrapState {
  switch (event.type) {
    case 'bootstrap':
      return state.status === 'waiting'
        ? { status: 'redeeming', token: event.token, hostOrigin: event.hostOrigin }
        : state;
    case 'accepted':
      return state.status === 'redeeming' ? { status: 'active', session: event.session } : state;
    case 'refused':
      return state.status === 'redeeming' ? { status: 'blank' } : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** A URL carries no authority. Only the shell's direct, browser-delivered handoff can redeem. */
export function startPanelBootstrap(
  activate: (session: PanelSession, signal: AbortSignal) => Promise<void>,
): () => void {
  const machine = startMachine<BootstrapState, BootstrapEvent>(
    {
      id: 'panel-bootstrap',
      transition,
      effects: {
        waiting(stay) {
          stay.scope.on(window, 'message', (event: Event) => {
            if (
              !(event instanceof MessageEvent) ||
              !isUserEvent(event) ||
              window.parent === window ||
              event.source !== window.parent
            )
              return;
            const message = parsePanelBootstrapMessage(event.data);
            const hostOrigin = panelHostOrigin(event.origin);
            if (message && hostOrigin)
              stay.send({ type: 'bootstrap', token: message.token, hostOrigin });
          });
        },
        redeeming(stay) {
          void (async () => {
            try {
              const { token, hostOrigin } = stay.state();
              const raw: unknown = await chrome.runtime.sendMessage({
                type: PANEL_MESSAGE.tokenRedeem,
                payload: { token },
              } satisfies PanelRuntimeMessage);
              const reply = parsePanelTokenRedeemReply(raw);
              if (reply?.ok && reply.session.hostOrigin === hostOrigin) {
                stay.send({ type: 'accepted', session: reply.session });
                return;
              }
            } catch {
              // A stale secret or unavailable background leaves the page blank.
            }
            stay.send({ type: 'refused' });
          })();
        },
        active(stay) {
          const { session } = stay.state();
          try {
            window.parent.postMessage(
              { kind: PANEL_BOOTSTRAP_ACK_KIND } satisfies PanelBootstrapAckMessage,
              session.hostOrigin,
            );
          } catch {
            // A parent being torn down may no longer accept the acknowledgment.
          }
          void activate(session, stay.signal).catch(() => {});
        },
      },
    },
    { status: 'waiting' },
  );

  const stop = (): void => {
    window.removeEventListener('pagehide', stop);
    void machine.stop();
  };
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}
