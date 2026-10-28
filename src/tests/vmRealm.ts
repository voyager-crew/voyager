/**
 * Makes the VM pools' test realm match the default pool's.
 *
 * Under `vmThreads` each test file runs in jsdom's own realm. Vitest copies a
 * few of Node's globals into it, and their results keep Node's prototypes, so a
 * clone fails `Object.getPrototypeOf(x) === Object.prototype` and `instanceof
 * Map`. Other globals the suite relies on are missing. Under the default pool
 * the realm is Node's, every check below finds nothing to do, and this is a
 * no-op.
 *
 * Everything here is assigned on this file's own global or its window's own
 * classes. Node's built-ins and their prototypes are shared by every file in a
 * worker, so nothing patches them.
 */
import type { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { performance as nodePerformance } from 'node:perf_hooks';
import * as webStreams from 'node:stream/web';

declare const jsdom: JSDOM | undefined;

/** Rebuilds a value cloned in Node's realm from this realm's built-ins, keeping shared and circular references. */
function adopt(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  // `instanceof` fails across realms; the built-in tag does not.
  switch (Object.prototype.toString.call(value)) {
    case '[object Array]': {
      const out: unknown[] = [];
      seen.set(value, out);
      // forEach skips holes, so sparse arrays stay sparse.
      (value as unknown[]).forEach((item, index) => {
        out[index] = adopt(item, seen);
      });
      return out;
    }
    case '[object Object]': {
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const [key, item] of Object.entries(value)) {
        // defineProperty keeps an own `__proto__` key a plain property.
        Object.defineProperty(out, key, {
          value: adopt(item, seen),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return out;
    }
    case '[object Map]': {
      const out = new Map<unknown, unknown>();
      seen.set(value, out);
      for (const [key, item] of value as Map<unknown, unknown>) {
        out.set(adopt(key, seen), adopt(item, seen));
      }
      return out;
    }
    case '[object Set]': {
      const out = new Set<unknown>();
      seen.set(value, out);
      for (const item of value as Set<unknown>) out.add(adopt(item, seen));
      return out;
    }
    case '[object Date]':
      return new Date((value as Date).getTime());
    case '[object RegExp]':
      return new RegExp((value as RegExp).source, (value as RegExp).flags);
    default:
      // Binary data, errors and boxed primitives keep Node's prototypes; the suite clones none.
      return value;
  }
}

const nodeStructuredClone = globalThis.structuredClone;
if (Object.getPrototypeOf(nodeStructuredClone({})) !== Object.prototype) {
  // Node's clone still decides what can be cloned and throws DataCloneError.
  globalThis.structuredClone = (value, options) =>
    adopt(nodeStructuredClone(value, options), new Map()) as typeof value;
}

const NodeResponse = globalThis.Response;
if (Object.getPrototypeOf(await new NodeResponse('{}').json()) !== Object.prototype) {
  // Node's Response parses JSON bodies in Node's realm. Re-parsing the text
  // here gives this realm's objects, like a browser's `fetch` would.
  class Response extends NodeResponse {
    static json(data: unknown, init?: ResponseInit): Response {
      const response = NodeResponse.json(data, init);
      return new Response(response.body, response);
    }

    async json(): Promise<unknown> {
      return JSON.parse(await this.text());
    }
  }
  globalThis.Response = Response;
}

// jsdom's crypto has getRandomValues and randomUUID but no SubtleCrypto.
if (globalThis.crypto && !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    configurable: true,
  });
}

// jsdom's performance has only now() and timeOrigin. The default pool keeps
// Node's, which also reads the entry timeline browsers expose. Fake timers copy
// the methods of the prototype, and jsdom builds a Performance class per window,
// so the prototype here is this file's own.
for (const name of ['getEntries', 'getEntriesByName', 'getEntriesByType'] as const) {
  if (globalThis.performance && !(name in globalThis.performance)) {
    Object.defineProperty(Object.getPrototypeOf(globalThis.performance), name, {
      value: nodePerformance[name].bind(nodePerformance),
      writable: true,
      configurable: true,
    });
  }
}

// jsdom has no Streams API; under the default pool tests got Node's globals.
for (const name of [
  'ReadableStream',
  'ReadableStreamDefaultReader',
  'ReadableStreamBYOBReader',
  'ReadableStreamBYOBRequest',
  'ReadableByteStreamController',
  'ReadableStreamDefaultController',
  'TransformStream',
  'TransformStreamDefaultController',
  'WritableStream',
  'WritableStreamDefaultWriter',
  'WritableStreamDefaultController',
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
  'TextEncoderStream',
  'TextDecoderStream',
  'CompressionStream',
  'DecompressionStream',
] as const) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, {
      value: webStreams[name],
      writable: true,
      configurable: true,
    });
  }
}

// jsdom queues a window's postMessage on the setTimeout of its own module, which
// is Node's. Under the default pool that is also the test's global, so fake
// timers deliver the message; here the test's global is jsdom's window, and the
// message would arrive on the real clock instead. Queue it on this realm's
// timers, with jsdom's checks and event.
if (typeof jsdom !== 'undefined' && Object.is(jsdom.window, globalThis)) {
  globalThis.postMessage = function postMessage(message: unknown, targetOrigin?: unknown): void {
    if (arguments.length < 2) {
      throw new TypeError("'postMessage' requires 2 arguments: 'message' and 'targetOrigin'");
    }
    const origin = String(targetOrigin);
    if (origin === '/') return;
    if (origin !== '*') {
      let target: URL;
      try {
        target = new URL(origin);
      } catch {
        throw new DOMException(
          `Failed to execute 'postMessage' on 'Window': Invalid target origin '${origin}' in a call to 'postMessage'.`,
          'SyntaxError',
        );
      }
      if (target.origin !== location.origin) return;
    }
    setTimeout(() => dispatchEvent(new MessageEvent('message', { data: message })), 0);
  } as typeof globalThis.postMessage;
}
