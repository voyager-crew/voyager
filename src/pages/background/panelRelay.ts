import type { PanelTabRequest, PanelTabRequestReply } from '@/features/panel/protocol';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import type { PanelFrameRecord } from './panelStorage';

type RelayState =
  | { status: 'checking' }
  | { status: 'sending'; frame: PanelFrameRecord }
  | { status: 'settled'; reply: PanelTabRequestReply };
type RelayEvent =
  | { type: 'ready'; frame: PanelFrameRecord }
  | { type: 'reply'; reply: PanelTabRequestReply }
  | { type: 'revoke' };

function transition(state: RelayState, event: RelayEvent): RelayState {
  if (state.status === 'settled') return state;
  switch (event.type) {
    case 'revoke':
      return { status: 'settled', reply: { ok: false, error: 'session_revoked' } };
    case 'reply':
      return { status: 'settled', reply: event.reply };
    case 'ready':
      return state.status === 'checking' ? { status: 'sending', frame: event.frame } : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Navigation can retire either the authentication wait or the already sent request. */
export function startPanelRelay(options: {
  request: PanelTabRequest;
  authorize(): Promise<PanelFrameRecord | null>;
  isCurrent(frame: PanelFrameRecord): Promise<boolean>;
}): { result: Promise<PanelTabRequestReply>; revoke(): void } {
  let resolveReply!: (reply: PanelTabRequestReply) => void;
  const result = new Promise<PanelTabRequestReply>((resolve) => {
    resolveReply = resolve;
  });
  const machine = startMachine<RelayState, RelayEvent>(
    {
      id: 'panel-tab-relay',
      transition,
      effects: {
        checking(stay) {
          void (async () => {
            const frame = await options.authorize();
            if (stay.signal.aborted) return;
            if (!frame || !(await options.isCurrent(frame))) {
              stay.send({ type: 'reply', reply: { ok: false, error: 'sender_not_allowed' } });
              return;
            }
            // The ready transition enters sending synchronously; no async work after this check.
            stay.send({ type: 'ready', frame });
          })().catch(() =>
            stay.send({ type: 'reply', reply: { ok: false, error: 'relay_unavailable' } }),
          );
        },
        sending(stay) {
          const { frame } = stay.state();
          // documentId makes browser routing atomic with respect to document replacement.
          // Without it, navigation after browser handoff can retarget delivery, just as with
          // the popup's tab messages. P5-f accepts this window after the final check;
          // revocation discards late replies but cannot retract a request already handed off.
          void (async () => {
            const response: unknown = await chrome.tabs.sendMessage(frame.tabId, options.request, {
              frameId: 0,
              ...(frame.hostDocumentId ? { documentId: frame.hostDocumentId } : {}),
            });
            stay.send({ type: 'reply', reply: { ok: true, response } });
          })().catch(() =>
            stay.send({ type: 'reply', reply: { ok: false, error: 'relay_unavailable' } }),
          );
        },
        settled(stay) {
          resolveReply(stay.state().reply);
        },
      },
    },
    { status: 'checking' },
  );
  return { result, revoke: () => machine.send({ type: 'revoke' }) };
}
