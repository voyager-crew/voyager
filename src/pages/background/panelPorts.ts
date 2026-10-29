import {
  PANEL_PORT_MESSAGE,
  type PanelPortContextMessage,
  type PanelSessionId,
  parsePanelPortConnectMessage,
} from '@/features/panel/protocol';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import type { PanelFrameRecord } from './panelStorage';

type PortState =
  | { status: 'waiting' }
  | { status: 'authenticating'; sessionId: PanelSessionId }
  | { status: 'connected'; frame: PanelFrameRecord }
  | { status: 'closed' };
type PortEvent =
  | { type: 'connect'; sessionId: PanelSessionId }
  | { type: 'authenticated'; frame: PanelFrameRecord }
  | { type: 'close' };

function transition(state: PortState, event: PortEvent): PortState {
  switch (event.type) {
    case 'close':
      return { status: 'closed' };
    case 'connect':
      return state.status === 'waiting'
        ? { status: 'authenticating', sessionId: event.sessionId }
        : { status: 'closed' };
    case 'authenticated':
      return state.status === 'authenticating'
        ? { status: 'connected', frame: event.frame }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function panelContextMessage(frame: PanelFrameRecord): PanelPortContextMessage {
  return {
    type: PANEL_PORT_MESSAGE.context,
    payload: { sessionId: frame.sessionId, context: frame.context },
  };
}

/** Authentication can finish after a Port disconnects; state-owned effects discard that result. */
export function startPanelPort(
  port: chrome.runtime.Port,
  owner: {
    authenticate(sessionId: PanelSessionId): Promise<PanelFrameRecord | null>;
    connected(frame: PanelFrameRecord, close: () => void): () => void;
  },
): () => void {
  const machine = startMachine<PortState, PortEvent>(
    {
      id: 'panel-port',
      transition,
      effects: {
        waiting(stay) {
          stay.scope.onChromeEvent(port.onDisconnect, () => stay.send({ type: 'close' }));
          stay.scope.onChromeEvent(port.onMessage, (value: unknown) => {
            const message = parsePanelPortConnectMessage(value);
            stay.send(
              message
                ? { type: 'connect', sessionId: message.payload.sessionId }
                : { type: 'close' },
            );
          });
          stay.scope.timer(() => stay.send({ type: 'close' }), 5_000);
        },
        authenticating(stay) {
          stay.scope.onChromeEvent(port.onDisconnect, () => stay.send({ type: 'close' }));
          void owner.authenticate(stay.state().sessionId).then(
            (frame) => stay.send(frame ? { type: 'authenticated', frame } : { type: 'close' }),
            () => stay.send({ type: 'close' }),
          );
        },
        connected(stay) {
          stay.scope.onChromeEvent(port.onDisconnect, () => stay.send({ type: 'close' }));
          stay.scope.effect(() =>
            owner.connected(stay.state().frame, () => stay.send({ type: 'close' })),
          );
          port.postMessage(panelContextMessage(stay.state().frame));
        },
        closed() {
          port.disconnect();
        },
      },
    },
    { status: 'waiting' },
  );
  return () => machine.send({ type: 'close' });
}
