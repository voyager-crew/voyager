import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isUserEvent } from '@/core/utils/userEvent';

import manifest from '../../../../../manifest.json';
import {
  MERMAID_TOKEN_MESSAGE,
  parseMermaidTokenMessage,
} from '../../../mermaidRenderer/authorization';
import {
  MERMAID_RENDERER_CONNECT,
  MERMAID_RENDERER_PATH,
  type MermaidRenderRequest,
} from '../../../mermaidRenderer/protocol';
import { MermaidRenderer } from '../renderer';

vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: vi.fn(() => true) }));

const TOKEN = 'a'.repeat(64);
const CODE = 'flowchart TD\n A --> B';
const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();

class Port {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly start = vi.fn();
  readonly close = vi.fn();
}

const channels: Array<{ port1: Port; port2: Port }> = [];
let renderer: MermaidRenderer;

beforeEach(() => {
  channels.length = 0;
  vi.useFakeTimers();
  vi.mocked(isUserEvent).mockReset().mockReturnValue(true);
  sendMessage.mockReset().mockResolvedValue({ ok: true, token: TOKEN });
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(sendMessage);
  vi.stubGlobal(
    'MessageChannel',
    class {
      readonly port1 = new Port();
      readonly port2 = new Port();
      constructor() {
        channels.push(this);
      }
    },
  );
  renderer = new MermaidRenderer(() => 'light');
});

afterEach(() => {
  renderer.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function connectFrame() {
  await flush();
  const frame = document.querySelector<HTMLIFrameElement>('iframe:last-of-type')!;
  expect(frame).not.toBeNull();
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  frame.dispatchEvent(new Event('load'));
  const bootstrap = post.mock.calls[0][0];
  const request: MermaidRenderRequest = bootstrap.request;
  return { frame, post, request, bootstrap, port: channels.at(-1)!.port1 };
}

function ready(port: Port): void {
  port.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } }));
}

function respond(port: Port, id: string, errorMessage: string | null = null): void {
  port.onmessage?.(
    new MessageEvent('message', {
      data: {
        type: 'rendered',
        result: {
          id,
          svg: errorMessage ? '' : '<svg></svg>',
          errorMessage,
          lightExportSvg: null,
          theme: 'light',
        },
      },
    }),
  );
}

async function renderAgain(): Promise<void> {
  expect(await renderer.initialize()).toBe(true);
  const next = renderer.render(CODE);
  const { port, request } = await connectFrame();
  ready(port);
  respond(port, request.id);
  expect((await next)?.id).toBe(request.id);
  expect(document.querySelector('iframe')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

describe('Mermaid document isolation', () => {
  it('enforces a document-lifetime resource policy before any script executes', () => {
    const html = readFileSync(resolve('src/pages/mermaidRenderer/index.html'), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');
    const meta = page.querySelector('meta[http-equiv="Content-Security-Policy"]')!;
    const policy = new Map(
      meta
        .getAttribute('content')!
        .split(';')
        .map((part) => {
          const [name, ...sources] = part.trim().split(/\s+/);
          return [name, sources];
        }),
    );
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('img-src')).toEqual(["'self'", 'data:']);
    expect(policy.get('font-src')).toEqual(["'self'", 'data:']);
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'none'"]);
    expect(
      meta.compareDocumentPosition(page.querySelector('script')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      manifest.web_accessible_resources.some((entry) =>
        entry.resources.includes(MERMAID_RENDERER_PATH),
      ),
    ).toBe(true);
  });

  it('waits for background authority and keeps the token out of the page-readable URL', async () => {
    let issue!: (value: unknown) => void;
    sendMessage.mockReturnValueOnce(new Promise((resolve) => (issue = resolve)));
    const pending = renderer.render(CODE);
    expect(document.querySelector('iframe')).toBeNull();
    const message = parseMermaidTokenMessage(sendMessage.mock.calls[0][0]);
    if (message?.type !== MERMAID_TOKEN_MESSAGE.issue) throw new Error('Missing token request');
    expect(message).toMatchObject({
      type: MERMAID_TOKEN_MESSAGE.issue,
      requestId: expect.stringMatching(/^mermaid-[a-f0-9]+$/),
    });
    issue({ ok: true, token: TOKEN });
    const { frame, post, bootstrap, port, request } = await connectFrame();
    expect(frame.src).toBe(chrome.runtime.getURL(MERMAID_RENDERER_PATH));
    expect(frame.src).not.toContain(TOKEN);
    expect(bootstrap).toEqual({
      type: MERMAID_RENDERER_CONNECT,
      token: TOKEN,
      request: { id: message.requestId, code: CODE, theme: 'light', lightExport: true },
    });
    expect(post.mock.calls[0][1]).toBe('chrome-extension://test-extension-id');
    ready(port);
    respond(port, request.id);
    expect((await pending)?.svg).toBe('<svg></svg>');
    expect(frame.isConnected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
  });

  it('accepts a completed render only after readiness and only for this request id', async () => {
    const pending = renderer.render(CODE);
    const { port, request } = await connectFrame();
    respond(port, request.id, 'result before ready');
    ready(port);
    respond(port, 'mermaid-other', 'another diagram');
    port.onmessage?.(
      new MessageEvent('message', { data: { type: 'rendered', result: { id: request.id } } }),
    );
    respond(port, request.id);
    expect(await pending).toMatchObject({ id: request.id, errorMessage: null });
  });

  it('ignores a synthetic load without consuming the later trusted bootstrap', async () => {
    const pending = renderer.render(CODE);
    await flush();
    const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    vi.mocked(isUserEvent).mockReturnValueOnce(false);
    frame.dispatchEvent(new Event('load'));
    expect(post).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    const request: MermaidRenderRequest = post.mock.calls[0][0].request;
    ready(channels[0].port1);
    respond(channels[0].port1, request.id);
    expect((await pending)?.id).toBe(request.id);
  });

  it.each(['before-ready', 'after-ready'] as const)(
    'retries after document navigation %s without a src mutation',
    async (phase) => {
      const pending = renderer.render(CODE);
      const { frame, port } = await connectFrame();
      if (phase === 'after-ready') ready(port);
      const previousUrl = frame.src;
      frame.dispatchEvent(new Event('load'));
      expect(frame.src).toBe(previousUrl);
      expect(await pending).toBeNull();
      expect(frame.isConnected).toBe(false);
      await renderAgain();
    },
  );

  it('retries after a frame is removed before becoming ready', async () => {
    const pending = renderer.render(CODE);
    const { frame } = await connectFrame();
    frame.remove();
    await flush();
    expect(await pending).toBeNull();
    await renderAgain();
  });

  it('removes the renderer document and ports before returning a diagram error', async () => {
    const pending = renderer.render(CODE);
    const { frame, port, request } = await connectFrame();
    ready(port);
    respond(port, request.id, 'Unable to decode image');
    expect((await pending)?.errorMessage).toBe('Unable to decode image');
    expect(frame.isConnected).toBe(false);
    expect(port.onmessage).toBeNull();
    expect(port.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caches only a frame which never becomes ready, after three seconds', async () => {
    const pending = renderer.render(CODE);
    const { frame } = await connectFrame();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(frame.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(frame.isConnected).toBe(false);
    expect(await renderer.initialize()).toBe(false);
    expect(await renderer.render(CODE)).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the readiness deadline when ready and allows a longer diagram to finish', async () => {
    const pending = renderer.render(CODE);
    const { frame, port, request } = await connectFrame();
    ready(port);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(frame.isConnected).toBe(true);
    respond(port, request.id);
    expect((await pending)?.id).toBe(request.id);
    expect(await renderer.initialize()).toBe(true);
  });

  it.each([
    'render-timeout',
    'pagehide',
    'removed',
    'changed-src',
    'renderer-unavailable',
    'messageerror',
  ] as const)('recreates the frame on the next block after %s', async (cause) => {
    const pending = renderer.render(CODE);
    const { frame, port } = await connectFrame();
    ready(port);
    switch (cause) {
      case 'render-timeout':
        await vi.advanceTimersByTimeAsync(30_000);
        break;
      case 'pagehide':
        window.dispatchEvent(new Event('pagehide'));
        break;
      case 'removed':
        frame.remove();
        break;
      case 'changed-src':
        frame.src += '#host-change';
        break;
      case 'renderer-unavailable':
        port.onmessage?.(new MessageEvent('message', { data: { type: 'unavailable' } }));
        break;
      case 'messageerror':
        port.onmessageerror?.();
        break;
    }
    await flush();
    expect(await pending).toBeNull();
    expect(frame.isConnected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    await renderAgain();
    expect(channels).toHaveLength(2);
  });

  it('retries the next block after an extension reload invalidates token issuance', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    expect(await renderer.render(CODE)).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    await renderAgain();
    expect(channels).toHaveLength(1);
  });

  it('does not cache a readiness timeout while the extension context is invalid', async () => {
    const pending = renderer.render(CODE);
    await connectFrame();
    const descriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'id')!;
    try {
      Object.defineProperty(chrome.runtime, 'id', {
        configurable: true,
        get() {
          throw new Error('Extension context invalidated');
        },
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await pending).toBeNull();
    } finally {
      Object.defineProperty(chrome.runtime, 'id', descriptor);
    }
    await renderAgain();
  });

  it('expires a stalled token request without disabling later blocks or mounting a late frame', async () => {
    let issue!: (value: unknown) => void;
    sendMessage.mockReturnValueOnce(new Promise((resolve) => (issue = resolve)));
    const pending = renderer.render(CODE);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBeNull();
    issue({ ok: true, token: TOKEN });
    await flush();
    expect(document.querySelector('iframe')).toBeNull();
    await renderAgain();
    expect(channels).toHaveLength(1);
  });

  it('renders on an HTTP page whose crypto has no randomUUID', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      const pending = renderer.render(CODE);
      const { port, request } = await connectFrame();
      expect(request.id).toMatch(/^mermaid-[a-f0-9]{32}$/);
      ready(port);
      respond(port, request.id);
      expect((await pending)?.id).toBe(request.id);
    } finally {
      if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
      else Reflect.deleteProperty(crypto, 'randomUUID');
    }
  });

  it('cancels this activation and removes a pending frame when disposed', async () => {
    const pending = renderer.render(CODE);
    const { frame, port } = await connectFrame();
    renderer.dispose();
    expect(await pending).toBeNull();
    expect(frame.isConnected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(await renderer.initialize()).toBe(false);
    expect(await renderer.render(CODE)).toBeNull();
  });

  it('keeps concurrent diagram documents independent when one render fails', async () => {
    const first = renderer.render(CODE);
    const light = await connectFrame();
    const second = renderer.render('sequenceDiagram\n A->>B: hi');
    const other = await connectFrame();
    ready(light.port);
    ready(other.port);
    respond(light.port, light.request.id, 'Parse error');
    await first;
    expect(other.frame.isConnected).toBe(true);
    respond(other.port, other.request.id);
    expect((await second)?.id).toBe(other.request.id);
    expect(document.querySelector('iframe')).toBeNull();
    expect(channels.every(({ port1 }) => port1.close.mock.calls.length === 1)).toBe(true);
  });
});
