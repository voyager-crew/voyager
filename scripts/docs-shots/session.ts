/** A small Chrome DevTools Protocol client for the docs screenshot rig. */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const SESSION_FILE = path.join(tmpdir(), 'voyager-docs-shots.json');

interface Target {
  targetId: string;
  type: string;
  url: string;
}

export class Cdp {
  private next = 0;
  private waiting = new Map<number, (message: { result?: unknown; error?: unknown }) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
    });
  }

  static async connect(): Promise<Cdp> {
    const { ws } = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { ws: string };
    const socket = new WebSocket(ws);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = ++this.next;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (message) =>
        message.error
          ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
          : resolve(message.result as T),
      );
    });
  }

  async targets(): Promise<Target[]> {
    return (await this.send<{ targetInfos: Target[] }>('Target.getTargets')).targetInfos;
  }

  async attach(match: (target: Target) => boolean): Promise<string> {
    const target = (await this.targets()).find(match);
    if (!target) throw new Error('no matching target');
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    return sessionId;
  }

  /** The replica tab. */
  page(): Promise<string> {
    return this.attach((t) => t.type === 'page' && t.url.includes('gemini.google.com'));
  }

  /** The Voyager panel frame inside the page. */
  panel(): Promise<string> {
    return this.attach((t) => t.type === 'iframe' && t.url.includes('/src/pages/panel/'));
  }

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const result = await this.send<{
      result: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  close(): void {
    this.socket.close();
  }
}
