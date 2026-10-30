import { hasValidExtensionContext } from '@/core/utils/extensionContext';
import { isUserEvent } from '@/core/utils/userEvent';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import {
  MERMAID_TOKEN_MESSAGE,
  parseMermaidTokenIssueReply,
} from '@/pages/mermaidRenderer/authorization';
import {
  MERMAID_RENDERER_CONNECT,
  MERMAID_RENDERER_PATH,
  type MermaidDocumentOutcome,
  type MermaidRenderRequest,
  type MermaidRenderResult,
  parseMermaidResponse,
} from '@/pages/mermaidRenderer/protocol';

const READY_TIMEOUT_MS = 3_000;
const RENDER_TIMEOUT_MS = 30_000;

type RenderState =
  | { readonly status: 'issuing' }
  | {
      readonly status: 'connecting';
      readonly stage: 'loading' | 'authorizing';
      readonly token: string;
    }
  | { readonly status: 'rendering' }
  | { readonly status: 'settled'; readonly outcome: MermaidDocumentOutcome };
type RenderEvent =
  | { readonly type: 'issued'; readonly token: string }
  | { readonly type: 'loaded' }
  | { readonly type: 'ready' }
  | { readonly type: 'rendered'; readonly diagram: MermaidRenderResult }
  | { readonly type: 'not-ready' }
  | { readonly type: 'fail' };

function transition(state: RenderState, event: RenderEvent): RenderState {
  if (state.status === 'settled') return state;
  switch (event.type) {
    case 'issued':
      return state.status === 'issuing'
        ? { status: 'connecting', stage: 'loading', token: event.token }
        : state;
    case 'loaded':
      return state.status === 'connecting' && state.stage === 'loading'
        ? { ...state, stage: 'authorizing' }
        : { status: 'settled', outcome: { kind: 'failed' } };
    case 'ready':
      return state.status === 'connecting' && state.stage === 'authorizing'
        ? { status: 'rendering' }
        : state;
    case 'rendered':
      return state.status === 'rendering'
        ? { status: 'settled', outcome: { kind: 'rendered', diagram: event.diagram } }
        : state;
    case 'not-ready':
      return state.status === 'connecting'
        ? { status: 'settled', outcome: { kind: 'not-ready' } }
        : state;
    case 'fail':
      return { status: 'settled', outcome: { kind: 'failed' } };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** A private port returns sanitized SVG; authority never enters the page-readable DOM. */
export async function renderInIsolatedDocument(
  request: MermaidRenderRequest,
  signal: AbortSignal,
): Promise<MermaidDocumentOutcome> {
  const resources = new PluginScope();
  let finish!: (outcome: MermaidDocumentOutcome) => void;
  const finished = new Promise<MermaidDocumentOutcome>((resolve) => (finish = resolve));
  const machine = startMachine<RenderState, RenderEvent>(
    {
      id: 'mermaid-document',
      transition,
      effects: {
        issuing(stay) {
          if (signal.aborted) {
            stay.send({ type: 'fail' });
            return;
          }
          // Background restarts or an invalid extension context fail only this request.
          stay.scope.timer(() => stay.send({ type: 'fail' }), READY_TIMEOUT_MS);
          try {
            void Promise.resolve(
              chrome.runtime.sendMessage({
                type: MERMAID_TOKEN_MESSAGE.issue,
                requestId: request.id,
              }),
            ).then(
              (value: unknown) => {
                const reply = parseMermaidTokenIssueReply(value);
                stay.send(reply?.ok ? { type: 'issued', token: reply.token } : { type: 'fail' });
              },
              () => stay.send({ type: 'fail' }),
            );
          } catch {
            stay.send({ type: 'fail' });
          }
        },
        connecting(stay) {
          const fail = () => machine.send({ type: 'fail' });
          try {
            const url = chrome.runtime.getURL(MERMAID_RENDERER_PATH);
            const parsed = new URL(url);
            const origin = `${parsed.protocol}//${parsed.host}`;
            const frame = document.createElement('iframe');
            frame.className = 'gv-mermaid-renderer';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            // Keep SVG measurements available while this document stays offscreen.
            frame.style.cssText =
              'position:fixed;left:-10000px;top:0;width:1024px;height:768px;opacity:0;pointer-events:none;border:0;';
            frame.src = url;
            const channel = new MessageChannel();
            resources.effect(() => () => {
              channel.port1.onmessage = null;
              channel.port1.onmessageerror = null;
              channel.port1.close();
              channel.port2.close();
            });
            channel.port1.onmessage = (event: MessageEvent<unknown>) => {
              const response = parseMermaidResponse(event.data);
              if (!response) return;
              switch (response.type) {
                case 'ready':
                  machine.send({ type: 'ready' });
                  break;
                case 'unavailable':
                  fail();
                  break;
                case 'rendered':
                  if (response.result.id === request.id)
                    machine.send({ type: 'rendered', diagram: response.result });
                  break;
                default: {
                  const exhaustive: never = response;
                  return exhaustive;
                }
              }
            };
            channel.port1.onmessageerror = fail;
            channel.port1.start();
            const inspect = (records: MutationRecord[]): boolean => {
              const removed = records.some((record) =>
                Array.from(record.removedNodes).some(
                  (node) => node === frame || node.contains(frame),
                ),
              );
              const changed = records.some(
                (record) => record.type === 'attributes' && record.target === frame,
              );
              if (
                !frame.isConnected ||
                removed ||
                changed ||
                frame.src !== url ||
                frame.hasAttribute('srcdoc')
              ) {
                fail();
                return false;
              }
              return true;
            };
            const observer = new MutationObserver((records) => inspect(records));
            resources.effect(() => () => observer.disconnect());
            observer.observe(document, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ['src', 'srcdoc', 'sandbox'],
            });
            resources.on(frame, 'load', (event) => {
              if (!isUserEvent(event) || resources.signal.aborted) return;
              try {
                const state = machine.state;
                if (
                  state.status !== 'connecting' ||
                  state.stage !== 'loading' ||
                  !inspect(observer.takeRecords()) ||
                  !hasValidExtensionContext() ||
                  !frame.contentWindow
                ) {
                  fail();
                  return;
                }
                machine.send({ type: 'loaded' });
                frame.contentWindow.postMessage(
                  { type: MERMAID_RENDERER_CONNECT, token: state.token, request },
                  origin,
                  [channel.port2],
                );
              } catch {
                fail();
              }
            });
            resources.on(frame, 'error', fail);
            // Registered last: dispose destroys late Mermaid tasks before closing the transport.
            resources.mount(frame, document.body ?? document.documentElement);
            // A removed/mutated frame or reloaded extension is a transient failure,
            // even if its observer callback has not run when the deadline fires.
            stay.scope.timer(() => {
              const current = hasValidExtensionContext() && inspect(observer.takeRecords());
              stay.send({ type: current ? 'not-ready' : 'fail' });
            }, READY_TIMEOUT_MS);
          } catch {
            fail();
          }
        },
        rendering(stay) {
          stay.scope.timer(() => stay.send({ type: 'fail' }), RENDER_TIMEOUT_MS);
        },
        settled(stay) {
          finish(stay.state().outcome);
        },
      },
    },
    { status: 'issuing' },
  );
  resources.on(signal, 'abort', () => machine.send({ type: 'fail' }), { once: true });
  resources.on(window, 'pagehide', () => machine.send({ type: 'fail' }), { once: true });
  const outcome = await finished;
  await resources.dispose();
  await machine.stop();
  return outcome;
}
