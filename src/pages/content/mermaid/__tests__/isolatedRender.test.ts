import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import manifest from '../../../../../manifest.json';
import { MERMAID_RENDERER_PATH } from '../../../mermaidRenderer/protocol';
import { MermaidRenderer } from '../renderer';

class Port {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly postMessage = vi.fn();
  readonly start = vi.fn();
  readonly close = vi.fn();
}

const channels: Array<{ port1: Port; port2: Port }> = [];
let renderer: MermaidRenderer;

beforeEach(() => {
  channels.length = 0;
  vi.useFakeTimers();
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

function connectFrame() {
  const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  frame.dispatchEvent(new Event('load'));
  const request = post.mock.calls[0][0].request;
  return { frame, post, request, port: channels.at(-1)!.port1 };
}

function respond(port: Port, id: string, errorMessage: string | null = null) {
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

describe('Mermaid document isolation', () => {
  it('constrains resource loads for the whole document lifetime, including rejected render siblings', () => {
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
    // A static CSP is enforced even after mermaid.render has already rejected;
    // there is no temporary guard to restore or font stylesheet to inherit.
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
      manifest.web_accessible_resources.filter((entry) =>
        entry.resources.includes(MERMAID_RENDERER_PATH),
      ),
    ).toEqual([{ resources: [MERMAID_RENDERER_PATH], matches: ['<all_urls>'] }]);
  });

  it('leaves concurrent detached image export and inline style writes untouched', async () => {
    const pending = renderer.render('flowchart TD\n A --> B', { lightExport: false });
    const { frame, port, request } = connectFrame();
    const url = 'https://example.com/export.png';
    const image = new Image();
    image.src = url;
    const exportBox = document.createElement('div');
    exportBox.innerHTML = `<img src="${url}">`;
    exportBox.style.backgroundImage = `url("${url}")`;
    const attached = document.body.appendChild(document.createElement('div'));
    attached.style.setProperty('background-image', `url("${url}")`);

    expect(image.src).toBe(url);
    expect(exportBox.querySelector('img')?.src).toBe(url);
    expect(exportBox.style.backgroundImage).toContain(url);
    expect(attached.style.backgroundImage).toContain(url);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.style.display).not.toBe('none');
    expect(frame.style.visibility).not.toBe('hidden');

    respond(port, request.id);
    expect((await pending)?.errorMessage).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('destroys a rejected render document before returning and ignores late sibling replies', async () => {
    const pending = renderer.render('flowchart TD\n A --> B');
    const { frame, port, request } = connectFrame();
    const lateReply = port.onmessage!;
    respond(port, request.id, 'Unable to decode image');
    const result = await pending;
    expect(result?.errorMessage).toBe('Unable to decode image');
    expect(frame.isConnected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    lateReply(
      new MessageEvent('message', {
        data: {
          type: 'rendered',
          result: { ...result, svg: '<svg><image href="https://attacker.example/late"/></svg>' },
        },
      }),
    );
    expect(document.querySelector('image')).toBeNull();
    expect(result?.svg).toBe('');
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
  });

  it('accepts replies only through the private port for this render id', async () => {
    const pending = renderer.render('flowchart TD\n A --> B');
    const { port, request, post } = connectFrame();
    expect(post.mock.calls[0][1]).toBe('chrome-extension://test-extension-id');
    respond(port, 'mermaid-some-other-render');
    port.onmessage?.(
      new MessageEvent('message', { data: { type: 'rendered', result: { id: request.id } } }),
    );
    window.postMessage({ type: 'unavailable' }, '*');
    expect(document.querySelector('iframe')).not.toBeNull();
    respond(port, request.id);
    expect((await pending)?.id).toBe(request.id);
  });

  it('leaves code visible and caches an unavailable renderer instead of retrying every scan', async () => {
    const pending = renderer.render('flowchart TD\n A --> B');
    const { port } = connectFrame();
    port.onmessage?.(new MessageEvent('message', { data: { type: 'unavailable' } }));
    expect(await pending).toBeNull();
    expect(await renderer.initialize()).toBe(false);
    expect(await renderer.render('flowchart TD\n B --> C')).toBeNull();
    expect(channels).toHaveLength(1);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it.each(['dispose', 'pagehide', 'timeout', 'messageerror'] as const)(
    'releases the frame, ports and pending render on %s',
    async (cause) => {
      const pending = renderer.render('flowchart TD\n A --> B');
      const { port } = connectFrame();
      switch (cause) {
        case 'dispose':
          renderer.dispose();
          break;
        case 'pagehide':
          window.dispatchEvent(new Event('pagehide'));
          break;
        case 'timeout':
          await vi.runOnlyPendingTimersAsync();
          break;
        case 'messageerror':
          port.onmessageerror?.();
          break;
      }
      expect(await pending).toBeNull();
      expect(document.querySelector('iframe')).toBeNull();
      expect(
        channels.every(
          ({ port1, port2 }) =>
            port1.close.mock.calls.length === 1 && port2.close.mock.calls.length === 1,
        ),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('isolates concurrent renders in different documents and themes', async () => {
    const first = renderer.render('flowchart TD\n A --> B');
    const connection1 = connectFrame();
    const dark = new MermaidRenderer(() => 'dark');
    const second = dark.render('sequenceDiagram\n A->>B: hi');
    const frames = document.querySelectorAll('iframe');
    const post = vi.spyOn(frames[1].contentWindow!, 'postMessage');
    frames[1].dispatchEvent(new Event('load'));
    const request2 = post.mock.calls[0][0].request;
    expect(connection1.request.theme).toBe('light');
    expect(request2.theme).toBe('dark');
    respond(connection1.port, connection1.request.id, 'Parse error');
    await first;
    expect(frames[1].isConnected).toBe(true);
    respond(channels[1].port1, request2.id);
    await second;
    dark.dispose();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
