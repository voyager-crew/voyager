import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MERMAID_TOKEN_MESSAGE } from '../authorization';
import * as connection from '../connection';
import * as protocol from '../protocol';
import type { MermaidRenderResult } from '../protocol';

const render = vi.hoisted(() => vi.fn());
vi.mock('../render', () => ({ renderMermaidDocument: render }));
const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();

const TOKEN = 'a'.repeat(64);
const REQUEST = {
  id: 'mermaid-test',
  code: 'flowchart TD\n A --> B',
  theme: 'light',
  lightExport: false,
};
const RESULT = {
  id: REQUEST.id,
  svg: '<svg></svg>',
  errorMessage: null,
  lightExportSvg: null,
  theme: 'light',
} satisfies MermaidRenderResult;

class Port implements MessagePort {
  onmessage: MessagePort['onmessage'] = null;
  onmessageerror: MessagePort['onmessageerror'] = null;
  readonly postMessage =
    vi.fn<(message: unknown, options?: StructuredSerializeOptions | Transferable[]) => void>();
  readonly close = vi.fn();
  readonly start = vi.fn();
  readonly addEventListener = vi.fn<(type: string, callback: unknown, options?: unknown) => void>();
  readonly removeEventListener =
    vi.fn<(type: string, callback: unknown, options?: unknown) => void>();
  readonly dispatchEvent = vi.fn<(event: Event) => boolean>(() => true);
}
let stop: () => void;

function deliver({
  data = { type: protocol.MERMAID_RENDERER_CONNECT, token: TOKEN, request: REQUEST },
  ports = [new Port()],
  source = window,
}: { data?: unknown; ports?: Port[]; source?: MessageEventSource | null } = {}): Port[] {
  window.dispatchEvent(new MessageEvent('message', { data, ports, source }));
  return ports;
}

async function flush(): Promise<void> {
  // Drain the authorization and rendering promise boundaries without advancing real time.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue({ ok: true, requestId: REQUEST.id });
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(sendMessage);
  render.mockReset().mockResolvedValue(RESULT);
  stop = connection.startMermaidRendererConnection();
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderer document admission', () => {
  it('authenticates before parsing and announces readiness before returning the SVG', async () => {
    let authorize!: (value: unknown) => void;
    sendMessage.mockReturnValueOnce(new Promise((resolve) => (authorize = resolve)));
    const parse = vi.spyOn(protocol, 'parseMermaidRequest');
    const [port] = deliver();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MERMAID_TOKEN_MESSAGE.redeem,
      token: TOKEN,
    });
    expect(parse).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();

    authorize({ ok: true, requestId: REQUEST.id });
    await flush();
    expect(render).toHaveBeenCalledWith(REQUEST);
    expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'ready' },
      { type: 'rendered', result: RESULT },
    ]);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('refuses a framing page’s chosen nonce before inspecting the diagram', async () => {
    sendMessage.mockResolvedValueOnce({ ok: false });
    const parse = vi.spyOn(protocol, 'parseMermaidRequest');
    const [port] = deliver({
      data: {
        type: protocol.MERMAID_RENDERER_CONNECT,
        token: 'page-chosen-nonce',
        request: {
          get id() {
            throw new Error('untrusted diagram was inspected');
          },
        },
      },
    });
    await flush();
    expect(parse).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'unavailable' });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it.each([0, 2])('does not redeem or parse a connection with %i ports', async (count) => {
    deliver({ ports: Array.from({ length: count }, () => new Port()) });
    await flush();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    const [port] = deliver();
    await flush();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'rendered', result: RESULT });
  });

  it('rejects a source which is neither the parent nor a redacted extension sender', async () => {
    const other = document.body.appendChild(document.createElement('iframe'));
    deliver({ source: other.contentWindow });
    await flush();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('accepts a redacted Firefox sender after the same background redemption', async () => {
    const [port] = deliver({ source: null });
    await flush();
    expect(render).toHaveBeenCalledWith(REQUEST);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('requires the exact request id authorized by the background', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, requestId: 'mermaid-other' });
    const [port] = deliver();
    await flush();
    expect(render).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'unavailable' });
  });

  it.each([{ ok: true }, null, { ok: false }])(
    'refuses an invalid authorization result: %j',
    async (reply) => {
      sendMessage.mockResolvedValueOnce(reply);
      const parse = vi.spyOn(protocol, 'parseMermaidRequest');
      const [port] = deliver();
      await flush();
      expect(parse).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'unavailable' });
    },
  );

  it('claims one authorized connection and refuses a concurrent token replay', async () => {
    let authorize!: (value: unknown) => void;
    sendMessage
      .mockReturnValueOnce(new Promise((resolve) => (authorize = resolve)))
      .mockResolvedValueOnce({ ok: false });
    const [first] = deliver();
    const [second] = deliver();
    await flush();
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'unavailable' });
    authorize({ ok: true, requestId: REQUEST.id });
    await flush();
    deliver();
    await flush();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledOnce();
    expect(first.postMessage).toHaveBeenCalledWith({ type: 'rendered', result: RESULT });
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('does not let a forged bootstrap race consume the real content-script connection', async () => {
    let refuse!: (value: unknown) => void;
    sendMessage.mockReturnValueOnce(new Promise((resolve) => (refuse = resolve)));
    const [forged] = deliver({
      data: { type: protocol.MERMAID_RENDERER_CONNECT, token: 'b'.repeat(64), request: REQUEST },
    });
    const [legitimate] = deliver();
    await flush();
    expect(render).toHaveBeenCalledExactlyOnceWith(REQUEST);
    expect(legitimate.postMessage).toHaveBeenCalledWith({ type: 'rendered', result: RESULT });
    refuse({ ok: false });
    await flush();
    expect(forged.close).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it('does not render or send readiness when the document is retired during redemption', async () => {
    let authorize!: (value: unknown) => void;
    sendMessage.mockReturnValueOnce(new Promise((resolve) => (authorize = resolve)));
    const [port] = deliver();
    window.dispatchEvent(new Event('pagehide'));
    authorize({ ok: true, requestId: REQUEST.id });
    await flush();
    expect(render).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('returns an unavailable response when the background context is lost', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    const [port] = deliver();
    await flush();
    expect(render).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'unavailable' });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('starts the authenticated listener from the shipped document entry', async () => {
    stop();
    const start = vi.spyOn(connection, 'startMermaidRendererConnection');
    await import('../index');
    expect(start).toHaveBeenCalledOnce();
    stop = start.mock.results[0].value;
    const [port] = deliver();
    await flush();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'rendered', result: RESULT });
  });
});
