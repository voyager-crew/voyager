import { startMachine } from '@/features/plugins/runtime/stateMachine';
import {
  MERMAID_RENDERER_CONNECT,
  MERMAID_RENDERER_PATH,
  type MermaidRenderRequest,
  type MermaidRenderResult,
  parseMermaidResponse,
} from '@/pages/mermaidRenderer/protocol';

const RENDER_TIMEOUT_MS = 30_000;

type RenderState =
  | { readonly status: 'rendering' }
  | { readonly status: 'settled'; readonly result: MermaidRenderResult | null };
type RenderEvent = { readonly type: 'finish'; readonly result: MermaidRenderResult | null };

function transition(state: RenderState, event: RenderEvent): RenderState {
  return state.status === 'rendering' ? { status: 'settled', result: event.result } : state;
}

/** A private port returns sanitized SVG; no Mermaid code ever executes in the content world. */
export async function renderInIsolatedDocument(
  request: MermaidRenderRequest,
  signal: AbortSignal,
): Promise<MermaidRenderResult | null> {
  let finish!: (result: MermaidRenderResult | null) => void;
  const finished = new Promise<MermaidRenderResult | null>((resolve) => (finish = resolve));
  const machine = startMachine<RenderState, RenderEvent>(
    {
      id: 'mermaid-document',
      transition,
      effects: {
        rendering(stay) {
          const fail = () => stay.send({ type: 'finish', result: null });
          if (signal.aborted) {
            fail();
            return;
          }
          try {
            const channelId = crypto.randomUUID();
            const url = new URL(chrome.runtime.getURL(MERMAID_RENDERER_PATH));
            url.hash = channelId;
            // URL.origin can be "null" for extension schemes.
            const origin = `${url.protocol}//${url.host}`;
            const frame = document.createElement('iframe');
            frame.className = 'gv-mermaid-renderer';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            // Keep the document renderable: hidden visibility can make SVG
            // getBBox return zero in a child browsing context.
            frame.style.cssText =
              'position:fixed;left:-10000px;top:0;width:1024px;height:768px;opacity:0;pointer-events:none;border:0;';
            const channel = new MessageChannel();
            stay.scope.effect(() => () => {
              channel.port1.onmessage = null;
              channel.port1.onmessageerror = null;
              channel.port1.close();
              channel.port2.close();
            });
            channel.port1.onmessage = (event: MessageEvent<unknown>) => {
              const response = parseMermaidResponse(event.data);
              if (!response) return;
              if (response.type === 'unavailable') fail();
              else if (response.result.id === request.id) {
                stay.send({ type: 'finish', result: response.result });
              }
            };
            channel.port1.onmessageerror = fail;
            channel.port1.start();
            stay.scope.on(
              frame,
              'load',
              () => {
                try {
                  if (!frame.contentWindow) {
                    fail();
                    return;
                  }
                  frame.contentWindow.postMessage(
                    { type: MERMAID_RENDERER_CONNECT, channelId, request },
                    origin,
                    [channel.port2],
                  );
                } catch {
                  fail();
                }
              },
              { once: true },
            );
            stay.scope.on(frame, 'error', fail);
            stay.scope.on(signal, 'abort', fail, { once: true });
            stay.scope.on(window, 'pagehide', fail, { once: true });
            stay.scope.timer(fail, RENDER_TIMEOUT_MS);
            frame.src = url.href;
            // Registered last so retiring the state destroys the document first,
            // including any sibling tasks still running after a rejected render.
            stay.scope.mount(frame, document.body ?? document.documentElement);
          } catch {
            fail();
          }
        },
        settled(stay) {
          finish(stay.state().result);
        },
      },
    },
    { status: 'rendering' },
  );
  const result = await finished;
  await machine.stop();
  return result;
}
