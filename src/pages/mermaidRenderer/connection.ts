import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import { MERMAID_TOKEN_MESSAGE, parseMermaidTokenRedeemReply } from './authorization';
import {
  MERMAID_RENDERER_CONNECT,
  type MermaidRenderRequest,
  type MermaidRendererResponse,
  parseMermaidRequest,
} from './protocol';
import { renderMermaidDocument } from './render';

type ConnectionState =
  | { readonly status: 'listening' }
  | {
      readonly status: 'rendering';
      readonly port: MessagePort;
      readonly request: MermaidRenderRequest;
    }
  | {
      readonly status: 'responding';
      readonly port: MessagePort;
      readonly response: MermaidRendererResponse;
    }
  | { readonly status: 'stopped' };
type ConnectionEvent =
  | {
      readonly type: 'authorized';
      readonly port: MessagePort;
      readonly request: MermaidRenderRequest;
    }
  | { readonly type: 'complete'; readonly response: MermaidRendererResponse }
  | { readonly type: 'fail' }
  | { readonly type: 'stop' };

function transition(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  if (state.status === 'stopped') return state;
  switch (event.type) {
    case 'authorized':
      return state.status === 'listening'
        ? { status: 'rendering', port: event.port, request: event.request }
        : state;
    case 'complete':
      return state.status === 'rendering'
        ? { status: 'responding', port: state.port, response: event.response }
        : state;
    case 'fail':
      return state.status === 'rendering'
        ? { status: 'responding', port: state.port, response: { type: 'unavailable' } }
        : state;
    case 'stop':
      return { status: 'stopped' };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** One authenticated request per document; the host cannot supply its own authority. */
export function startMermaidRendererConnection(target: Window = window): () => void {
  const resources = new PluginScope();
  const machine = startMachine<ConnectionState, ConnectionEvent>(
    {
      id: 'mermaid-connection',
      transition,
      effects: {
        listening(stay) {
          stay.scope.on(target, 'message', (event) => {
            if (!(event instanceof MessageEvent)) return;
            const data: unknown = event.data;
            // Firefox can redact privileged senders to null. Authority comes
            // from redemption, never the host-controlled URL or event payload.
            if (
              (event.source !== target.parent && event.source !== null) ||
              event.ports.length !== 1 ||
              typeof data !== 'object' ||
              data === null ||
              !('type' in data) ||
              data.type !== MERMAID_RENDERER_CONNECT ||
              !('token' in data) ||
              typeof data.token !== 'string' ||
              !('request' in data)
            )
              return;
            const port = event.ports[0];
            const release = resources.effect(() => () => port.close());
            const refuse = () => {
              try {
                port.postMessage({ type: 'unavailable' } satisfies MermaidRendererResponse);
              } catch {
                /* The unauthenticated peer may already have gone away. */
              } finally {
                void release();
              }
            };
            // Keep listening while redemptions are pending: a forged bootstrap
            // must not consume the legitimate content script's one connection.
            void (async () => {
              try {
                const raw: unknown = await chrome.runtime.sendMessage({
                  type: MERMAID_TOKEN_MESSAGE.redeem,
                  token: data.token,
                });
                if (stay.signal.aborted) {
                  void release();
                  return;
                }
                const reply = parseMermaidTokenRedeemReply(raw);
                // Do not even parse the diagram envelope until the background
                // has authenticated this frame and consumed its one-use token.
                const request = reply?.ok ? parseMermaidRequest(data.request) : null;
                if (!reply?.ok || !request || request.id !== reply.requestId) {
                  refuse();
                  return;
                }
                stay.send({ type: 'authorized', port, request });
              } catch {
                if (!stay.signal.aborted) refuse();
                else void release();
              }
            })();
          });
        },
        rendering(stay) {
          const { port, request } = stay.state();
          try {
            port.postMessage({ type: 'ready' } satisfies MermaidRendererResponse);
            void renderMermaidDocument(request).then(
              (result) => stay.send({ type: 'complete', response: { type: 'rendered', result } }),
              () => stay.send({ type: 'fail' }),
            );
          } catch {
            stay.send({ type: 'fail' });
          }
        },
        responding(stay) {
          try {
            stay.state().port.postMessage(stay.state().response);
          } finally {
            void resources.dispose();
          }
        },
        stopped() {
          void resources.dispose();
        },
      },
    },
    { status: 'listening' },
  );
  resources.on(target, 'pagehide', () => machine.send({ type: 'stop' }), { once: true });
  return () => {
    void machine.stop();
    void resources.dispose();
  };
}
